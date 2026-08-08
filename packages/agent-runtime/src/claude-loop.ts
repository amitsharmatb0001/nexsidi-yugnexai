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
  type ClaudeMessage,
  type ClaudeToolDef,
  type ClaudeContentBlockParam,
} from "@nexsidi/llm-client";
import { runAgent, buildToolList, MAX_ITERATIONS, READONLY_BLOCKED_TOOLS, readOnlyToolBlockedResult, type AgentRunConfig, type AgentRunResult } from "./loop.ts";
import { join } from "path";
import { readFileSync } from "node:fs";
import { runAgentWithGemini, screenshotImagePathFor } from "./gemini-loop.ts";
import { execWriteFile, execReadFile, execListFiles, execEditFile, execDeleteFile } from "./tools/file.ts";
import { execRunCommand } from "./tools/command.ts";
import { execHttpRequest } from "./tools/http.ts";
import { execDockerCompose } from "./tools/docker.ts";
import { execWebSearch } from "./tools/websearch.ts";
import { execScreenshot } from "./tools/screenshot.ts";
import { BrowserToolset, BROWSER_TOOL_NAMES } from "./tools/browser.ts";
import { execDbQuery } from "./tools/db.ts";
import { createEvidenceLedger } from "./enforce/evidence.ts";
import { checkCompletion } from "./enforce/completion-gate.ts";
import { assembleSystemPrompt } from "./prompt-assembly.ts";
import { detectStuckLoop } from "./enforce/stuck-loop.ts";

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
        const logDir = join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", config.projectId!, "logs");
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
      const logDir = join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", config.projectId!, "logs");
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
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt });

  let messages: ClaudeMessage[] = [];
  let loadedFromDb = false;

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
            eq(agentConversations.agentName, config.agentName)
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
              eq(agentConversations.agentName, config.agentName)
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
            agentName: config.agentName,
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
  const errors: string[] = [];
  let iterations = 0;
  const effectiveMaxIterations = config.maxIterations ?? MAX_ITERATIONS;
  let abortedOnUnrecoverableError = false;
  const recentCallSignatures: string[] = [];

  console.log(`[${config.agentName}:claude-agent] Starting — model: claude-sonnet-5, maxIter: ${effectiveMaxIterations}`);

  // Interactive-browser QA session (Tilotma Tier 3) — same lifecycle as
  // loop.ts: lazily spawned, closed in the finally on every exit path.
  const browserToolset = config.enableBrowser ? new BrowserToolset() : null;
  try {
  while (iterations < effectiveMaxIterations) {
    iterations++;
    console.log(`[${config.agentName}:claude-agent] Iteration ${iterations}`);

    let response;
    try {
      response = await claudeChatWithTools(messages, tools, claudeApiKey);
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
      } else switch (toolName) {
        case "write_file": {
          const writeArgs = args as { path: string; content: string };
          emitEvent({ type: "tool_call", tool: "write_file", input: { path: writeArgs.path, bytes: writeArgs.content.length } });
          const r = execWriteFile(config.sandboxDir, writeArgs);
          if (r.status === "success") filesWritten.push(writeArgs.path);
          emitEvent({ type: "tool_result", tool: "write_file", status: r.status, path: writeArgs.path });
          result = r;
          break;
        }
        case "read_file": {
          emitEvent({ type: "tool_call", tool: "read_file", input: { path: (args as { path: string }).path } });
          result = execReadFile(config.sandboxDir, args as { path: string; offset?: number; limit?: number }, ledger);
          break;
        }
        case "list_files": {
          result = execListFiles(config.sandboxDir, args as { dir?: string; recursive?: boolean });
          break;
        }
        case "edit_file": {
          const editArgs = args as { path: string; old_str: string; new_str: string };
          emitEvent({ type: "tool_call", tool: "edit_file", input: { path: editArgs.path } });
          result = execEditFile(config.sandboxDir, editArgs);
          emitEvent({ type: "tool_result", tool: "edit_file", status: result.status, path: editArgs.path });
          break;
        }
        case "delete_file": {
          const delArgs = args as { path: string };
          emitEvent({ type: "tool_call", tool: "delete_file", input: { path: delArgs.path } });
          result = execDeleteFile(config.sandboxDir, delArgs);
          break;
        }
        case "run_command": {
          const commandArgs = args as { command: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "run_command", input: commandArgs });
          result = await execRunCommand(config.sandboxDir, commandArgs, ledger);
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
          result = await execScreenshot(ssArgs);
          emitEvent({ type: "tool_result", tool: "screenshot", status: result.status, summary: result.summary, outputPath: ssArgs.outputPath });
          break;
        }
        case "task_complete": {
          const a = args as { summary: string; files_written: string[]; verification_passed: boolean };
          // Phase 5 Task 3: same default-FAIL completion gate as loop.ts —
          // rejection falls through to the normal tool-result path (no
          // early return) so it counts toward MAX_ITERATIONS.
          const check = checkCompletion(
            ledger,
            { summary: a.summary, filesWritten: a.files_written ?? [], verificationPassed: a.verification_passed },
            config.requiredVerificationCommands,
            config.requiredEvidenceKinds,
            config.allowFailedVerification,
          );
          if (!check.allowed) {
            console.log(`[${config.agentName}:claude-agent] task_complete REJECTED on iteration ${iterations}: ${check.reason}`);
            result = { status: "error", summary: check.reason };
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
      const imagePath = screenshotImagePathFor(toolName, result);
      if (imagePath) {
        try {
          const imageBytes = readFileSync(imagePath);
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: [
              { type: "text", text: JSON.stringify(result) },
              { type: "image", source: { type: "base64", media_type: "image/png", data: imageBytes.toString("base64") } },
            ],
          });
        } catch (err) {
          console.error(`[${config.agentName}:claude-agent] Failed to read screenshot for vision attachment (${imagePath}): ${String(err)}`);
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
        }
      } else {
        toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
      }
    }

    messages.push({ role: "user", content: toolResultBlocks });

    // Proactively compact history if it grows too large
    const { compactHistory } = await import("./compaction.ts");
    messages = (await compactHistory(messages as any)) as any;
  }

  await saveHistory();
  return {
    success: false,
    summary: abortedOnUnrecoverableError
      ? "Aborted early: hit an unrecoverable error (quota exhaustion, auth failure, or permission denied)"
      : `Max iterations (${effectiveMaxIterations}) reached without task_complete`,
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
export function resolveEscalationRunner(): (config: AgentRunConfig) => Promise<AgentRunResult> {
  return process.env.ESCALATION_PROVIDER === "gemini" ? runAgentWithGemini : runAgentWithClaude;
}

export async function runAgentEscalated(
  config: AgentRunConfig,
  deps: AgentEscalationDeps = { runNim: runAgent, runClaude: resolveEscalationRunner() },
): Promise<AgentRunResult & { escalated: boolean }> {
  const nimResult = await deps.runNim(config);

  if (nimResult.success) {
    return { ...nimResult, escalated: false };
  }

  // Phase 5 Task 4: nexsidi-token-budget requires every escalation logged
  // with cause, not just that it happened.
  console.log(
    `[${config.agentName}:escalation] NIM path failed (success=false) after ${nimResult.iterations} iterations — ` +
      `reason: ${nimResult.escalationReason ?? "cannot_finish"} — escalating to Claude (claude-sonnet-5) as one-time retry`,
  );

  const claudeConfig: AgentRunConfig = { ...config, initialMessage: buildEscalationMessage(config.initialMessage, nimResult) };
  const claudeResult = await deps.runClaude(claudeConfig);
  return { ...claudeResult, escalated: true };
}
