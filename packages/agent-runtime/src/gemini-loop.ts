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
import { runAgent, buildToolList, evaluateCommandStrike, MAX_ITERATIONS, type AgentRunConfig, type AgentRunResult } from "./loop.ts";
import { createStrikeCounter } from "./enforce/strikes.ts";
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

  let messages: GeminiMessage[] = [];
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
        messages = existing[0].messages as GeminiMessage[];
        const sysIdx = messages.findIndex((m) => m.role === "system");
        if (sysIdx >= 0) {
          messages[sysIdx] = { role: "system", content: systemPrompt };
        }
        messages.push({ role: "user", content: config.initialMessage });
        loadedFromDb = true;
        console.log(`[${config.agentName}:gemini-agent] Loaded existing conversation history (${messages.length} messages) from database`);
      }
    } catch (e) {
      console.error(`[${config.agentName}:gemini-agent] Failed to load history:`, e);
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
        console.log(`[${config.agentName}:gemini-agent] Saved conversation history (${messages.length} messages) to database`);
      } catch (e) {
        console.error(`[${config.agentName}:gemini-agent] Failed to save history:`, e);
      }
    }
  };

  const filesWritten: string[] = [];
  const errors: string[] = [];
  let iterations = 0;
  let abortedOnUnrecoverableError = false;
  // 2026-07-11: real bug found live (stress-userupd run) — Shubham burned all
  // 40 iterations without task_complete, and separately without this counter
  // there is nothing to stop a run_command that fails identically over and
  // over from grinding to MAX_ITERATIONS (each iteration is a real paid
  // Gemini call). loop.ts (NIM) already has this wired via
  // evaluateCommandStrike/createStrikeCounter — this ports the same
  // mechanism here since GENERATOR_TIER/ESCALATION_PROVIDER=gemini makes
  // this loop, not loop.ts, the one actually running in production.
  const strikeCounter = createStrikeCounter();
  let exhaustedThreeStrikes = false;
  // 2026-07-12: real bug found live (stress-pro run) — Riya was mid-debugging a
  // real Docker build issue and emitted a TEXT reasoning turn ("let's read
  // frontend/vendor/nexui/package.json next...", literally "keep_thinking:true")
  // with no tool call. The old logic treated any no-tool-call STOP turn as
  // "done" and gave up at iteration 13 of 40, failing the deploy even though
  // the model clearly wanted to continue. A thinking/chatty model reasoning
  // out loud is NOT a stop — nudge it to actually call the next tool, and only
  // give up after several consecutive no-tool-call turns.
  let noToolCallStreak = 0;
  const MAX_NO_TOOL_CALL_TURNS = 3;

  console.log(`[${config.agentName}:gemini-agent] Starting — model: ${config.geminiModel ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash"}, maxIter: ${MAX_ITERATIONS}`);

  // Interactive-browser QA session (Tilotma Tier 3) — same lifecycle as
  // loop.ts: lazily spawned, closed in the finally on every exit path.
  const browserToolset = config.enableBrowser ? new BrowserToolset() : null;
  try {
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`[${config.agentName}:gemini-agent] Iteration ${iterations}`);

    let response;
    try {
      response = await geminiChatWithTools(messages, tools, { model: config.geminiModel });
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

    if (response.content) {
      const thinkingMatch = response.content.match(/<thinking>([\s\S]*?)<\/thinking>/);
      if (thinkingMatch?.[1]) {
        console.log(`[${config.agentName}:gemini-agent] Thinking:\n${thinkingMatch[1].trim()}`);
      } else {
        console.log(`[${config.agentName}:gemini-agent] Response:\n${response.content.trim()}`);
      }
    }

    // Push the full raw parts (not just extracted text) so functionCall
    // parts are preserved for the next turn, mirroring claude-loop.ts's
    // rawContent handling.
    //
    // Real bug found live 2026-07-09 (stress-full-gemini3 run, right after
    // the MAX_TOKENS fix above was added): a response can be truncated so
    // severely that response.rawParts comes back completely empty ([]).
    // Gemini's API requires every content entry in history to have at
    // least one part — pushing an empty-parts "model" turn poisons EVERY
    // subsequent request in this conversation (permanently, since it's
    // never removed from history) with "400 Unable to submit request
    // because it must include at least one parts field", which then
    // exhausts retries and opens the circuit breaker. Fall back to a
    // placeholder text part so the history entry is always valid.
    messages.push({ role: "model", content: response.rawParts.length > 0 ? response.rawParts : [{ text: "(response truncated, no content)" }] });

    // Real bug found live 2026-07-09 (stress-full-gemini run): Gemini
    // returned a truncated response (15,996 output tokens, right at the
    // 16,000-token cap in gemini.ts's geminiChatWithTools) with no tool
    // calls and stopReason "MAX_TOKENS" — falling through to the
    // toolCalls.length===0 branch below, which only recognizes "STOP"/null
    // as done and silently `continue`s for anything else. With NO new
    // guidance added to history, the model just resent the same truncated
    // state every turn — burned 32 of 40 iterations doing nothing before
    // hitting MAX_ITERATIONS. loop.ts's NIM path already handles this
    // (finish_reason === "length") by telling the model to write in
    // smaller pieces; this mirrors that fix for Gemini's MAX_TOKENS reason.
    if (response.toolCalls.length === 0 && response.stopReason === "MAX_TOKENS") {
      errors.push(`Output truncated (stopReason: MAX_TOKENS) on iteration ${iterations}`);
      messages.push({
        role: "user",
        content: "Your previous response was cut off — it was too long. Write large files in smaller pieces (split one write_file into several), or shorten your reasoning before tool calls.",
      });
      continue;
    }

    if (response.toolCalls.length === 0) {
      // No tool call. Nudge the model to actually act rather than assuming it's
      // done — a reasoning-out-loud text turn is not a stop. Give up only after
      // several consecutive no-tool-call turns (a genuinely stuck/looping model).
      noToolCallStreak++;
      if (noToolCallStreak >= MAX_NO_TOOL_CALL_TURNS) {
        console.log(`[${config.agentName}:gemini-agent] ${noToolCallStreak} consecutive no-tool-call turns — giving up`);
        return {
          success: false,
          summary: response.content || "no content",
          filesWritten,
          iterations,
          errors: [...errors, `Agent stopped calling tools for ${noToolCallStreak} turns without calling task_complete`],
        };
      }
      messages.push({
        role: "user",
        content:
          "You wrote a message but did not call any tool. Do NOT just describe what you will do next — actually call the tool now. " +
          "If every step of your task is genuinely complete and verified, call task_complete. Otherwise call the next tool (read_file, run_command, docker_compose, http_request, etc.) to continue.",
      });
      continue;
    }
    noToolCallStreak = 0; // a real tool call resets the streak

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

      responseParts.push({ functionResponse: { name: toolName, response: result } });
    }

    messages.push({ role: "user", content: responseParts });

    // Same rationale as loop.ts: the SAME command failed identically a 4th
    // time after already being told to pivot on strike 3 — stop retrying
    // instead of burning the rest of MAX_ITERATIONS on a failure that won't
    // resolve itself.
    if (exhaustedThreeStrikes) {
      errors.push("Three-strikes exhausted: the same command failed identically 4 times");
      break;
    }
  }

  await saveHistory();
  return {
    success: false,
    summary: exhaustedThreeStrikes
      ? `Three-strikes exhausted (${iterations} real model turns completed)`
      : abortedOnUnrecoverableError
        ? "Aborted early: hit an unrecoverable error (auth failure or permission denied)"
        : `Max iterations (${MAX_ITERATIONS}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: exhaustedThreeStrikes || abortedOnUnrecoverableError ? errors : [...errors, "Max iterations exceeded"],
    ...(exhaustedThreeStrikes ? { escalationReason: "three_strikes" as const } : {}),
  };
  } finally {
    if (browserToolset) await browserToolset.close();
  }
}
