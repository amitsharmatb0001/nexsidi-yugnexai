// Gemini escalation tier — parallel implementation of claude-loop.ts's
// runAgentWithClaude(), calling geminiChatWithTools() instead. Added
// 2026-07-06 after confirming Claude on Vertex is blocked project-wide by
// Google's partner-model sales gating (every Claude model either has 0
// quota or isn't enabled at all — see gemini.ts's header comment for the
// live evidence). Gemini has no such gating on this project and was
// confirmed working live via scripts/ping-gemini.ts before this file was
// written. Same reuse strategy as claude-loop.ts: buildToolList() from
// loop.ts for the shared tool list (incl. task_complete), the SAME
// execWriteFile/execReadFile/etc. tool-execution functions, and the SAME
// MAX_ITERATIONS constant.
import {
  geminiChatWithTools,
  translateNimToolToGeminiTool,
  type GeminiMessage,
  type GeminiToolDef,
  type GeminiPart,
} from "@nexsidi/llm-client";
import { runAgent, buildToolList, MAX_ITERATIONS, type AgentRunConfig, type AgentRunResult } from "./loop.ts";
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

// Same category of error as claude-loop.ts's isUnrecoverableClaudeError —
// auth/permission failures on Gemini will repeat identically on every retry
// within the same run, so the loop should abort early instead of burning the
// full MAX_ITERATIONS budget. Gemini quota exhaustion is NOT included here
// on purpose: unlike Claude on this project, Gemini has real granted quota
// (confirmed live) — a 429 here would be a genuinely transient rate spike,
// not a permanent wall, so it stays in the retry path.
export function isUnrecoverableGeminiError(err: unknown): boolean {
  const message = String(err);
  return (
    message.includes("UNAUTHENTICATED") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("no access token") ||
    message.includes("application-default login")
  );
}

export async function runAgentWithGemini(config: AgentRunConfig): Promise<AgentRunResult> {
  const nimTools = buildToolList(config);
  const tools: GeminiToolDef[] = nimTools.map(translateNimToolToGeminiTool);
  // Phase 5 Task 3: same evidence ledger + completion gate as loop.ts.
  const ledger = createEvidenceLedger();

  // Phase 5 Task 6: same skills-at-runtime injection as loop.ts.
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt });

  const messages: GeminiMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: config.initialMessage },
  ];

  const filesWritten: string[] = [];
  const errors: string[] = [];
  let iterations = 0;
  let abortedOnUnrecoverableError = false;

  console.log(`[${config.agentName}:gemini-agent] Starting — model: gemini-3.5-flash, maxIter: ${MAX_ITERATIONS}`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`[${config.agentName}:gemini-agent] Iteration ${iterations}`);

    let response;
    try {
      response = await geminiChatWithTools(messages, tools);
    } catch (err) {
      if (isUnrecoverableGeminiError(err)) {
        errors.push(`Gemini call failed on iteration ${iterations} with an unrecoverable error — aborting early instead of retrying: ${String(err)}`);
        abortedOnUnrecoverableError = true;
        break;
      }
      errors.push(`Gemini call failed on iteration ${iterations}: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    // Push the full raw parts (not just extracted text) so functionCall
    // parts are preserved for the next turn, mirroring claude-loop.ts's
    // rawContent handling.
    messages.push({ role: "model", content: response.rawParts });

    if (response.toolCalls.length === 0) {
      if (response.stopReason === "STOP" || response.stopReason === null) {
        console.log(`[${config.agentName}:gemini-agent] Model stopped without task_complete — treating as done`);
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

    const responseParts: GeminiPart[] = [];
    for (const call of response.toolCalls) {
      const toolName = call.name;
      const args = call.input;

      console.log(`[${config.agentName}:gemini-agent] Tool call: ${toolName}(${JSON.stringify(args).slice(0, 120)})`);

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
            console.log(`[${config.agentName}:gemini-agent] task_complete REJECTED on iteration ${iterations}: ${check.reason}`);
            result = { status: "error", summary: check.reason };
            break;
          }
          ledger.consume();
          console.log(`[${config.agentName}:gemini-agent] DONE after ${iterations} iterations. Verified: ${a.verification_passed}`);
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

      responseParts.push({ functionResponse: { name: toolName, response: result } });
    }

    messages.push({ role: "user", content: responseParts });
  }

  return {
    success: false,
    summary: abortedOnUnrecoverableError
      ? "Aborted early: hit an unrecoverable error (auth failure or permission denied)"
      : `Max iterations (${MAX_ITERATIONS}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: abortedOnUnrecoverableError ? errors : [...errors, "Max iterations exceeded"],
  };
}
