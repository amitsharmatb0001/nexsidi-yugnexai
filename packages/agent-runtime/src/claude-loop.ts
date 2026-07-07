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
} from "@nexsidi/llm-client";
import { runAgent, buildToolList, MAX_ITERATIONS, type AgentRunConfig, type AgentRunResult } from "./loop.ts";
import { runAgentWithGemini } from "./gemini-loop.ts";
import { execWriteFile, execReadFile, execListFiles, execEditFile, execDeleteFile } from "./tools/file.ts";
import { execRunCommand } from "./tools/command.ts";
import { execHttpRequest } from "./tools/http.ts";
import { execDockerCompose } from "./tools/docker.ts";
import { execWebSearch } from "./tools/websearch.ts";
import { execScreenshot } from "./tools/screenshot.ts";
import { createEvidenceLedger } from "./enforce/evidence.ts";
import { checkCompletion } from "./enforce/completion-gate.ts";
import { assembleSystemPrompt } from "./prompt-assembly.ts";

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
  const claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";

  const nimTools = buildToolList(config);
  const tools: ClaudeToolDef[] = nimTools.map(translateNimToolToClaudeTool);
  // Phase 5 Task 3: same evidence ledger + completion gate as loop.ts —
  // escalation runs are exactly where evidence enforcement matters most.
  const ledger = createEvidenceLedger();

  // Phase 5 Task 6: same skills-at-runtime injection as loop.ts.
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt });

  const messages: ClaudeMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: config.initialMessage },
  ];

  const filesWritten: string[] = [];
  const errors: string[] = [];
  let iterations = 0;
  let abortedOnUnrecoverableError = false;

  console.log(`[${config.agentName}:claude-agent] Starting — model: claude-sonnet-5, maxIter: ${MAX_ITERATIONS}`);

  while (iterations < MAX_ITERATIONS) {
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

    // Execute all tool calls — same switch as loop.ts's runAgent(), reusing
    // the exact same execXxx functions.
    const toolResultBlocks: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const call of response.toolCalls) {
      const toolName = call.name;
      const args = call.input;

      console.log(`[${config.agentName}:claude-agent] Tool call: ${toolName}(${JSON.stringify(args).slice(0, 120)})`);

      let result: Record<string, unknown>;

      switch (toolName) {
        case "write_file": {
          const r = execWriteFile(config.sandboxDir, args as { path: string; content: string });
          if (r.status === "success") filesWritten.push((args as { path: string }).path);
          result = r;
          break;
        }
        case "read_file": {
          result = execReadFile(config.sandboxDir, args as { path: string; offset?: number; limit?: number }, ledger);
          break;
        }
        case "list_files": {
          result = execListFiles(config.sandboxDir, args as { dir?: string; recursive?: boolean });
          break;
        }
        case "edit_file": {
          result = execEditFile(config.sandboxDir, args as { path: string; old_str: string; new_str: string });
          break;
        }
        case "delete_file": {
          result = execDeleteFile(config.sandboxDir, args as { path: string });
          break;
        }
        case "run_command": {
          result = execRunCommand(config.sandboxDir, args as { command: string; timeout_ms?: number }, ledger);
          break;
        }
        case "http_request": {
          result = await execHttpRequest(args as { method: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number }, ledger);
          break;
        }
        case "docker_compose": {
          result = execDockerCompose(config.sandboxDir, args as { action: "up" | "down" | "logs" | "ps"; service?: string; timeout_ms?: number });
          break;
        }
        case "web_search": {
          result = await execWebSearch(args as { query: string; timeout_ms?: number });
          break;
        }
        case "screenshot": {
          result = await execScreenshot(args as { url: string; outputPath: string });
          break;
        }
        case "task_complete": {
          const a = args as { summary: string; files_written: string[]; verification_passed: boolean };
          // Phase 5 Task 3: same default-FAIL completion gate as loop.ts —
          // rejection falls through to the normal tool-result path (no
          // early return) so it counts toward MAX_ITERATIONS.
          const check = checkCompletion(ledger, { summary: a.summary, filesWritten: a.files_written ?? [], verificationPassed: a.verification_passed });
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
          return {
            success: a.verification_passed,
            summary: a.summary,
            filesWritten: [...filesWritten, ...(a.files_written ?? [])].filter((v, i, arr) => arr.indexOf(v) === i),
            iterations,
            errors,
          };
        }
        default: {
          result = { status: "error", summary: `Unknown tool: ${toolName}` };
        }
      }

      toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  return {
    success: false,
    summary: abortedOnUnrecoverableError
      ? "Aborted early: hit an unrecoverable error (quota exhaustion, auth failure, or permission denied)"
      : `Max iterations (${MAX_ITERATIONS}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: abortedOnUnrecoverableError ? errors : [...errors, "Max iterations exceeded"],
  };
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
