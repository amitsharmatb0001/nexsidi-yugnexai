// Claude escalation tier for the agentic tool-calling loop (Task 15).
//
// PARALLEL implementation of loop.ts's runAgent() while-loop, calling
// claudeChatWithTools() instead of nimChatWithTools(). loop.ts itself is not
// modified beyond exporting MAX_ITERATIONS/TASK_COMPLETE_TOOL for reuse here
// (see loop.ts) — this file is additive, not a rewrite of the NIM path.
//
// Reuses:
//   - buildToolList() from loop.ts (already exported) to get the same
//     provider-agnostic NIM tool defs the NIM loop uses — INCLUDING
//     TASK_COMPLETE_TOOL, which buildToolList() always appends — then
//     translates the whole list once via translateNimToolToClaudeTool. This
//     is what gives the Claude loop the exact same task_complete contract
//     (same fields, same "call this only once verification passed"
//     semantics) without redefining it here.
//   - The SAME tool execution functions (execWriteFile, execRunCommand,
//     etc.) — these just take a sandboxDir + args and do real file/shell
//     operations; there is nothing NIM-specific about them.
//   - The SAME MAX_ITERATIONS constant, imported from loop.ts.
import {
  claudeChatWithTools,
  translateNimToolToClaudeTool,
  resolveClaudeModel,
  type ClaudeMessage,
  type ClaudeToolDef,
  type ClaudeContentBlockParam,
} from "@nexsidi/llm-client";
// 2026-08-13 (cost-control Task 1): same CRITICAL gap as loop.ts/
// gemini-loop.ts — this is the Claude escalation tier (rare, one-shot retry
// when NIM fails, but at Claude's rates the most expensive per-call spend of
// any of the three loops). claudeChatWithTools's usage field (added this
// task — see claude.ts) makes the real per-call token counts available here.
import { recordSpend } from "./cost-budget.ts";
import { isClaudeEnabled, usesClaude } from "./claude-flag.ts";
import { runAgent, buildToolList, MAX_ITERATIONS, READONLY_BLOCKED_TOOLS, readOnlyToolBlockedResult, type AgentRunConfig, type AgentRunResult, sanitizeModelChain, toolChatProviderFor, conversationKeyFor } from "./loop.ts";
import { isNimEnabled } from "@nexsidi/llm-client";
import { join } from "path";
import { readFileSync } from "node:fs";
import { runAgentWithGemini, screenshotImagePathsFor } from "./gemini-loop.ts";
import { execWriteFile, execReadFile, execListFiles, execEditFile, execEditFiles, execReadFiles, execDeleteFile } from "./tools/file.ts";
import { execRunCommand } from "./tools/command.ts";
import { execHttpRequest } from "./tools/http.ts";
import { execDockerCompose } from "./tools/docker.ts";
import { execWebSearch } from "./tools/websearch.ts";
import { execScreenshot } from "./tools/screenshot.ts";
import { BrowserToolset, BROWSER_TOOL_NAMES } from "./tools/browser.ts";
import { execDbQuery } from "./tools/db.ts";
import { createEvidenceLedger } from "./enforce/evidence.ts";
import { checkCompletion } from "./enforce/completion-gate.ts";
import { runMissingRequiredChecks } from "./enforce/auto-checks.ts";
import { assembleSystemPrompt } from "./prompt-assembly.ts";
import { detectStuckLoop } from "./enforce/stuck-loop.ts";
import { resumesSavedHistory } from "./history-format.ts";
import { stepBudgetNotice, StepBudget, isProgressStep } from "./step-budget.ts";
import { BlockedActionTracker } from "./blocked-actions.ts";
import { recordBlocked, REPORT_BLOCKED_TOOL_DEF } from "./tools/blocked.ts";
import { recordDispute } from "./tools/dispute.ts";
import { recordVerdict } from "./tools/settle.ts";
import { fixRunUnaccounted } from "./enforce/fix-accounting.ts";
import { trackWrittenFile } from "./enforce/files-written.ts";
import { summaryRejection } from "./enforce/summary-format.ts";
import { imagesSeenRejection } from "./enforce/images-seen.ts";
import { nimTimeBudgetMs } from "./nim-time-budget.ts";
import { runStopReason } from "./run-abort.ts";
import { loadSkillText } from "./skill-library.ts";
import { buildDirFor } from "./build-dir.ts";

export type { AgentRunConfig, AgentRunResult } from "./loop.ts";

// L6 (full-system audit): runAgentWithClaude previously started cold on
// escalation — zero knowledge of what the failed NIM attempt tried, wrote,
// or errored on, discarding whatever real progress NIM made before hitting
// MAX_ITERATIONS. Pure and exported for direct unit testing without going
// through the DI harness.
export function buildEscalationMessage(originalMessage: string, nimResult: AgentRunResult): string {
  if (nimResult.filesWritten.length === 0 && nimResult.errors.length === 0) {
    return originalMessage;
  }
  const parts: string[] = [
    originalMessage,
    "",
    "--- A previous automated attempt already worked on this task and ran out of iterations before finishing. Build on what it did — read the files it wrote before rewriting them, and don't repeat the errors it already hit. ---",
  ];
  if (nimResult.filesWritten.length > 0) {
    parts.push(`Files already written (read them first): ${nimResult.filesWritten.join(", ")}`);
  }
  if (nimResult.errors.length > 0) {
    parts.push(`Errors the previous attempt hit (avoid repeating these): ${nimResult.errors.join("; ")}`);
  }
  return parts.join("\n");
}

/**
 * Claude-based tool-calling loop — same shape/contract as runAgent(), used
 * as the escalation retry when the NIM path fails. Reads ANTHROPIC_API_KEY
 * from process.env directly (mirroring how callers of runAgent() read
 * NIM_API_KEY from process.env and pass it in as config.apiKey — see
 * agents/tilotma/src/orchestrator.ts / tier3-review.ts): config.apiKey on
 * AgentRunConfig is the NIM credential the caller already resolved for the
 * NIM path, so the Claude path needs its own credential rather than reusing
 * that field.
 */
// Found live 2026-07-06 testing Claude-via-Vertex-AI: a fresh Vertex AI
// project's default quota for a foundation model is 0/near-zero until an
// explicit quota-increase request is approved by Google (can take hours) —
// every retry within the same run hits the identical wall. Same category as
// auth/permission failures: retrying THIS run will never succeed. Detecting
// these lets the loop abort early instead of burning the full 40-iteration,
// 5s-sleep-per-attempt budget (~200s) on a guaranteed-repeat failure.
// Pure and exported for direct unit testing.
export function isUnrecoverableClaudeError(err: unknown): boolean {
  const message = String(err);
  return (
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("quota increase request") ||
    message.includes("authentication failed") ||
    message.includes("permission denied")
  );
}

export async function runAgentWithClaude(config: AgentRunConfig): Promise<AgentRunResult> {
  const originalLog = console.log;
  const originalError = console.error;
  if (config.projectId) {
    const logToFile = (msg: string) => {
      try {
        const logDir = join(buildDirFor(config.projectId!), "logs");
        const { mkdirSync, appendFileSync } = require("fs");
        mkdirSync(logDir, { recursive: true });
        appendFileSync(join(logDir, "pipeline.log"), `${new Date().toISOString()} [${config.agentName}:claude] ${msg}\n`, "utf-8");
      } catch {}
    };
    console.log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(msg);
      originalLog(...args);
    };
    console.error = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(`[ERROR] ${msg}`);
      originalError(...args);
    };
  }

  const emitEvent = (event: Record<string, unknown>) => {
    if (!config.projectId) return;
    try {
      const logDir = join(buildDirFor(config.projectId!), "logs");
      const { mkdirSync, appendFileSync } = require("fs");
      mkdirSync(logDir, { recursive: true });
      appendFileSync(
        join(logDir, "events.jsonl"),
        JSON.stringify({ ts: Date.now(), agent: config.agentName, ...event }) + "\n",
        "utf-8",
      );
    } catch {}
  };

  const claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";

  const nimTools = buildToolList(config);
  const tools: ClaudeToolDef[] = nimTools.map(translateNimToolToClaudeTool);
  // Phase 5 Task 3: same evidence ledger + completion gate as loop.ts —
  // escalation runs are exactly where evidence enforcement matters most.
  const ledger = createEvidenceLedger();

  // Phase 5 Task 6: same skills-at-runtime injection as loop.ts.
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt, taskText: config.initialMessage });

  let messages: ClaudeMessage[] = [];
  let loadedFromDb = false;

  if (resumesSavedHistory(config)) {
    try {
      const { db } = await import("@nexsidi/db");
      const { agentConversations } = await import("@nexsidi/db/schema");
      const { eq, and } = await import("drizzle-orm");

      const existing = await db
        .select()
        .from(agentConversations)
        .where(
          and(
            eq(agentConversations.projectId, config.projectId),
            eq(agentConversations.agentName, conversationKeyFor(config))
          )
        )
        .limit(1);

      if (existing[0]) {
        messages = existing[0].messages as ClaudeMessage[];
        const sysIdx = messages.findIndex((m) => m.role === "system");
        if (sysIdx >= 0) {
          messages[sysIdx] = { role: "system", content: systemPrompt };
        }
        messages.push({ role: "user", content: config.initialMessage });
        loadedFromDb = true;
        console.log(`[${config.agentName}:claude-agent] Loaded existing conversation history (${messages.length} messages) from database`);
      }
    } catch (e) {
      console.error(`[${config.agentName}:claude-agent] Failed to load history:`, e);
    }
  }

  if (!loadedFromDb) {
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: config.initialMessage },
    ];
  }

  const saveHistory = async () => {
    if (config.projectId) {
      try {
        const { db } = await import("@nexsidi/db");
        const { agentConversations } = await import("@nexsidi/db/schema");
        const { eq, and } = await import("drizzle-orm");

        const existing = await db
          .select()
          .from(agentConversations)
          .where(
            and(
              eq(agentConversations.projectId, config.projectId),
              eq(agentConversations.agentName, conversationKeyFor(config))
            )
          )
          .limit(1);

        if (existing[0]) {
          await db
            .update(agentConversations)
            .set({
              messages,
              updatedAt: new Date(),
            })
            .where(eq(agentConversations.id, existing[0].id));
        } else {
          await db.insert(agentConversations).values({
            projectId: config.projectId,
            agentName: conversationKeyFor(config),
            messages,
          });
        }
        console.log(`[${config.agentName}:claude-agent] Saved conversation history (${messages.length} messages) to database`);
      } catch (e) {
        console.error(`[${config.agentName}:claude-agent] Failed to save history:`, e);
      }
    }
  };

  const filesWritten: string[] = [];
  let imagesSeen = 0; // screenshots actually sent to the model (see enforce/images-seen.ts)

  let disputesRecorded = 0; // fix runs: see enforce/fix-accounting.ts
  const errors: string[] = [];
  let iterations = 0;
  const effectiveMaxIterations = config.maxIterations ?? MAX_ITERATIONS;
  const stepBudget = new StepBudget(effectiveMaxIterations, config.extendStepsWhileProgressing === true);
  let abortedOnUnrecoverableError = false;
  const blockedTracker = new BlockedActionTracker();
  const recentCallSignatures: string[] = [];

  console.log(`[${config.agentName}:claude-agent] Starting — model: claude-sonnet-5, maxIter: ${effectiveMaxIterations}`);

  // Interactive-browser QA session (Tilotma Tier 3) — same lifecycle as
  // loop.ts: lazily spawned, closed in the finally on every exit path.
  const browserToolset = config.enableBrowser ? new BrowserToolset(config.sandboxDir) : null;
  try {
  while (stepBudget.canContinue(iterations)) {
    // Ledgerly benchmark: stop at the next step once the activity was
    // cancelled or timed out (see run-abort.ts).
    const stopReason = runStopReason(config);
    if (stopReason) {
      console.log(`[${config.agentName}:claude-agent] ${stopReason}`);
      await saveHistory();
      return { success: false, summary: stopReason, filesWritten, iterations, errors: [...errors, stopReason] };
    }
    iterations++;
    console.log(`[${config.agentName}:claude-agent] Iteration ${iterations}`);

    let response;
    try {
      response = await claudeChatWithTools(messages, tools, claudeApiKey);
      // 2026-08-13 (cost-control Task 1): real per-project $ accumulation —
      // see this file's recordSpend import comment.
      if (config.projectId) {
        try {
          await recordSpend(config.projectId, response.usage.inputTokens, response.usage.outputTokens, resolveClaudeModel(), undefined, 0, config.agentName);
        } catch (spendErr) {
          console.error(`[${config.agentName}:claude-agent] recordSpend failed (non-fatal — this call's spend may be under-counted):`, spendErr);
        }
      }
    } catch (err) {
      if (isUnrecoverableClaudeError(err)) {
        errors.push(`Claude call failed on iteration ${iterations} with an unrecoverable error — aborting early instead of retrying: ${String(err)}`);
        abortedOnUnrecoverableError = true;
        break;
      }
      errors.push(`Claude call failed on iteration ${iterations}: ${String(err)}`);
      // Try to continue — next iteration might succeed after a cooldown
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (response.content) {
      const thinkingMatch = response.content.match(/<thinking>([\s\S]*?)<\/thinking>/);
      if (thinkingMatch?.[1]) {
        console.log(`[${config.agentName}:claude-agent] Thinking:\n${thinkingMatch[1].trim()}`);
      } else {
        console.log(`[${config.agentName}:claude-agent] Response:\n${response.content.trim()}`);
      }
    }

    // Push the full raw content blocks (not just extracted text) so
    // tool_use blocks are preserved for the next turn, per the SDK's own
    // multi-turn tool-use guidance.
    messages.push({ role: "assistant", content: response.rawContent });

    // No tool calls — model is done but didn't call task_complete
    if (response.toolCalls.length === 0) {
      if (response.stopReason === "end_turn" || response.stopReason === "refusal") {
        console.log(`[${config.agentName}:claude-agent] Model stopped without task_complete — treating as done`);
        return {
          success: false,
          summary: response.content || "no content",
          filesWritten,
          iterations,
          errors: [...errors, "Agent stopped without calling task_complete"],
        };
      }
      continue;
    }

    const turnSignature = response.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.input)}`).join("|");
    recentCallSignatures.push(turnSignature);
    if (detectStuckLoop(recentCallSignatures)) {
      const reason = `Stuck: ${config.agentName} repeated the identical tool call (${turnSignature.slice(0, 150)}) 3 turns in a row with no progress — stopped early instead of grinding to the ${effectiveMaxIterations}-iteration cap.`;
      console.log(`[${config.agentName}:claude-agent] ${reason}`);
      await saveHistory();
      return { success: false, summary: reason, filesWritten, iterations, errors: [...errors, reason] };
    }

    // Execute all tool calls — same switch as loop.ts's runAgent(), reusing
    // the exact same execXxx functions.
    const toolResultBlocks: ClaudeContentBlockParam[] = [];
    for (const call of response.toolCalls) {
      const toolName = call.name;
      const args = call.input;

      console.log(`[${config.agentName}:claude-agent] Tool call: ${toolName}(${JSON.stringify(args).slice(0, 120)})`);

      let result: Record<string, any>;

      if (config.readOnly && READONLY_BLOCKED_TOOLS.has(toolName)) {
        result = readOnlyToolBlockedResult(toolName);
      } else if (config.blockedTools?.includes(toolName)) {
        result = { status: "error", summary: `${toolName} is not available in this run: you work at the same time as other helpers in the same folder, and this tool would affect their work. Do your own task; the lead handles the rest.` };
      } else switch (toolName) {
        case "write_file": {
          const writeArgs = args as { path: string; content: string };
          emitEvent({ type: "tool_call", tool: "write_file", input: { path: writeArgs.path, bytes: writeArgs.content.length } });
          const r = execWriteFile(config.sandboxDir, writeArgs, config.writableFile);
          if (r.status === "success") filesWritten.push(writeArgs.path);
          emitEvent({ type: "tool_result", tool: "write_file", status: r.status, path: writeArgs.path });
          result = r;
          break;
        }
        case "read_files": {
          result = execReadFiles(config.sandboxDir, args as { paths: string[] }, ledger, config.readOnlyDirs);
          break;
        }
        case "read_file": {
          emitEvent({ type: "tool_call", tool: "read_file", input: { path: (args as { path: string }).path } });
          result = execReadFile(config.sandboxDir, args as { path: string; offset?: number; limit?: number }, ledger, config.readOnlyDirs);
          break;
        }
        case "list_files": {
          result = execListFiles(config.sandboxDir, args as { dir?: string; recursive?: boolean }, config.readOnlyDirs);
          break;
        }
        case "edit_files": {
          const r = execEditFiles(config.sandboxDir, args as { edits: Array<{ path: string; old_str: string; new_str: string }> }, config.writableFile);
          for (const path of r.paths) trackWrittenFile(filesWritten, "edit_file", { path }, "success");
          result = r;
          break;
        }
        case "edit_file": {
          const editArgs = args as { path: string; old_str: string; new_str: string };
          emitEvent({ type: "tool_call", tool: "edit_file", input: { path: editArgs.path } });
          result = execEditFile(config.sandboxDir, editArgs, config.writableFile);
          trackWrittenFile(filesWritten, "edit_file", editArgs, result.status);
          emitEvent({ type: "tool_result", tool: "edit_file", status: result.status, path: editArgs.path });
          break;
        }
        case "delete_file": {
          const delArgs = args as { path: string };
          emitEvent({ type: "tool_call", tool: "delete_file", input: { path: delArgs.path } });
          result = execDeleteFile(config.sandboxDir, delArgs, config.writableFile);
          trackWrittenFile(filesWritten, "delete_file", delArgs, result.status);
          break;
        }
        case "run_command": {
          const commandArgs = args as { command: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "run_command", input: commandArgs });
          result = await execRunCommand(config.sandboxDir, commandArgs, ledger, config.writableFile, config.readOnlyDirs);
          emitEvent({ type: "tool_result", tool: "run_command", status: result.status, summary: result.summary, output: (result.output ?? "").slice(0, 500) });
          if (result.status === "error" && config.enableWebSearch) {
            const errorSnippet = (result.output ?? result.summary ?? "").slice(0, 150);
            emitEvent({ type: "repair", status: "searching", errorSnippet: errorSnippet.slice(0, 150) });
            result.next_actions = [
              `SELF-REPAIR: use web_search immediately with the exact error: "${errorSnippet}" — find the fix, apply it, THEN retry the command.`,
              ...(result.next_actions ?? []),
            ];
          }
          break;
        }
        case "http_request": {
          const httpArgs = args as { method: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "http_request", input: { method: httpArgs.method, url: httpArgs.url } });
          result = await execHttpRequest(httpArgs, ledger);
          emitEvent({ type: "tool_result", tool: "http_request", status: result.status, summary: result.summary });
          break;
        }
        case "docker_compose": {
          const dockerArgs = args as { action: "up" | "down" | "logs" | "ps"; service?: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "docker_compose", input: dockerArgs });
          result = await execDockerCompose(config.sandboxDir, dockerArgs);
          emitEvent({ type: "tool_result", tool: "docker_compose", status: result.status, summary: result.summary });
          break;
        }
        case "load_skill": {
          const skillArgs = args as { name: string; file?: string };
          result = loadSkillText(skillArgs.name, skillArgs.file);
          break;
        }
        case "report_blocked": {
          result = recordBlocked(config.projectId, config.agentName, args as { owner?: string; what?: string; checked?: string });
          break;
        }
        case "settle_dispute": {
          result = recordVerdict(config.projectId, args as { number?: number; verdict?: string; evidence?: string });
          break;
        }
        case "dispute_finding": {
          result = recordDispute(config.projectId, config.agentName, args as { finding?: string; checked?: string; observed?: string });
          if (result.status === "success") disputesRecorded++;
          break;
        }
        case "web_search": {
          const searchArgs = args as { query: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "web_search", input: { query: searchArgs.query } });
          result = await execWebSearch(searchArgs);
          emitEvent({ type: "tool_result", tool: "web_search", status: result.status, summary: result.summary });
          break;
        }
        case "screenshot": {
          const ssArgs = args as { url: string; outputPath: string };
          emitEvent({ type: "tool_call", tool: "screenshot", input: ssArgs });
          result = await execScreenshot(ssArgs, undefined, config.sandboxDir);
          emitEvent({ type: "tool_result", tool: "screenshot", status: result.status, summary: result.summary, outputPath: ssArgs.outputPath });
          break;
        }
        case "task_complete": {
          // 2026-10-04: a judge's summary must carry its verdict in the required format — see enforce/summary-format.ts.
          {
            const badSummary = summaryRejection(config.summaryMustMatch, String((args as { summary?: string }).summary ?? ""));
            if (badSummary) {
              result = { status: "error", summary: badSummary };
              break;
            }
          }
          // 2026-10-04: a judge of how a page looks must have been shown a picture — see enforce/images-seen.ts.
          {
            const noImages = imagesSeenRejection(config.requireImagesSeen, imagesSeen);
            if (noImages) {
              result = { status: "error", summary: noImages };
              break;
            }
          }
          // 2026-10-04: a fix run must fix, dispute or hand on — see enforce/fix-accounting.ts.
          const unaccounted = config.enableEscalation
            ? fixRunUnaccounted({ filesWritten: filesWritten.length, disputes: disputesRecorded, escalations: 0 })
            : null;
          if (unaccounted) {
            result = { status: "error", summary: unaccounted };
            break;
          }
          const a = args as { summary: string; files_written: string[]; verification_passed: boolean };
          // Phase 5 Task 3: same default-FAIL completion gate as loop.ts —
          // rejection falls through to the normal tool-result path (no
          // early return) so it counts toward MAX_ITERATIONS.
          // Required checks the agent skipped are run by the system first
          // (enforce/auto-checks.ts) — a finished job is not thrown away
          // for a check nobody ran.
          const autoCheckFailures = await runMissingRequiredChecks(config.sandboxDir, ledger, config.requiredVerificationCommands);
          const check = config.skipEvidenceGate ? ({ allowed: true } as const) : checkCompletion(
            ledger,
            { summary: a.summary, filesWritten: a.files_written ?? [], verificationPassed: a.verification_passed },
            config.requiredVerificationCommands,
            config.requiredEvidenceKinds,
            config.allowFailedVerification,
            config.requiredEvidenceCounts,
          );
          if (!check.allowed) {
            console.log(`[${config.agentName}:claude-agent] task_complete REJECTED on iteration ${iterations}: ${check.reason}`);
            result = { status: "error", summary: autoCheckFailures.length > 0 ? [check.reason, ...autoCheckFailures].join("\n") : check.reason };
            break;
          }
          // 2026-10-24: the system's own checks for this agent's work (e.g. the frontend builder's emoji, dead-button and
          // spec-colour checks) run before it may finish; what they find goes back to it to fix first.
          const exitFailures = config.exitChecks ? await config.exitChecks() : [];
          if (exitFailures.length > 0) {
            console.log(`[${config.agentName}:claude-agent] task_complete REJECTED on iteration ${iterations}: ${exitFailures.length} problem(s) found by the system's own checks`);
            result = { status: "error", summary: `Not done yet: the system's own checks found ${exitFailures.length} problem(s) in your files. Fix each one, then call task_complete again:\n${exitFailures.map((f) => `- ${f}`).join("\n")}` };
            break;
          }
          ledger.consume();
          console.log(`[${config.agentName}:claude-agent] DONE after ${iterations} iterations. Verified: ${a.verification_passed}`);
          if (!a.verification_passed) {
            errors.push("Agent completed without verification passing");
          }
          await saveHistory();
          return {
            success: a.verification_passed,
            summary: a.summary,
            filesWritten: [...filesWritten, ...(a.files_written ?? [])].filter((v, i, arr) => arr.indexOf(v) === i),
            iterations,
            errors,
          };
        }
        case "db_query": {
          result = await execDbQuery(args as { query: string });
          break;
        }
        default: {
          if (browserToolset && BROWSER_TOOL_NAMES.has(toolName)) {
            result = await browserToolset.exec(toolName, args as Record<string, unknown>);
          } else {
            result = { status: "error", summary: `Unknown tool: ${toolName}` };
          }
        }
      }

      // 2026-07-28: real bug found live — "screenshot"/"browser_screenshot"
      // returned only a text path; no image bytes ever reached a model, so
      // every "visual" QA judgment was DOM/text-only (a build with sitewide
      // corrupted-glyph text scored 7.47/10 against a 7.0 bar as direct
      // proof — .nexsidi/sdd/agent-autonomy-assessment-2026-07-26.md, F9).
      // Anthropic's documented shape for a tool that returns an image is a
      // tool_result whose `content` is an array of blocks (text + image),
      // not a bare string — see ToolResultBlockParam.content in the SDK.
      blockedTracker.observe(result);
      if (isProgressStep(toolName, result, args, config.requiredVerificationCommands)) stepBudget.noteProgress(iterations);
      const imagePaths = screenshotImagePathsFor(toolName, result);
      if (imagePaths.length > 0) {
        const imageBlocks: Array<{ type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } }> = [];
        for (const imagePath of imagePaths) {
          try {
            imageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(imagePath).toString("base64") } });
            imagesSeen++;
          } catch (err) {
            console.error(`[${config.agentName}:claude-agent] Failed to read screenshot for vision attachment (${imagePath}): ${String(err)}`);
          }
        }
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: imageBlocks.length > 0 ? [{ type: "text", text: JSON.stringify(result) }, ...imageBlocks] : JSON.stringify(result),
        });
      } else {
        toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
      }
    }

    const budgetNotice = stepBudgetNotice(iterations, stepBudget.max);
    if (budgetNotice) toolResultBlocks.push({ type: "text", text: budgetNotice });
    const blockedNotice = blockedTracker.takeNotice();
    if (blockedNotice) toolResultBlocks.push({ type: "text", text: blockedNotice });
    messages.push({ role: "user", content: toolResultBlocks });
    await saveHistory(); // every step is recorded

    // Every agent does only its own work: a run that keeps hitting other
    // agents' work stops here (its work is saved) and Tilotma is told.
    if (blockedTracker.shouldStop) {
      const reason = blockedTracker.stopSummary();
      recordBlocked(config.projectId, config.agentName, { owner: "tilotma", what: reason, checked: "The refused actions are in this agent's saved history." });
      return { success: false, summary: reason, filesWritten, iterations, errors: [...errors, reason], escalationReason: "blocked" };
    }

    // Proactively compact history if it grows too large. 2026-09-26: this
    // never fired before (the token estimate was blind to Claude's block
    // content); compactHistory now handles this shape directly, no casts.
    const { compactHistory } = await import("./compaction.ts");
    messages = await compactHistory(messages);
  }

  await saveHistory();
  return {
    success: false,
    summary: abortedOnUnrecoverableError
      ? "Aborted early: hit an unrecoverable error (quota exhaustion, auth failure, or permission denied)"
      : `Max iterations (${stepBudget.max}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: abortedOnUnrecoverableError ? errors : [...errors, "Max iterations exceeded"],
  };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (browserToolset) await browserToolset.close();
  }
}

// ── Escalation wrapper ──────────────────────────────────────────────────────

export interface AgentEscalationDeps {
  runNim: (config: AgentRunConfig) => Promise<AgentRunResult>;
  runClaude: (config: AgentRunConfig) => Promise<AgentRunResult>;
}

/**
 * Runs the normal NIM path first (runAgent). If it fails
 * (result.success === false), logs the escalation trigger and retries the
 * SAME task once against Claude (runAgentWithClaude) — a one-time retry, not
 * a loop. Returns whichever attempt succeeded:
 *   - NIM succeeds on its own -> escalated: false, Claude is never called.
 *   - NIM fails, Claude succeeds -> escalated: true, Claude's result.
 *   - Both fail -> escalated: true, Claude's result (the more capable
 *     model's failure is more informative than NIM's).
 *
 * `deps` defaults to the real runAgent/runAgentWithClaude; tests inject
 * stubs — same pattern as pipeline/orchestrator/run.ts's
 * runPipelineWithStages and stage6-deployment.ts's injectable `deps`.
 */
// 2026-07-06: Claude on Vertex is blocked project-wide by Google's
// partner-model sales gating — every Claude model on this GCP project
// either has 0 quota or isn't Model-Garden-enabled at all (verified live via
// raw curl against the documented endpoint, see gemini.ts's header comment).
// Gemini has no such gating and was confirmed working live. ESCALATION_PROVIDER
// swaps the second-tier model per environment without touching
// runAgentEscalated's own orchestration logic below.
//
// 2026-09-28 (Amit): Claude is a feature flag, OFF unless CLAUDE_ENABLED=true —
// see ./claude-flag.ts. While off, every escalation goes to Gemini.
export { isClaudeEnabled };

export function escalationProviderName(): "Claude" | "Gemini" {
  return usesClaude() ? "Claude" : "Gemini";
}

export function resolveEscalationRunner(): (config: AgentRunConfig) => Promise<AgentRunResult> {
  return usesClaude() ? runAgentWithClaude : runAgentWithGemini;
}

// A model the NIM loop (loop.ts runAgent) can actually call — Gemini and
// local Ollama models are served elsewhere, retired ones are dropped.
// NIM_ENABLED=false (llm-client isNimEnabled) leaves only local tool-capable
// Ollama models.
function nimCallable(config: AgentRunConfig): string[] {
  const chain = sanitizeModelChain([config.model, ...(config.fallbackModels ?? [])]);
  return isNimEnabled() ? chain : chain.filter((m) => toolChatProviderFor(m) === "ollama");
}

export async function runAgentEscalated(
  config: AgentRunConfig,
  deps: AgentEscalationDeps = { runNim: runAgent, runClaude: resolveEscalationRunner() },
): Promise<AgentRunResult & { escalated: boolean }> {
  // 2026-09-28: no NIM model configured (all were retired) — the provider IS
  // this agent's normal path, so run it directly instead of running the NIM
  // loop just to fail and "escalate".
  if (nimCallable(config).length === 0) {
    console.log(`[${config.agentName}] no NIM model configured — running on ${escalationProviderName()}`);
    return { ...(await deps.runClaude(config)), escalated: false };
  }

  // 2026-10-01: only the NIM leg gets a time budget — Gemini is behind it.
  const nimResult = await deps.runNim({ ...config, timeBudgetMs: nimTimeBudgetMs() });

  if (nimResult.success) {
    return { ...nimResult, escalated: false };
  }

  // A run stopped for repeatedly reaching into other agents' work is not
  // handed to another model — the same wall would stop it too.
  if (nimResult.escalationReason === "blocked") {
    return { ...nimResult, escalated: false };
  }

  // A run that was cancelled (activity timed out or was cancelled) is not
  // rescued by the provider — that would restart the cancelled work in a
  // second agent beside the retry.
  if (runStopReason(config)) {
    return { ...nimResult, escalated: false };
  }

  // Phase 5 Task 4: nexsidi-token-budget requires every escalation logged
  // with cause, not just that it happened.
  console.log(
    `[${config.agentName}:escalation] NIM path failed (success=false) after ${nimResult.iterations} iterations — ` +
      `reason: ${nimResult.escalationReason ?? "cannot_finish"} — escalating to ${escalationProviderName()} as one-time retry`,
  );

  const claudeConfig: AgentRunConfig = { ...config, initialMessage: buildEscalationMessage(config.initialMessage, nimResult) };
  const claudeResult = await deps.runClaude(claudeConfig);
  return { ...claudeResult, escalated: true };
}
