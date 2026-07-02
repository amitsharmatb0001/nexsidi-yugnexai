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
import { execWriteFile, execReadFile, execListFiles } from "./tools/file.ts";
import { execRunCommand } from "./tools/command.ts";
import { execHttpRequest } from "./tools/http.ts";
import { execDockerCompose } from "./tools/docker.ts";
import { execWebSearch } from "./tools/websearch.ts";
import { execScreenshot } from "./tools/screenshot.ts";

export type { AgentRunConfig, AgentRunResult } from "./loop.ts";

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
export async function runAgentWithClaude(config: AgentRunConfig): Promise<AgentRunResult> {
  const claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";

  const nimTools = buildToolList(config);
  const tools: ClaudeToolDef[] = nimTools.map(translateNimToolToClaudeTool);

  const messages: ClaudeMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: config.initialMessage },
  ];

  const filesWritten: string[] = [];
  const errors: string[] = [];
  let iterations = 0;

  console.log(`[${config.agentName}:claude-agent] Starting — model: claude-sonnet-5, maxIter: ${MAX_ITERATIONS}`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`[${config.agentName}:claude-agent] Iteration ${iterations}`);

    let response;
    try {
      response = await claudeChatWithTools(messages, tools, claudeApiKey);
    } catch (err) {
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
          result = execReadFile(config.sandboxDir, args as { path: string; offset?: number; limit?: number });
          break;
        }
        case "list_files": {
          result = execListFiles(config.sandboxDir, args as { dir?: string; recursive?: boolean });
          break;
        }
        case "run_command": {
          result = execRunCommand(config.sandboxDir, args as { command: string; timeout_ms?: number });
          break;
        }
        case "http_request": {
          result = await execHttpRequest(args as { method: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number });
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
    summary: `Max iterations (${MAX_ITERATIONS}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: [...errors, "Max iterations exceeded"],
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
export async function runAgentEscalated(
  config: AgentRunConfig,
  deps: AgentEscalationDeps = { runNim: runAgent, runClaude: runAgentWithClaude },
): Promise<AgentRunResult & { escalated: boolean }> {
  const nimResult = await deps.runNim(config);

  if (nimResult.success) {
    return { ...nimResult, escalated: false };
  }

  console.log(
    `[${config.agentName}:escalation] NIM path failed (success=false) after ${nimResult.iterations} iterations — ` +
      `escalating to Claude (claude-sonnet-5) as one-time retry`,
  );

  const claudeResult = await deps.runClaude(config);
  return { ...claudeResult, escalated: true };
}
