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
  routeToolsWithFallback,
  translateNimToolToGeminiTool,
  geminiCreateCachedContent,
  type GeminiMessage,
  type GeminiToolDef,
  type GeminiPart,
  type GeminiTier,
} from "@nexsidi/llm-client";
import { runAgent, buildToolList, evaluateCommandStrike, MAX_ITERATIONS, type AgentRunConfig, type AgentRunResult } from "./loop.ts";
import { compactGeminiHistory } from "./compaction.ts";
import { createStrikeCounter } from "./enforce/strikes.ts";
import { detectStuckLoop } from "./enforce/stuck-loop.ts";
import { execWriteFile, execWriteFiles, execReadFile, execListFiles, execEditFile, execDeleteFile, execRollbackWorkspace, execQuerySymbol } from "./tools/file.ts";
import { execRunCommand } from "./tools/command.ts";
import { execHttpRequest } from "./tools/http.ts";
import { execDockerCompose } from "./tools/docker.ts";
import { execWebSearch } from "./tools/websearch.ts";
import { execFetchUrl } from "./tools/research.ts";
import { recordEscalation, type Escalation } from "./tools/escalate.ts";
import { execScreenshot } from "./tools/screenshot.ts";
import { BrowserToolset, BROWSER_TOOL_NAMES } from "./tools/browser.ts";
import { readFileSync } from "node:fs";
import { execDbQuery } from "./tools/db.ts";
import { createEvidenceLedger } from "./enforce/evidence.ts";
import { checkCompletion } from "./enforce/completion-gate.ts";
import { assembleSystemPrompt } from "./prompt-assembly.ts";

export type { AgentRunConfig, AgentRunResult } from "./loop.ts";

// 2026-07-24 (W0.3): replaced the old reactive 720K-token hard-drop with a
// proactive check before every model call. But 40K over-corrected: verified
// live against Amit's own model docs (gemini_3_1_pro.md / _3_5_flash.md /
// _3_6_flash.md — all read in full from E:/ai yug/) that every provisioned
// model has a **1M-token input window**. 40K was 4% of that — the agent was
// made amnesiac every ~40K tokens, which is the root cause of the "fixes one
// thing, breaks another" oscillation the audit documented (a summarized-away
// earlier decision gets silently re-broken). Raised to ~750K: still leaves
// headroom under 1M for the current turn's output + tool schemas, but keeps
// working context intact for the length of one real generation run
// (measured full runs: 190-311K tokens — this threshold now sits comfortably
// above that instead of triggering on every turn).
//
// This does NOT abandon cost control — that job moves to two other levers,
// not raw history truncation: explicit prompt caching (geminiCreateCachedContent,
// wired below) makes the repeated stable prefix (system prompt + build plan)
// cheap to resend, and 2.5.3's relevant-context selection (only the task,
// touched files, open findings — not the full transcript) is the intended
// long-term replacement for "compact by token count" entirely.
const COMPACTION_THRESHOLD_TOKENS = 750_000;

// Same category of error as claude-loop.ts's isUnrecoverableClaudeError —
// auth/permission failures on Gemini will repeat identically on every retry
// within the same run, so the loop should abort early instead of burning the
// full MAX_ITERATIONS budget. Gemini quota exhaustion is NOT included here
// on purpose: unlike Claude on this project, Gemini has real granted quota
// (confirmed live) — a 429 here would be a genuinely transient rate spike,
// not a permanent wall, so it stays in the retry path.
// 2026-07-25 (Phase 2.5.1, full MVP upgrade): a third error category,
// distinct from both the retry-as-is path (transient/429) and the abort
// path (isUnrecoverableGeminiError). Proactive compaction (COMPACTION_
// THRESHOLD_TOKENS, checked above before every call) makes this rare in
// practice, but is not a hard guarantee — a single turn's tool outputs
// could still push a request over the limit between one compaction check
// and the next. Confirmed by reading Amit's own model docs (gemini_3_1_pro.md
// / _3_5_flash.md / _3_6_flash.md / _2_5_flash_lite.md, E:/ai yug/): every
// currently provisioned model shares the SAME 1M input / 64k output limit —
// there is no smaller-context/larger-context model in the fleet to switch
// to, so "switch model for more headroom" is not meaningful today. What IS
// meaningful and was previously missing: on a genuine context-exceeded
// response, retrying with the IDENTICAL oversized history (the old
// behavior — sleep 5s, continue) fails identically forever, silently
// grinding to MAX_ITERATIONS. Detect it and force emergency compaction
// instead.
export function isContextLengthExceededError(err: unknown): boolean {
  const message = String(err).toLowerCase();
  return (
    message.includes("token count exceeds") ||
    message.includes("exceeds the maximum number of tokens") ||
    (message.includes("input token count") && message.includes("exceed")) ||
    message.includes("context length") ||
    message.includes("context_length_exceeded")
  );
}

export function isUnrecoverableGeminiError(err: unknown): boolean {
  const message = String(err);
  return (
    message.includes("UNAUTHENTICATED") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("no access token") ||
    message.includes("application-default login")
  );
}

// 2026-08-04: real bug found live (project verify057463) — when EVERY model
// in a tier's pool has its circuit breaker OPEN, routeToolsWithFallback
// throws "all pool models exhausted" — but the generic catch-all error path
// (sleep 5s, continue) treated it identically to a single transient
// failure. A circuit that's OPEN doesn't clear in 5 seconds, so the retry is
// guaranteed to fail the exact same way every time — the loop ground through
// all 60 iterations (~8.3 minutes) before finally giving up. Distinct from a
// single-model 429 (where a fallback in the pool can still succeed), this
// specific shape means NOTHING in the pool can serve the request right now —
// same "stop wasting iterations on a call that can't work as-is" reasoning
// isUnrecoverableGeminiError already applies to auth failures.
export function isAllPoolModelsExhaustedError(err: unknown): boolean {
  return String(err).includes("all pool models exhausted");
}

// 2026-07-28: real bug found live — "screenshot"/"browser_screenshot" saved
// a PNG to disk and returned only a text path in their tool result; no
// image bytes were ever sent to any model, so the "visual" QA agents
// (Tier-3, live-eval) judged DOM/text only. Confirmed live: a build with
// sitewide corrupted-glyph text scored 7.47/10 against a 7.0 pass bar
// because nothing ever actually looked at a pixel
// (.nexsidi/sdd/agent-autonomy-assessment-2026-07-26.md, F9). Pure and
// exported for direct unit testing without a real screenshot/filesystem.
const SCREENSHOT_TOOL_NAMES = new Set(["screenshot", "browser_screenshot"]);

export function screenshotImagePathFor(toolName: string, result: Record<string, any>): string | null {
  if (!SCREENSHOT_TOOL_NAMES.has(toolName)) return null;
  if (result?.status !== "success") return null;
  return typeof result?.output === "string" ? result.output : null;
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
        loadedFromDb = true;
        console.log(`[${config.agentName}:gemini-agent] Loaded existing conversation history (${messages.length} messages) from database`);
        // 2026-07-24 (W0.3): this load was previously UNBOUNDED — the entire
        // persisted transcript (measured up to 820 messages / ~300K tokens
        // on a resumed code-fix) was re-sent verbatim on the very first call
        // of the resumed run. Compact immediately on load, before appending
        // the new turn, so a resume never starts from an oversized history.
        messages = await compactGeminiHistory(messages, undefined, COMPACTION_THRESHOLD_TOKENS);
        messages.push({ role: "user", content: config.initialMessage });
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
  const escalations: Escalation[] = [];
  const errors: string[] = [];
  let iterations = 0;
  const effectiveMaxIterations = config.maxIterations ?? MAX_ITERATIONS;
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
  // 2026-07-12: real bug found live — the existing strike counter
  // (evaluateCommandStrike, below) only fires on a run_command call FAILING
  // identically. It never catches a call that keeps SUCCEEDING without
  // making progress (read_file on the same path, docker_compose logs on the
  // same service) — that grinds silently to MAX_ITERATIONS with no
  // diagnostic. Same detectStuckLoop used in qa-loop.ts for Navya/Karan/
  // Deepika, applied here so Shubham/Aanya/Riya get the same early exit.
  const recentCallSignatures: string[] = [];

  // 2026-07-25 (Phase 1): per-agent tier — see loop.ts's geminiTier comment
  // for why this is a bare string there. Unset defaults to "generation",
  // preserving every existing caller's behavior.
  const tier = (config.geminiTier ?? "generation") as GeminiTier;

  console.log(`[${config.agentName}:gemini-agent] Starting — model: ${config.geminiModel ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash"}, tier: ${tier}, maxIter: ${effectiveMaxIterations}`);

  // 2026-07-25 (Phase 0.4, second bug found LIVE on the same nextech10 run):
  // Vertex's cachedContents API binds a cache to ONE exact model — sending
  // it as `cachedContent` on a request to a DIFFERENT model 400s. But
  // routeToolsWithFallback resolves the model dynamically from a tier pool
  // with zero-wait fallback (poolForTier) — the model actually used for any
  // given call can differ turn to turn, and is never known at cache-creation
  // time for a tier-routed agent. Confirmed live: every explicit cache
  // creation this run targeted the stale "gemini-3.5-flash" default
  // (resolveGeminiModel's hardcoded fallback) regardless of the agent's
  // real tier (Aanya on "design" → gemini-3.1-pro-preview, Shubham on
  // "generation" → gemini-3.6-flash) — a cache that could never have been
  // reused by the model that actually served the request.
  //
  // Fix: only attempt EXPLICIT caching when config.geminiModel is a fixed,
  // known-in-advance model (the one case where the bound model is certain).
  // For tier-routed agents (the common case now), skip it — Vertex's
  // IMPLICIT caching already applies automatically to any repeated
  // byte-identical prefix with no wiring needed, and is confirmed working:
  // this same nextech10 run showed real non-zero `(N cached)` hits via
  // implicit caching throughout, on gemini-3.1-pro-preview specifically.
  let cachedContentHandle: string | undefined;
  if (config.geminiModel) {
    try {
      const handle = await geminiCreateCachedContent(systemPrompt, config.initialMessage, { model: config.geminiModel });
      cachedContentHandle = handle.name;
      console.log(`[${config.agentName}:gemini-agent] Created prompt cache: ${handle.name}`);
    } catch (err) {
      console.log(`[${config.agentName}:gemini-agent] Prompt cache creation skipped (falling back to uncached): ${String(err)}`);
    }
  }

  // Interactive-browser QA session (Tilotma Tier 3) — same lifecycle as
  // loop.ts: lazily spawned, closed in the finally on every exit path.
  const browserToolset = config.enableBrowser ? new BrowserToolset() : null;
  try {
  while (iterations < effectiveMaxIterations) {
    iterations++;
    console.log(`[${config.agentName}:gemini-agent] Iteration ${iterations}`);

    // 2026-07-24 (W0.3): proactive compaction, checked BEFORE the call it
    // protects — the old approach only reacted to the PREVIOUS response's
    // promptTokens, so the request that first crossed the threshold was
    // always sent in full anyway. Checking here means no call this loop
    // makes exceeds the threshold in the first place.
    messages = await compactGeminiHistory(messages, undefined, COMPACTION_THRESHOLD_TOKENS);

    let response;
    try {
      // 2026-07-24 (W0.2)/2026-07-25 (Phase 1): route through the agent's
      // assigned tier pool instead of calling geminiChatWithTools directly
      // with only config.geminiModel — which silently resolved to
      // gemini-3.5-flash (resolveGeminiModel's hardcoded default) whenever
      // GEMINI_GENERATION_MODEL was unset. config.geminiModel still wins
      // when set — poolForTier collapses to that single model, no pool
      // fallback. cachedContentHandle (Phase 0.4) is passed through so a
      // cache hit is possible on every turn, not just the first.
      response = await routeToolsWithFallback(tier, messages, tools, { model: config.geminiModel, cachedContent: cachedContentHandle, agentName: config.agentName });
      if (iterations === 1) {
        console.log(`[${config.agentName}:gemini-agent] model=${response.modelUsed}`);
      }
    } catch (err) {
      if (isUnrecoverableGeminiError(err)) {
        errors.push(`Gemini call failed on iteration ${iterations} with an unrecoverable error — aborting early instead of retrying: ${String(err)}`);
        abortedOnUnrecoverableError = true;
        break;
      }
      if (isAllPoolModelsExhaustedError(err)) {
        errors.push(`Gemini call failed on iteration ${iterations} — every model in the pool is circuit-broken, aborting early instead of grinding to MAX_ITERATIONS on a call that cannot succeed as-is: ${String(err)}`);
        abortedOnUnrecoverableError = true;
        break;
      }
      // 2026-07-25 (Phase 2.5.1): a context-exceeded error retried with the
      // IDENTICAL oversized history (the old behavior below) fails
      // identically forever — this is the "never stop, always send relevant
      // context" fix. Force a much smaller emergency budget (1/10th of the
      // normal proactive threshold) so the next attempt has real headroom,
      // instead of grinding silently to MAX_ITERATIONS on a call that can
      // never succeed as-is.
      if (isContextLengthExceededError(err)) {
        console.log(`[${config.agentName}:gemini-agent] Context length exceeded on iteration ${iterations} — forcing emergency compaction and retrying`);
        messages = await compactGeminiHistory(messages, undefined, Math.floor(COMPACTION_THRESHOLD_TOKENS / 10));
        errors.push(`Context length exceeded on iteration ${iterations} — recovered via emergency compaction: ${String(err)}`);
        continue;
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
          escalations,
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

    const turnSignature = response.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.input)}`).join("|");
    recentCallSignatures.push(turnSignature);
    if (detectStuckLoop(recentCallSignatures)) {
      const reason = `Stuck: ${config.agentName} repeated the identical tool call (${turnSignature.slice(0, 150)}) 3 turns in a row with no progress — stopped early instead of grinding to the ${effectiveMaxIterations}-iteration cap.`;
      console.log(`[${config.agentName}:gemini-agent] ${reason}`);
      await saveHistory();
      return { success: false, summary: reason, filesWritten, iterations, errors: [...errors, reason], escalationReason: "cannot_finish", escalations };
    }

    const responseParts: GeminiPart[] = [];
    for (const call of response.toolCalls) {
      const toolName = call.name;
      const args = call.input;

      console.log(`[${config.agentName}:gemini-agent] Tool call: ${toolName}(${JSON.stringify(args).slice(0, 120)})`);

      let result: Record<string, any>;

      switch (toolName) {
        case "write_file": {
          const r = execWriteFile(config.sandboxDir, args as { path: string; content: string });
          if (r.status === "success") filesWritten.push((args as { path: string }).path);
          result = r;
          break;
        }
        // 2026-07-25 (Phase 2.3): batch write — this is the loop that
        // actually runs in production (GENERATOR_TIER=gemini), so this is
        // the handler that matters for the one-file-per-turn fix. See
        // execWriteFiles's comment in tools/file.ts for the root cause.
        case "write_files": {
          const writeArgs = args as { files: Array<{ path: string; content: string }> };
          const r = execWriteFiles(config.sandboxDir, writeArgs);
          if (r.status === "success" && Array.isArray(writeArgs.files)) {
            for (const f of writeArgs.files) filesWritten.push(f.path);
          }
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
          const r = await execRunCommand(config.sandboxDir, commandArgs, ledger);
          const strike = await evaluateCommandStrike(strikeCounter, commandArgs.command, r);
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
        case "fetch_url": {
          result = await execFetchUrl(args as { url: string; timeout_ms?: number });
          break;
        }
        case "screenshot": {
          result = await execScreenshot(args as { url: string; outputPath: string });
          break;
        }
        case "escalate_finding": {
          const a = args as { target_agent: string; finding: string; reason: string };
          const { escalation, result: escalationResult } = recordEscalation(a);
          escalations.push(escalation);
          console.log(`[${config.agentName}:gemini-agent] Escalated finding to ${escalation.targetAgent}: ${escalation.reason.slice(0, 100)}`);
          result = escalationResult;
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
          );
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
            escalations,
          };
        }
        case "db_query": {
          result = await execDbQuery(args as { query: string });
          break;
        }
        // 2026-07-25 (Phase 2.2): same audit finding as spawn_subagent below
        // — advertised via buildToolList(), no handler here, silently
        // returned "Unknown tool" and burned an iteration. Mirrors loop.ts.
        case "rollback_workspace": {
          result = execRollbackWorkspace(config.sandboxDir);
          break;
        }
        case "query_symbol": {
          result = execQuerySymbol(config.sandboxDir, args as { path: string; symbol: string });
          break;
        }
        // 2026-07-25 (Phase 2.2, full MVP upgrade): was advertised to every
        // Gemini-loop agent via buildToolList() but had no handler here —
        // fell to the `default` case below and returned "Unknown tool:
        // spawn_subagent", burning a paid iteration for nothing every time
        // a model tried to delegate (audit-2026-07-25.md, A.2). Mirrors
        // loop.ts's NIM implementation (same depth cap of 1, same result
        // shape) but recurses into runAgentWithGemini so a generator can
        // hand a disjoint slice of its file manifest to a helper instead of
        // writing everything in one sequential loop — this is the actual
        // parallel-delegation capability the Codex-style doctrine (Phase 4)
        // tells agents to use.
        case "spawn_subagent": {
          const a = args as { subtask: string; agentName: string };
          if ((config.subagentDepth ?? 0) >= 1) {
            result = { status: "error", summary: "Subagent depth limit reached — subagents cannot spawn further subagents." };
            break;
          }
          console.log(`[${config.agentName}:gemini-agent] Spawning subagent "${a.agentName}" to run subtask: ${a.subtask}`);
          try {
            const subagentResult = await runAgentWithGemini({
              agentName: `${config.agentName}-${a.agentName}`,
              model: config.model,
              apiKey: config.apiKey,
              systemPrompt: `You are a specialized subagent named "${a.agentName}" helper spawned by "${config.agentName}". Complete the delegated subtask: "${a.subtask}"`,
              initialMessage: a.subtask,
              sandboxDir: config.sandboxDir,
              projectId: config.projectId,
              enableHttpTools: config.enableHttpTools,
              enableDockerTools: config.enableDockerTools,
              geminiModel: config.geminiModel,
              geminiTier: config.geminiTier,
              subagentDepth: (config.subagentDepth ?? 0) + 1,
            });
            result = {
              status: subagentResult.success ? "success" : "error",
              summary: `Subagent completed with success=${subagentResult.success}`,
              output: subagentResult.summary,
            };
          } catch (err) {
            result = {
              status: "error",
              summary: `Failed to spawn or run subagent: ${String(err)}`,
            };
          }
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

      // Attach the ACTUAL image bytes right after the functionResponse for
      // this call, in the same turn — a text-only "Screenshot saved to X"
      // result is exactly what let a visually-broken build pass QA before
      // (see screenshotImagePathFor's header comment).
      const imagePath = screenshotImagePathFor(toolName, result);
      if (imagePath) {
        try {
          const imageBytes = readFileSync(imagePath);
          responseParts.push({ inlineData: { mimeType: "image/png", data: imageBytes.toString("base64") } });
        } catch (err) {
          console.error(`[${config.agentName}:gemini-agent] Failed to read screenshot for vision attachment (${imagePath}): ${String(err)}`);
        }
      }
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
        : `Max iterations (${effectiveMaxIterations}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: exhaustedThreeStrikes || abortedOnUnrecoverableError ? errors : [...errors, "Max iterations exceeded"],
    ...(exhaustedThreeStrikes ? { escalationReason: "three_strikes" as const } : {}),
    escalations,
  };
  } finally {
    if (browserToolset) await browserToolset.close();
  }
}
