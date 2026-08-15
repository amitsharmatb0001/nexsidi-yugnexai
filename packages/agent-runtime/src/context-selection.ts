import type { GeminiMessage } from "@nexsidi/llm-client";
import { safeTrailingSlice, estimateGeminiTokenCount } from "./compaction.ts";

// ── Real relevant-context selection (cost-control plan, Task 2) ────────────
//
// See docs/nexsidi/plans/2026-08-11-cost-control.md, "Root cause" and
// "Task 2" sections for full context. Short version: compactGeminiHistory
// (compaction.ts) replaces old history with an LLM-generated prose summary
// — cheap, but LOSSY: a summarizer can drop a specific decision ("switched
// bcryptjs to bcrypt") because it's paraphrasing, not recording. That's what
// made the 2026-07-24 40K-token compaction threshold "amnesiac": a fix
// applied early in a session got summarized away and silently re-broken
// later in the same session.
//
// This module is the alternative described in that plan and in
// gemini-loop.ts's COMPACTION_THRESHOLD_TOKENS comment as the intended
// long-term replacement: a structured, append-only fact ledger (one line per
// fact, never rewritten, never re-summarized) plus a short trailing window of
// raw turns for immediate continuity. Because the ledger is sent in FULL
// every time (it's cheap — one line per entry, not full diffs or raw tool
// output) rather than being re-compressed, a fact recorded once cannot be
// silently dropped by this mechanism the way a prose summary can.
//
// 2026-08-15 (cost-control Task 4): now wired into gemini-loop.ts's actual
// model-calling path via compactViaRelevantContext below, replacing
// compactGeminiHistory as the PRIMARY compaction mechanism at gemini-loop.ts's
// on-load and before-every-call sites. compactGeminiHistory is kept only as
// (a) the genuine emergency fallback on a context-length-exceeded error, and
// (b) the full behavioral revert when the RELEVANT_CONTEXT_SELECTION_ENABLED
// escape hatch is set to "false" — see gemini-loop.ts for both.

export interface FactLedgerEntry {
  type: "file_written" | "fix_applied" | "decision" | "error_resolved";
  file?: string;
  summary: string; // one line, not a paragraph — this is what makes sending the FULL ledger cheap
  turnIndex: number;
}

// Describes what a single tool call in a turn did, in the shape
// gemini-loop.ts already has on hand at the point it processes
// response.toolCalls and their results (see the tool-execution switch in
// runAgentWithGemini). Deliberately loose (`Record<string, any>` for
// args/result) rather than importing gemini-loop.ts's internal per-tool arg
// types — this module must not create a dependency cycle with the loop it
// will eventually be wired into (Task 4), and the inference logic below only
// ever reads a handful of well-known fields defensively.
export interface TurnToolActivity {
  toolName: string;
  args: Record<string, unknown>;
  // Loosely typed to match what gemini-loop.ts actually has on hand
  // (`let result: Record<string, any>`, assembled per-tool by a switch with
  // no shared return type) — every branch does set `status`, but nothing at
  // the type level proves that, so `status` is read defensively below rather
  // than assumed present.
  result: Record<string, any>;
}

const MAX_INLINE_SNIPPET = 80;

function truncate(s: string, max = MAX_INLINE_SNIPPET): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stringField(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

// Infers zero or more FactLedgerEntry objects from a single tool call +
// its result. Read-only / exploratory tools (read_file, list_files,
// query_symbol, ...) intentionally produce no entries — the ledger is for
// facts worth remembering across turns, not a call log.
function inferEntriesForActivity(activity: TurnToolActivity, turnIndex: number, ledgerSoFar: FactLedgerEntry[]): FactLedgerEntry[] {
  const { toolName, args, result } = activity;
  const ok = result.status === "success";

  switch (toolName) {
    case "write_file": {
      if (!ok) return [];
      const path = stringField(args, "path");
      if (!path) return [];
      const content = stringField(args, "content");
      const sizeNote = content ? ` (${content.length} chars)` : "";
      return [{ type: "file_written", file: path, summary: `Wrote ${path}${sizeNote}`, turnIndex }];
    }

    case "write_files": {
      if (!ok) return [];
      const files = Array.isArray(args.files) ? (args.files as Array<{ path?: unknown; content?: unknown }>) : [];
      const entries: FactLedgerEntry[] = [];
      for (const f of files) {
        if (typeof f?.path !== "string") continue;
        const content = typeof f.content === "string" ? f.content : undefined;
        const sizeNote = content ? ` (${content.length} chars)` : "";
        entries.push({ type: "file_written", file: f.path, summary: `Wrote ${f.path}${sizeNote}`, turnIndex });
      }
      return entries;
    }

    case "edit_file": {
      if (!ok) return [];
      const path = stringField(args, "path");
      if (!path) return [];
      const oldStr = stringField(args, "old_str");
      const newStr = stringField(args, "new_str");
      const changeNote = oldStr && newStr ? `: replaced "${truncate(oldStr)}" with "${truncate(newStr)}"` : "";
      return [{ type: "file_written", file: path, summary: `Edited ${path}${changeNote}`, turnIndex }];
    }

    case "delete_file": {
      if (!ok) return [];
      const path = stringField(args, "path");
      if (!path) return [];
      return [{ type: "decision", file: path, summary: `Deleted ${path}`, turnIndex }];
    }

    case "run_command": {
      const command = stringField(args, "command");
      if (!command) return [];

      if (!ok) {
        const detail = result.summary ? `: ${truncate(result.summary, 160)}` : "";
        // `file` carries the exact command string (reusing the ledger's
        // generic resource-identifier field) so a later lookup can match
        // the command exactly instead of prefix/substring-matching the
        // rendered summary text — see the review finding this replaced:
        // `.startsWith("Command failed: bun test")` wrongly matched a
        // failure recorded for "bun test:integration" too, since that
        // string literally starts with "Command failed: bun test". Real
        // command pairs like this exist in this codebase (`bun test` vs
        // `bun test:integration`, `bun run typecheck` vs `bun run
        // typecheck:watch`).
        return [{ type: "decision", file: command, summary: `Command failed: ${command}${detail}`, turnIndex }];
      }

      // Success: check whether this exact command previously failed and
      // hasn't already been recorded as resolved — if so, this turn is the
      // fix taking effect. Scanning the ledger here (not a separate index)
      // keeps the ledger the single source of truth, matching its
      // append-only design — no side-channel state to fall out of sync with it.
      // Match on the exact command via `file` (set above) plus the
      // "Command failed: " summary prefix to stay scoped to run_command
      // failures specifically (other tool cases, e.g. delete_file, also set
      // `file` on their decision entries, to an unrelated file path).
      const lastFailureIdx = [...ledgerSoFar]
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.type === "decision" && e.file === command && e.summary.startsWith("Command failed: "))
        .pop()?.i;
      if (lastFailureIdx === undefined) return [];

      const alreadyResolvedSince = ledgerSoFar
        .slice(lastFailureIdx + 1)
        .some((e) => e.type === "error_resolved" && e.file === command);
      if (alreadyResolvedSince) return [];

      return [{ type: "error_resolved", file: command, summary: `${command} now succeeds (previously failed)`, turnIndex }];
    }

    case "escalate_finding": {
      const finding = stringField(args, "finding") ?? stringField(args, "reason") ?? "escalation raised";
      return [{ type: "decision", summary: `Escalated: ${truncate(finding, 160)}`, turnIndex }];
    }

    case "task_complete": {
      // Unlike every other case above, gemini-loop.ts's task_complete
      // handler does NOT flow a genuine acceptance through this function at
      // all: checkCompletion's default-FAIL gate accepting the call returns
      // straight out of runAgentWithGemini (see the `return { success: ... }`
      // right after `ledger.consume()`), before turnActivity/factLedger
      // ever gets built for that turn. A REJECTED task_complete is the only
      // way this branch is reached — the gate sets `result = { status:
      // "error", summary: check.reason }` and falls through to the shared
      // turnActivity/factLedger code below. So `ok` here is, in practice,
      // always false — but this still checks it explicitly (rather than
      // assuming) so the branch stays correct if that call shape ever
      // changes, and so it never again records a false "Marked complete"
      // for a completion that was actually rejected (the bug this replaced).
      if (ok) {
        const summary = stringField(args, "summary");
        if (!summary) return [];
        return [{ type: "decision", summary: `Marked complete: ${truncate(summary, 160)}`, turnIndex }];
      }
      const reason = typeof result.summary === "string" ? result.summary : "reason unknown";
      return [{ type: "decision", summary: `Completion attempt rejected: ${truncate(reason, 160)}`, turnIndex }];
    }

    default:
      // read_file, list_files, query_symbol, http_request, docker_compose,
      // web_search, fetch_url, screenshot, db_query, rollback_workspace,
      // spawn_subagent, browser tools, etc. — none of these represent a
      // durable fact about the project's code/decisions worth carrying
      // forward forever; they're either read-only or already fully captured
      // by whatever write_file/edit_file/run_command call they lead to.
      return [];
  }
}

/**
 * Append the facts implied by one agent turn's tool activity to the fact
 * ledger. Append-only and immutable: never mutates `ledger`, never removes
 * or rewrites an existing entry. If the turn produced no ledger-worthy
 * facts, returns the SAME array reference (no needless copy, and a clean
 * signal for callers checking whether anything changed).
 *
 * This directly avoids the 2026-07-24 bug class: a fact recorded here can
 * never be "summarized away" on a later turn, because nothing about this
 * function's output is ever fed back through a lossy summarizer — it is
 * only ever added to.
 */
export function appendFactLedgerEntry(
  ledger: FactLedgerEntry[],
  turnIndex: number,
  activity: TurnToolActivity[],
): FactLedgerEntry[] {
  const newEntries: FactLedgerEntry[] = [];
  for (const act of activity) {
    newEntries.push(...inferEntriesForActivity(act, turnIndex, [...ledger, ...newEntries]));
  }
  if (newEntries.length === 0) return ledger;
  return [...ledger, ...newEntries];
}

/**
 * Render the fact ledger as cheap, dense prompt text — one line per entry.
 * Sent in FULL by selectRelevantContext (not sampled/truncated): this is
 * what "cheap" buys — a full session's worth of facts is still only a few
 * hundred bytes per fact, orders of magnitude smaller than resending the
 * raw turns that produced them.
 */
export function formatFactLedgerForPrompt(ledger: FactLedgerEntry[]): string {
  return ledger
    .map((e) => `[turn ${e.turnIndex}] ${e.type}${e.file ? ` (${e.file})` : ""}: ${e.summary}`)
    .join("\n");
}

export interface SelectContextOptions {
  /** How many raw trailing turns (non-system messages) to keep for immediate continuity. Default 6, matching compactGeminiHistory's trailing window. */
  trailingTurnCount?: number;
}

// ── Synthetic-message tagging (review Finding 1 fix) ────────────────────────
//
// Bug this closes: selectRelevantContext's taskMsg/ledgerMsg are ordinary
// `role: "user"` GeminiMessage objects, appended into the array
// compactViaRelevantContext hands back as the new `messages`. On the NEXT
// compaction later in the same session (now the routine case at a 120K
// threshold, not an edge case), this function re-derives `nonSys` by
// filtering `fullHistory` for `role !== "system"` — which can't distinguish
// a genuine conversation turn from a synthetic CURRENT TASK/FACT LEDGER block
// a PRIOR call to this function injected. A small/short trailing window can
// then pull that stale block into the new trailing slice, and this function
// prepends a FRESH task/ledger block on top of it — producing a request with
// "FACT LEDGER" (and "CURRENT TASK") appearing twice: once fresh and
// complete, once stale and incomplete, both claiming to be authoritative.
//
// Fix: tag every synthetic message this function creates, and exclude tagged
// messages from the trailing-window candidate pool before slicing. This is
// safe — not lossy — because the tagged messages carry no information the
// FRESH rebuild doesn't already re-derive as a superset: taskMsg is rebuilt
// from `currentTask` (which gemini-loop.ts documents as constant across a
// run) and the ledger-derived touched-files list; ledgerMsg is rebuilt from
// the full `factLedger`, which only ever grows. Dropping a stale copy of
// either from the trailing pool therefore cannot drop a fact — only a
// duplicate presentation of one.
//
// A plain boolean field (not a Symbol) so it survives the actual persistence
// path: `messages` round-trips through `agentConversations.messages` (jsonb,
// packages/db/src/schema.ts) between a save and a later resumed run, and
// Symbol-keyed properties do not survive JSON.stringify/parse. The marker is
// never sent to the model: buildGeminiContents (llm-client/src/gemini.ts)
// only ever reads `m.role`/`m.content` when assembling the outgoing request,
// so an extra property on the message object is inert there.
const SYNTHETIC_CONTEXT_MARKER = "__nexsidiContextSelectionSynthetic" as const;

type SyntheticGeminiMessage = GeminiMessage & { [SYNTHETIC_CONTEXT_MARKER]?: true };

function markSynthetic(message: GeminiMessage): GeminiMessage {
  return { ...message, [SYNTHETIC_CONTEXT_MARKER]: true } as SyntheticGeminiMessage;
}

function isSyntheticContextMessage(message: GeminiMessage): boolean {
  return (message as SyntheticGeminiMessage)[SYNTHETIC_CONTEXT_MARKER] === true;
}

/**
 * Build the context to actually send to the model for the next call:
 * system prompt + current task brief (task, touched files, open findings)
 * + the FULL fact ledger + only the last N raw turns for immediate
 * continuity (pairing-safe via compaction.ts's safeTrailingSlice — the same
 * Gemini functionCall/functionResponse adjacency requirement applies here,
 * so this reuses that logic rather than reimplementing it).
 *
 * Wired into gemini-loop.ts's live model-calling path as the primary
 * compaction mechanism via compactViaRelevantContext (cost-control Task 4)
 * — see this module's header comment.
 */
export function selectRelevantContext(
  fullHistory: GeminiMessage[],
  currentTask: string,
  touchedFiles: string[],
  openFindings: string[],
  factLedger: FactLedgerEntry[],
  options: SelectContextOptions = {},
): GeminiMessage[] {
  const trailingTurnCount = options.trailingTurnCount ?? 6;

  const sys = fullHistory.filter((m): m is Extract<GeminiMessage, { role: "system" }> => m.role === "system");
  // Exclude synthetic CURRENT TASK/FACT LEDGER blocks a PRIOR compaction
  // injected — see isSyntheticContextMessage's header comment above. Without
  // this, a second-or-later compaction's trailing-window candidate pool can
  // include a stale synthetic block, which then rides along inside `trailing`
  // below and duplicates the fresh one this call is about to build.
  const nonSys = fullHistory.filter((m) => m.role !== "system" && !isSyntheticContextMessage(m));
  const trailing = safeTrailingSlice(nonSys, trailingTurnCount);

  const taskLines = [
    `CURRENT TASK: ${currentTask}`,
    touchedFiles.length > 0 ? `TOUCHED FILES:\n${touchedFiles.map((f) => `- ${f}`).join("\n")}` : null,
    openFindings.length > 0 ? `OPEN FINDINGS:\n${openFindings.map((f) => `- ${f}`).join("\n")}` : null,
  ].filter((l): l is string => l !== null);

  const taskMsg: GeminiMessage = markSynthetic({ role: "user", content: taskLines.join("\n\n") });

  const messages: GeminiMessage[] = [...sys, taskMsg];

  // Omit the ledger message entirely when empty — no empty-section noise in
  // the prompt, and it keeps the "no facts recorded yet" case indistinguishable
  // from extra boilerplate rather than a real section.
  if (factLedger.length > 0) {
    const ledgerMsg: GeminiMessage = markSynthetic({
      role: "user",
      content: `FACT LEDGER (full — every entry below is a fact recorded earlier in this session and is never dropped):\n${formatFactLedgerForPrompt(factLedger)}`,
    });
    messages.push(ledgerMsg);
  }

  messages.push(...trailing);
  return messages;
}

// ── gemini-loop.ts wiring helpers (cost-control Task 4) ─────────────────────

/**
 * Derive "touched files" for selectRelevantContext straight from the fact
 * ledger, rather than gemini-loop.ts tracking a second, parallel list that
 * could fall out of sync with it. Only `file_written` entries qualify — a
 * `decision` entry can also carry a `file` field (e.g. a failed run_command's
 * exact command string, or a deleted path — see inferEntriesForActivity's
 * run_command/delete_file cases), which is not "a file this agent wrote or
 * edited" and would be misleading in a TOUCHED FILES section. Order-preserving
 * de-duplication (first-seen order) rather than a Set-then-array conversion,
 * so the list reads in the same order the files were actually touched.
 */
export function touchedFilesFromLedger(factLedger: FactLedgerEntry[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const entry of factLedger) {
    if (entry.type !== "file_written" || !entry.file) continue;
    if (seen.has(entry.file)) continue;
    seen.add(entry.file);
    files.push(entry.file);
  }
  return files;
}

/**
 * Drop-in structural replacement for compaction.ts's compactGeminiHistory at
 * gemini-loop.ts's PRIMARY compaction call sites (on history load, and before
 * every model call): same "only touch history once it's grown past
 * thresholdTokens, otherwise return the identical reference" shape, so the
 * call sites read as a like-for-like swap. The difference is what happens
 * once the threshold IS crossed — compactGeminiHistory asks an LLM to
 * paraphrase the middle of the history into prose (lossy); this rebuilds the
 * context from the fact ledger instead (lossless for anything the ledger
 * captured, per this module's header comment and the "turn 5 survives at
 * turn 105" test below).
 *
 * `currentTask` is gemini-loop.ts's `config.initialMessage` — the task this
 * agent run was actually given, which does not change turn to turn in this
 * loop (there is no separate "current subtask" concept here). `openFindings`
 * is always empty: this is the general generator/evaluator loop (Shubham/
 * Aanya/Pranav/Riya/Tilotma's Tier-3 evaluators), not qa-loop.ts — "open
 * findings" is a QA-loop-specific concept (Navya/Karan/Deepika's findings
 * list) that has no equivalent in this loop's config or state today.
 */
export function compactViaRelevantContext(
  messages: GeminiMessage[],
  currentTask: string,
  factLedger: FactLedgerEntry[],
  thresholdTokens: number,
  options: SelectContextOptions = {},
): GeminiMessage[] {
  const tokens = estimateGeminiTokenCount(messages);
  if (tokens < thresholdTokens) return messages;

  console.log(
    `[context-selection] History ~${tokens} tokens exceeds ${thresholdTokens} — rebuilding via selectRelevantContext (fact ledger: ${factLedger.length} entries) instead of prose-summarizing.`,
  );

  const touchedFiles = touchedFilesFromLedger(factLedger);
  return selectRelevantContext(messages, currentTask, touchedFiles, [], factLedger, options);
}
