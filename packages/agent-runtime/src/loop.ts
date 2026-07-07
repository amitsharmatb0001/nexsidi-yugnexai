// Real agentic loop using NIM tool calling.
// Replaces the one-shot agentChat() + parse pattern.
// Agents run until they call task_complete or hit MAX_ITERATIONS.

import { nimChatWithTools, type NimToolDef, type NimMessage, type NimToolCall } from "@nexsidi/llm-client";
import { execWriteFile, execReadFile, execListFiles, execEditFile, execDeleteFile, FILE_TOOL_DEFS } from "./tools/file.ts";
import { execRunCommand, COMMAND_TOOL_DEF } from "./tools/command.ts";
import { execHttpRequest, HTTP_TOOL_DEF } from "./tools/http.ts";
import { execDockerCompose, DOCKER_TOOL_DEF } from "./tools/docker.ts";
import { execWebSearch, WEB_SEARCH_TOOL_DEF } from "./tools/websearch.ts";
import { execScreenshot, SCREENSHOT_TOOL_DEF } from "./tools/screenshot.ts";
import { createEvidenceLedger } from "./enforce/evidence.ts";
import { checkCompletion } from "./enforce/completion-gate.ts";
import { createStrikeCounter, buildFailureSignature, type StrikeCounter } from "./enforce/strikes.ts";
import { assembleSystemPrompt } from "./prompt-assembly.ts";
import type { ToolResult } from "./tools/file.ts";
import type { ModelId } from "@nexsidi/llm-client";

// Exported so claude-loop.ts's runAgentWithClaude() can reuse the exact same
// iteration cap instead of redefining it (per Task 15 spec — "same
// MAX_ITERATIONS constant, import it, don't redefine").
export const MAX_ITERATIONS = 40;

export interface AgentRunConfig {
  agentName: string;
  model: ModelId;
  // Optional additional NIM models tried, in order, if `model` fails or its
  // circuit breaker opens — added after stress-test 1 (F7) found the loop had
  // no recovery besides retrying the same broken model until MAX_ITERATIONS,
  // then falling all the way through to Task 15's Claude escalation. Each
  // model in the chain is tried once; once the chain is exhausted, falls back
  // to the original sleep-and-retry-the-last-model behavior. This sits BELOW
  // runAgentEscalated's Claude escalation (packages/agent-runtime/src/claude-
  // loop.ts) — still open-source only, tried before ever reaching for Sonnet 5.
  fallbackModels?: ModelId[];
  apiKey: string;
  systemPrompt: string;
  initialMessage: string;
  sandboxDir: string;         // all file ops scoped here
  enableDockerTools?: boolean; // Riya only
  enableHttpTools?: boolean;   // Shubham verification
  enableWebSearch?: boolean;   // fact-checking / package verification
  enableScreenshot?: boolean;  // visual QA
}

export interface AgentRunResult {
  success: boolean;
  summary: string;
  filesWritten: string[];
  iterations: number;
  errors: string[];
  // Phase 5 Task 4: populated on every success:false exit so
  // runAgentEscalated (claude-loop.ts) can log WHY it's escalating, not just
  // that it is. "three_strikes" = the same command failed identically 4
  // times; "cannot_finish" = any other non-success exit (max iterations,
  // agent stopped without task_complete, transport failures).
  escalationReason?: "three_strikes" | "cannot_finish";
}

// Exported for the same reason as MAX_ITERATIONS above — claude-loop.ts
// reuses this exact contract (translated to Claude's tool format) instead of
// redefining it.
export const TASK_COMPLETE_TOOL: NimToolDef = {
  type: "function",
  function: {
    name: "task_complete",
    description: "Call this when your task is fully done. All files written, all verification passed. Do NOT call this until you have verified the output works (tsc passes, build succeeds, or health check passes).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What you built and what verification you ran" },
        files_written: { type: "array", items: { type: "string" }, description: "List of all file paths written" },
        verification_passed: { type: "boolean", description: "True only if tsc/build/health-check actually passed" },
      },
      required: ["summary", "files_written", "verification_passed"],
    },
  },
};

// Full-system audit T1/L1: replaces any tool_call whose `function.arguments`
// isn't valid JSON with a safe "{}" placeholder, and records which call ids
// were touched. Exists so the CALLER can push only sanitized tool_calls into
// conversation history — never the raw, possibly-truncated-mid-JSON string a
// model produced when it hit the token cap mid-write_file. Pure and
// dependency-free on purpose: directly unit-testable without mocking the
// network (see loop.test.ts).
export function sanitizeToolCalls(toolCalls: NimToolCall[]): { sanitized: NimToolCall[]; malformedIds: Set<string> } {
  const malformedIds = new Set<string>();
  const sanitized = toolCalls.map((call) => {
    try {
      JSON.parse(call.function.arguments);
      return call;
    } catch {
      malformedIds.add(call.id);
      return { ...call, function: { ...call.function, arguments: "{}" } };
    }
  });
  return { sanitized, malformedIds };
}

// Phase 5 Task 4: mechanical 3-strike escalation (Rule 7). Pure and
// dependency-free on purpose, same as sanitizeToolCalls above — the loop
// calls this on every run_command result; a successful result passes
// through untouched. On the 3rd identical failure it injects a forced-pivot
// instruction into next_actions; on the 4th it reports exhausted so the
// caller can terminate the run.
export function evaluateCommandStrike(
  counter: StrikeCounter,
  command: string,
  toolResult: ToolResult,
): { toolResult: ToolResult; exhausted: boolean } {
  if (toolResult.status !== "error") return { toolResult, exhausted: false };

  const signature = buildFailureSignature(command, toolResult.output ?? toolResult.summary);
  const strike = counter.recordFailure(signature);

  if (strike.exhausted) return { toolResult, exhausted: true };

  if (strike.strikes === 3) {
    return {
      toolResult: {
        ...toolResult,
        next_actions: [
          ...(toolResult.next_actions ?? []),
          "This approach failed 3 times with the same error. Do not retry it. Change approach fundamentally or call escalate.",
        ],
      },
      exhausted: false,
    };
  }

  return { toolResult, exhausted: false };
}

export function buildToolList(config: AgentRunConfig): NimToolDef[] {
  return [
    ...FILE_TOOL_DEFS,
    COMMAND_TOOL_DEF,
    ...(config.enableHttpTools ? [HTTP_TOOL_DEF] : []),
    ...(config.enableDockerTools ? [DOCKER_TOOL_DEF] : []),
    ...(config.enableWebSearch ? [WEB_SEARCH_TOOL_DEF] : []),
    ...(config.enableScreenshot ? [SCREENSHOT_TOOL_DEF] : []),
    TASK_COMPLETE_TOOL,
  ];
}

export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const tools: NimToolDef[] = buildToolList(config);
  // Phase 5 Task 3: per-run ledger backing the completion gate — see
  // enforce/evidence.ts and enforce/completion-gate.ts.
  const ledger = createEvidenceLedger();

  // Phase 5 Task 6: skills injected at runtime — core-reasoning doctrine +
  // this agent's own doctrine (if any) layered ahead of its basePrompt.
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt });

  const messages: NimMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: config.initialMessage },
  ];

  const filesWritten: string[] = [];
  const errors: string[] = [];
  let iterations = 0;
  // Phase 5 Task 4: mechanical 3-strike escalation — see enforce/strikes.ts.
  const strikeCounter = createStrikeCounter();
  let exhaustedThreeStrikes = false;

  const modelChain: ModelId[] = [config.model, ...(config.fallbackModels ?? [])];
  let modelIdx = 0;

  // L3 (full-system audit): `iterations` now counts real model turns only.
  // Previously incremented at the TOP of the loop, so every transport
  // failure + sleep(5s) cycle also consumed the main budget — stress-test
  // runs 3/5/7 showed 30+ "iterations" that were pure sleeps with zero
  // model interaction, exhausting MAX_ITERATIONS on network noise rather
  // than actual agent attempts. Transport failures on the LAST model in the
  // chain now get their own small budget and abort early instead.
  const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 5;
  let consecutiveTransportFailures = 0;
  let abortedOnTransportFailures = false;

  console.log(`[${config.agentName}:agent] Starting — model: ${config.model}, maxIter: ${MAX_ITERATIONS}` +
    (modelChain.length > 1 ? `, fallbacks: ${modelChain.slice(1).join(", ")}` : ""));

  while (iterations < MAX_ITERATIONS) {
    const currentModel = modelChain[modelIdx] ?? config.model;

    let response;
    try {
      response = await nimChatWithTools(currentModel, messages, tools, config.apiKey);
    } catch (err) {
      errors.push(`NIM call failed (model: ${currentModel}): ${String(err)}`);
      if (modelIdx < modelChain.length - 1) {
        modelIdx++;
        // Include the actual error — previously only pushed to the errors
        // array (which callers rarely surface), so run logs showed models
        // "falling back" dozens of times with the REASON invisible, making
        // model-failure diagnosis impossible from logs alone.
        console.log(`[${config.agentName}:agent] ${currentModel} failed (${String(err).slice(0, 300)}) — falling back to next model: ${modelChain[modelIdx]}`);
        continue; // no sleep — a different model's circuit breaker is likely still closed
      }
      consecutiveTransportFailures++;
      if (consecutiveTransportFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
        errors.push(`Aborting after ${MAX_CONSECUTIVE_TRANSPORT_FAILURES} consecutive transport failures on ${currentModel} — not burning the rest of the iteration budget on network noise`);
        abortedOnTransportFailures = true;
        break;
      }
      // Chain exhausted — same original behavior: sleep and retry the last model
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    consecutiveTransportFailures = 0;
    iterations++;
    console.log(`[${config.agentName}:agent] Iteration ${iterations} (model: ${currentModel})`);

    const choice = response.choices[0];
    if (!choice) {
      errors.push(`Empty response on iteration ${iterations}`);
      break;
    }

    // T1 fix: sanitize BEFORE pushing to `messages` — an unparseable
    // arguments string that survives into history poisons every subsequent
    // request (NIM re-validates the full array). Previously the raw
    // tool_calls were pushed here and only checked for valid JSON later, at
    // execution time — too late, the damage to history was already done.
    // Confirmed via stress-test run 5: the same parse error replayed at the
    // identical byte offset for 14 consecutive iterations.
    const { sanitized: sanitizedToolCalls, malformedIds } = sanitizeToolCalls(choice.message.tool_calls ?? []);

    const assistantMsg: NimMessage = {
      role: "assistant",
      content: choice.message.content ?? null,
      tool_calls: sanitizedToolCalls.length > 0 ? sanitizedToolCalls : undefined,
    };
    messages.push(assistantMsg);

    // Output was cut off by the token cap — any tool_calls present may be
    // incomplete even after sanitizing. Tell the model directly instead of
    // silently continuing with truncated state (this is what let a model
    // write half a file, get cut off, and then have no way to know why the
    // next turn's history looked wrong).
    if (choice.finish_reason === "length") {
      errors.push(`Output truncated (finish_reason: length) on iteration ${iterations}`);
      const truncationNotice = "Your previous response was cut off — it was too long. Write large files in smaller pieces (split one write_file into several), or shorten your reasoning before tool calls.";
      if (sanitizedToolCalls.length > 0) {
        for (const call of sanitizedToolCalls) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ status: "error", summary: truncationNotice }) });
        }
      } else {
        messages.push({ role: "user", content: truncationNotice });
      }
      continue;
    }

    // No tool calls — model is done but didn't call task_complete
    if (sanitizedToolCalls.length === 0) {
      if (choice.finish_reason === "stop") {
        console.log(`[${config.agentName}:agent] Model stopped without task_complete — treating as done`);
        return { success: false, summary: choice.message.content ?? "no content", filesWritten, iterations, errors: [...errors, "Agent stopped without calling task_complete"], escalationReason: "cannot_finish" };
      }
      continue;
    }

    // Execute all tool calls
    const toolResults: NimMessage[] = [];
    for (const call of sanitizedToolCalls) {
      if (malformedIds.has(call.id)) {
        toolResults.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ status: "error", summary: "Invalid JSON in tool arguments — retry this call with valid JSON" }) });
        continue;
      }

      const toolName = call.function.name;
      // Safe: sanitizeToolCalls guarantees every non-malformed call's
      // arguments already parsed successfully once.
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;

      console.log(`[${config.agentName}:agent] Tool call: ${toolName}(${JSON.stringify(args).slice(0, 120)})`);

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
          const commandArgs = args as { command: string; timeout_ms?: number };
          const r = execRunCommand(config.sandboxDir, commandArgs, ledger);
          const strike = evaluateCommandStrike(strikeCounter, commandArgs.command, r);
          result = strike.toolResult;
          if (strike.exhausted) exhaustedThreeStrikes = true;
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
          // Phase 5 Task 3: default-FAIL completion gate — rejected without
          // fresh evidence, even if the model claims verification_passed.
          // Rejection falls through to the normal tool-result path below
          // (result assigned, no early return) so it counts toward
          // MAX_ITERATIONS — a model spamming task_complete still terminates.
          const check = checkCompletion(ledger, { summary: a.summary, filesWritten: a.files_written ?? [], verificationPassed: a.verification_passed });
          if (!check.allowed) {
            console.log(`[${config.agentName}:agent] task_complete REJECTED on iteration ${iterations}: ${check.reason}`);
            result = { status: "error", summary: check.reason };
            break;
          }
          ledger.consume();
          console.log(`[${config.agentName}:agent] DONE after ${iterations} iterations. Verified: ${a.verification_passed}`);
          if (!a.verification_passed) {
            errors.push("Agent completed without verification passing");
          }
          return {
            success: a.verification_passed,
            summary: a.summary,
            filesWritten: [...filesWritten, ...(a.files_written ?? [])].filter((v, i, arr) => arr.indexOf(v) === i),
            iterations,
            errors,
            ...(a.verification_passed ? {} : { escalationReason: "cannot_finish" as const }),
          };
        }
        default: {
          result = { status: "error", summary: `Unknown tool: ${toolName}` };
        }
      }

      toolResults.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }

    messages.push(...toolResults);

    // Phase 5 Task 4: the SAME command failed identically a 4th time after
    // already being told to pivot on strike 3 — stop retrying, let
    // runAgentEscalated (claude-loop.ts) fire with a logged reason instead
    // of burning the rest of MAX_ITERATIONS on a failure that won't resolve
    // itself.
    if (exhaustedThreeStrikes) {
      errors.push("Three-strikes exhausted: the same command failed identically 4 times");
      break;
    }
  }

  return {
    success: false,
    summary: exhaustedThreeStrikes
      ? `Three-strikes exhausted (${iterations} real model turns completed)`
      : abortedOnTransportFailures
        ? `Aborted after ${MAX_CONSECUTIVE_TRANSPORT_FAILURES} consecutive transport failures (${iterations} real model turns completed)`
        : `Max iterations (${MAX_ITERATIONS}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: exhaustedThreeStrikes ? errors : [...errors, "Max iterations exceeded"],
    escalationReason: exhaustedThreeStrikes ? "three_strikes" : "cannot_finish",
  };
}
