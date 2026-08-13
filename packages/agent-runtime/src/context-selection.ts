import type { GeminiMessage } from "@nexsidi/llm-client";
import { safeTrailingSlice } from "./compaction.ts";

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
// NOT WIRED into gemini-loop.ts's actual model-calling path yet. Task 4 (not
// this task) does that swap, after this module has been reviewed. The only
// integration point touched here is a data-collection hook — see the
// gemini-loop.ts comment near the fact-ledger append call for what that is
// and is not.

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
        return [{ type: "decision", summary: `Command failed: ${command}${detail}`, turnIndex }];
      }

      // Success: check whether this exact command previously failed and
      // hasn't already been recorded as resolved — if so, this turn is the
      // fix taking effect. Scanning the ledger here (not a separate index)
      // keeps the ledger the single source of truth, matching its
      // append-only design — no side-channel state to fall out of sync with it.
      const failureMarker = `Command failed: ${command}`;
      const lastFailureIdx = [...ledgerSoFar]
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.type === "decision" && e.summary.startsWith(failureMarker))
        .pop()?.i;
      if (lastFailureIdx === undefined) return [];

      const alreadyResolvedSince = ledgerSoFar
        .slice(lastFailureIdx + 1)
        .some((e) => e.type === "error_resolved" && e.summary.includes(command));
      if (alreadyResolvedSince) return [];

      return [{ type: "error_resolved", summary: `${command} now succeeds (previously failed)`, turnIndex }];
    }

    case "escalate_finding": {
      const finding = stringField(args, "finding") ?? stringField(args, "reason") ?? "escalation raised";
      return [{ type: "decision", summary: `Escalated: ${truncate(finding, 160)}`, turnIndex }];
    }

    case "task_complete": {
      const summary = stringField(args, "summary");
      if (!summary) return [];
      return [{ type: "decision", summary: `Marked complete: ${truncate(summary, 160)}`, turnIndex }];
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

/**
 * Build the context to actually send to the model for the next call:
 * system prompt + current task brief (task, touched files, open findings)
 * + the FULL fact ledger + only the last N raw turns for immediate
 * continuity (pairing-safe via compaction.ts's safeTrailingSlice — the same
 * Gemini functionCall/functionResponse adjacency requirement applies here,
 * so this reuses that logic rather than reimplementing it).
 *
 * NOT currently called from gemini-loop.ts's live model-calling path — see
 * this module's header comment. Standalone and independently testable.
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
  const nonSys = fullHistory.filter((m) => m.role !== "system");
  const trailing = safeTrailingSlice(nonSys, trailingTurnCount);

  const taskLines = [
    `CURRENT TASK: ${currentTask}`,
    touchedFiles.length > 0 ? `TOUCHED FILES:\n${touchedFiles.map((f) => `- ${f}`).join("\n")}` : null,
    openFindings.length > 0 ? `OPEN FINDINGS:\n${openFindings.map((f) => `- ${f}`).join("\n")}` : null,
  ].filter((l): l is string => l !== null);

  const taskMsg: GeminiMessage = { role: "user", content: taskLines.join("\n\n") };

  const messages: GeminiMessage[] = [...sys, taskMsg];

  // Omit the ledger message entirely when empty — no empty-section noise in
  // the prompt, and it keeps the "no facts recorded yet" case indistinguishable
  // from extra boilerplate rather than a real section.
  if (factLedger.length > 0) {
    const ledgerMsg: GeminiMessage = {
      role: "user",
      content: `FACT LEDGER (full — every entry below is a fact recorded earlier in this session and is never dropped):\n${formatFactLedgerForPrompt(factLedger)}`,
    };
    messages.push(ledgerMsg);
  }

  messages.push(...trailing);
  return messages;
}
