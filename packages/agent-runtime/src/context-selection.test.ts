import { test, expect } from "bun:test";
import type { GeminiMessage } from "@nexsidi/llm-client";
import {
  appendFactLedgerEntry,
  formatFactLedgerForPrompt,
  selectRelevantContext,
  touchedFilesFromLedger,
  compactViaRelevantContext,
  type FactLedgerEntry,
  type TurnToolActivity,
} from "./context-selection.ts";

// ── Task 2 (cost-control plan): structured fact ledger, not lossy prose ─────
//
// Root cause being tested against: the 2026-07-24 "amnesiac oscillation" bug
// — compactGeminiHistory's prose summary (compaction.ts) can drop a specific
// decision made earlier in a session because an LLM summarizer is lossy by
// construction. A fact ledger is append-only, structured, and sent in FULL
// (not re-summarized) — a fact recorded once can never be silently dropped
// by this mechanism, regardless of how long the session runs.

// ── appendFactLedgerEntry: inference from turn activity ─────────────────────

test("appendFactLedgerEntry: a successful write_file call becomes a file_written entry", () => {
  const activity: TurnToolActivity[] = [
    {
      toolName: "write_file",
      args: { path: "src/index.ts", content: "export const x = 1;" },
      result: { status: "success" },
    },
  ];
  const ledger = appendFactLedgerEntry([], 3, activity);
  expect(ledger.length).toBe(1);
  expect(ledger[0]!.type).toBe("file_written");
  expect(ledger[0]!.file).toBe("src/index.ts");
  expect(ledger[0]!.turnIndex).toBe(3);
  expect(ledger[0]!.summary.length).toBeGreaterThan(0);
});

test("appendFactLedgerEntry: a failed write_file call produces no fact", () => {
  const activity: TurnToolActivity[] = [
    { toolName: "write_file", args: { path: "src/index.ts" }, result: { status: "error", summary: "disk full" } },
  ];
  const ledger = appendFactLedgerEntry([], 1, activity);
  expect(ledger.length).toBe(0);
});

test("appendFactLedgerEntry: write_files (batch) produces one file_written entry per file", () => {
  const activity: TurnToolActivity[] = [
    {
      toolName: "write_files",
      args: { files: [{ path: "a.ts", content: "a" }, { path: "b.ts", content: "b" }] },
      result: { status: "success" },
    },
  ];
  const ledger = appendFactLedgerEntry([], 7, activity);
  expect(ledger.length).toBe(2);
  expect(ledger.map((e) => e.file).sort()).toEqual(["a.ts", "b.ts"]);
  expect(ledger.every((e) => e.type === "file_written")).toBe(true);
});

test("appendFactLedgerEntry: edit_file becomes a file_written entry whose summary names the actual change", () => {
  const activity: TurnToolActivity[] = [
    {
      toolName: "edit_file",
      args: { path: "backend/package.json", old_str: "bcryptjs", new_str: "bcrypt" },
      result: { status: "success" },
    },
  ];
  const ledger = appendFactLedgerEntry([], 5, activity);
  expect(ledger.length).toBe(1);
  expect(ledger[0]!.type).toBe("file_written");
  expect(ledger[0]!.file).toBe("backend/package.json");
  // The specific decision must be legible from the summary alone — this is
  // exactly the kind of detail a prose summarizer is free to drop.
  expect(ledger[0]!.summary).toContain("bcryptjs");
  expect(ledger[0]!.summary).toContain("bcrypt");
});

test("appendFactLedgerEntry: a failing run_command becomes a decision entry", () => {
  const activity: TurnToolActivity[] = [
    { toolName: "run_command", args: { command: "bun run typecheck" }, result: { status: "error", summary: "TS2322: type mismatch" } },
  ];
  const ledger = appendFactLedgerEntry([], 10, activity);
  expect(ledger.length).toBe(1);
  expect(ledger[0]!.type).toBe("decision");
  expect(ledger[0]!.summary).toContain("bun run typecheck");
});

test("appendFactLedgerEntry: the same command later succeeding becomes an error_resolved entry", () => {
  let ledger: FactLedgerEntry[] = [];
  ledger = appendFactLedgerEntry(ledger, 10, [
    { toolName: "run_command", args: { command: "bun run typecheck" }, result: { status: "error", summary: "TS2322" } },
  ]);
  ledger = appendFactLedgerEntry(ledger, 14, [
    { toolName: "run_command", args: { command: "bun run typecheck" }, result: { status: "success" } },
  ]);
  const resolved = ledger.find((e) => e.type === "error_resolved");
  expect(resolved).toBeDefined();
  expect(resolved!.turnIndex).toBe(14);
  expect(resolved!.summary).toContain("bun run typecheck");
  // the original failure record must still be present too — append-only
  expect(ledger.some((e) => e.type === "decision" && e.summary.includes("bun run typecheck"))).toBe(true);
});

test("appendFactLedgerEntry: a command that succeeds without ever having failed produces no error_resolved noise", () => {
  const ledger = appendFactLedgerEntry([], 1, [
    { toolName: "run_command", args: { command: "bun test" }, result: { status: "success" } },
  ]);
  expect(ledger.length).toBe(0);
});

// ── task_complete: review Finding 1 regression coverage ─────────────────────
//
// gemini-loop.ts's task_complete handler returns from the whole function
// BEFORE building turnActivity when checkCompletion accepts the call — so a
// genuine acceptance can never reach appendFactLedgerEntry. The only way
// toolName: "task_complete" activity reaches here is a REJECTED completion
// (checkCompletion sets result = { status: "error", summary: reason } and
// falls through to the shared turnActivity/factLedger code). Previously this
// branch ignored status entirely and always recorded "Marked complete" —
// wrongly logging a rejected completion as accepted.

test("appendFactLedgerEntry: a REJECTED task_complete records the rejection, not a false 'Marked complete'", () => {
  const activity: TurnToolActivity[] = [
    {
      toolName: "task_complete",
      args: { summary: "Implemented the auth routes", files_written: [], verification_passed: true },
      result: { status: "error", summary: "Verification command 'bun test' was never run" },
    },
  ];
  const ledger = appendFactLedgerEntry([], 8, activity);
  expect(ledger.length).toBe(1);
  expect(ledger[0]!.type).toBe("decision");
  expect(ledger[0]!.summary).toContain("Completion attempt rejected");
  expect(ledger[0]!.summary).toContain("Verification command 'bun test' was never run");
  expect(ledger[0]!.summary).not.toContain("Marked complete");
});

test("appendFactLedgerEntry: a rejected task_complete with no rejection reason still records something true, not 'Marked complete'", () => {
  const activity: TurnToolActivity[] = [
    { toolName: "task_complete", args: { summary: "done" }, result: { status: "error" } },
  ];
  const ledger = appendFactLedgerEntry([], 1, activity);
  expect(ledger.length).toBe(1);
  expect(ledger[0]!.summary).toContain("Completion attempt rejected");
  expect(ledger[0]!.summary).not.toContain("Marked complete");
});

test("appendFactLedgerEntry: a genuinely accepted task_complete (status success) records 'Marked complete' (defensive — this shape cannot occur via gemini-loop.ts's actual call site today, see comment above)", () => {
  const activity: TurnToolActivity[] = [
    {
      toolName: "task_complete",
      args: { summary: "Implemented the auth routes", files_written: [], verification_passed: true },
      result: { status: "success" },
    },
  ];
  const ledger = appendFactLedgerEntry([], 8, activity);
  expect(ledger.length).toBe(1);
  expect(ledger[0]!.summary).toContain("Marked complete");
  expect(ledger[0]!.summary).toContain("Implemented the auth routes");
});

// ── run_command: review Finding 2 regression coverage ───────────────────────
//
// Two commands where one is a literal string prefix of the other — the old
// `.startsWith(failureMarker)` / `.includes(command)` matching wrongly
// conflated them. Real pairs like this exist in this codebase: `bun test`
// vs `bun test:integration`, `bun run typecheck` vs `bun run typecheck:watch`.

test("appendFactLedgerEntry: a command that never failed does not falsely resolve a DIFFERENT failed command it is a string-prefix of", () => {
  let ledger: FactLedgerEntry[] = [];
  // turn 1: "bun test:integration" fails
  ledger = appendFactLedgerEntry(ledger, 1, [
    { toolName: "run_command", args: { command: "bun test:integration" }, result: { status: "error", summary: "2 failures" } },
  ]);
  // turn 2: "bun test" succeeds — it never failed, and is NOT the same
  // command as "bun test:integration", even though it is a string prefix of it.
  ledger = appendFactLedgerEntry(ledger, 2, [
    { toolName: "run_command", args: { command: "bun test" }, result: { status: "success" } },
  ]);

  // No error_resolved entry should be emitted for "bun test" — it never failed.
  const resolvedForBunTest = ledger.find((e) => e.type === "error_resolved" && e.summary.startsWith("bun test "));
  expect(resolvedForBunTest).toBeUndefined();
  expect(ledger.some((e) => e.type === "error_resolved")).toBe(false);

  // The real failure (bun test:integration) must still be present and
  // unresolved — not swallowed by the false match.
  const failure = ledger.find((e) => e.type === "decision" && e.file === "bun test:integration");
  expect(failure).toBeDefined();
});

test("appendFactLedgerEntry: the same command that actually failed still correctly resolves (exact match still works)", () => {
  let ledger: FactLedgerEntry[] = [];
  ledger = appendFactLedgerEntry(ledger, 1, [
    { toolName: "run_command", args: { command: "bun test:integration" }, result: { status: "error", summary: "2 failures" } },
  ]);
  ledger = appendFactLedgerEntry(ledger, 2, [
    { toolName: "run_command", args: { command: "bun test:integration" }, result: { status: "success" } },
  ]);
  const resolved = ledger.find((e) => e.type === "error_resolved");
  expect(resolved).toBeDefined();
  expect(resolved!.summary).toContain("bun test:integration");
  expect(resolved!.turnIndex).toBe(2);
});

test("appendFactLedgerEntry: read-only tool calls (read_file, list_files) never produce ledger noise", () => {
  const activity: TurnToolActivity[] = [
    { toolName: "read_file", args: { path: "src/index.ts" }, result: { status: "success", output: "..." } },
    { toolName: "list_files", args: {}, result: { status: "success", output: [] } },
  ];
  const ledger = appendFactLedgerEntry([], 2, activity);
  expect(ledger.length).toBe(0);
});

test("appendFactLedgerEntry is append-only: prior entries are never mutated or dropped by a later call", () => {
  let ledger: FactLedgerEntry[] = [];
  ledger = appendFactLedgerEntry(ledger, 1, [{ toolName: "write_file", args: { path: "a.ts" }, result: { status: "success" } }]);
  const afterFirst = ledger;
  ledger = appendFactLedgerEntry(ledger, 2, [{ toolName: "write_file", args: { path: "b.ts" }, result: { status: "success" } }]);
  // the array returned by the first call must be untouched by the second
  expect(afterFirst.length).toBe(1);
  expect(afterFirst[0]!.file).toBe("a.ts");
  // the new ledger contains both, in order, with original entry unchanged
  expect(ledger.length).toBe(2);
  expect(ledger[0]).toEqual(afterFirst[0]!);
  expect(ledger[1]!.file).toBe("b.ts");
});

test("appendFactLedgerEntry: a turn with no ledger-worthy activity returns the identical ledger reference", () => {
  const ledger: FactLedgerEntry[] = [{ type: "decision", summary: "prior fact", turnIndex: 1 }];
  const result = appendFactLedgerEntry(ledger, 2, [{ toolName: "read_file", args: {}, result: { status: "success" } }]);
  expect(result).toBe(ledger); // same reference — no needless copy
});

// ── formatFactLedgerForPrompt ────────────────────────────────────────────────

test("formatFactLedgerForPrompt renders one line per entry, cheap and readable", () => {
  const ledger: FactLedgerEntry[] = [
    { type: "file_written", file: "a.ts", summary: "Wrote a.ts", turnIndex: 1 },
    { type: "decision", summary: "Chose bcrypt over bcryptjs for native perf", turnIndex: 5 },
  ];
  const text = formatFactLedgerForPrompt(ledger);
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  expect(lines.length).toBe(2);
  expect(text).toContain("Wrote a.ts");
  expect(text).toContain("Chose bcrypt over bcryptjs for native perf");
});

// ── selectRelevantContext: the critical correctness requirement ────────────
//
// Directly proves the bug class from the 2026-07-24 incident cannot recur:
// a fact recorded early in a long session (turn 5) must still be visible in
// the context assembled on turn 105, even though the raw turn-5 messages
// have long since fallen out of the trailing window.

function makeModelTurn(text: string): GeminiMessage {
  return { role: "model", content: [{ text }] };
}
function makeUserTurn(text: string): GeminiMessage {
  return { role: "user", content: text };
}

test("selectRelevantContext: a fact recorded at turn 5 is still present in the context built at turn 105", () => {
  // Build a long, realistic session history: 105 turns, each turn a
  // model/user pair. Turn 5 is where the agent switched bcryptjs -> bcrypt.
  const fullHistory: GeminiMessage[] = [{ role: "system", content: "You are Shubham, the backend generator." }];

  let ledger: FactLedgerEntry[] = [];
  for (let turn = 1; turn <= 105; turn++) {
    if (turn === 5) {
      fullHistory.push(makeModelTurn(`Turn ${turn}: editing backend/package.json to replace bcryptjs with bcrypt`));
      fullHistory.push(makeUserTurn(`Turn ${turn}: edit applied`));
      ledger = appendFactLedgerEntry(ledger, turn, [
        {
          toolName: "edit_file",
          args: { path: "backend/package.json", old_str: "bcryptjs", new_str: "bcrypt" },
          result: { status: "success" },
        },
      ]);
    } else {
      fullHistory.push(makeModelTurn(`Turn ${turn}: routine work, nothing notable`));
      fullHistory.push(makeUserTurn(`Turn ${turn}: ack`));
    }
  }

  // Only the last 6 raw turns are kept for immediate continuity — turn 5's
  // raw messages (100 turns back) are long gone from that trailing window.
  const trailingTurnCount = 6;
  const context = selectRelevantContext(
    fullHistory,
    "Continue implementing the auth routes",
    ["backend/src/routes/auth.ts"],
    [],
    ledger,
    { trailingTurnCount },
  );

  const serialized = JSON.stringify(context);

  // The fact must be present...
  expect(serialized).toContain("bcryptjs");
  expect(serialized).toContain("bcrypt");

  // ...specifically because it came from the ledger, NOT because turn 5's
  // raw messages happened to survive in the trailing window.
  const rawTurn5Text = `Turn 5: editing backend/package.json to replace bcryptjs with bcrypt`;
  expect(serialized).not.toContain(rawTurn5Text);

  // Sanity: prove real trimming actually happened (this isn't vacuously
  // true because the whole history was sent anyway).
  expect(context.length).toBeLessThan(fullHistory.length);
});

test("selectRelevantContext: the FULL fact ledger is sent, not a truncated/sampled subset", () => {
  const fullHistory: GeminiMessage[] = [
    { role: "system", content: "sys" },
    makeUserTurn("start"),
  ];
  let ledger: FactLedgerEntry[] = [];
  for (let i = 1; i <= 50; i++) {
    ledger = appendFactLedgerEntry(ledger, i, [
      { toolName: "write_file", args: { path: `file-${i}.ts`, content: "x" }, result: { status: "success" } },
    ]);
  }
  expect(ledger.length).toBe(50);

  const context = selectRelevantContext(fullHistory, "task", [], [], ledger);
  const serialized = JSON.stringify(context);
  for (let i = 1; i <= 50; i++) {
    expect(serialized).toContain(`file-${i}.ts`);
  }
});

test("selectRelevantContext: includes the system prompt, current task, touched files, and open findings", () => {
  const fullHistory: GeminiMessage[] = [
    { role: "system", content: "You are Aanya, the frontend generator." },
    makeUserTurn("initial task"),
  ];
  const context = selectRelevantContext(
    fullHistory,
    "Fix the contact form validation bug",
    ["frontend/app/contact/page.tsx"],
    ["Karan: XSS risk in contact form input"],
    [],
  );
  const serialized = JSON.stringify(context);
  expect(context[0]).toEqual({ role: "system", content: "You are Aanya, the frontend generator." });
  expect(serialized).toContain("Fix the contact form validation bug");
  expect(serialized).toContain("frontend/app/contact/page.tsx");
  expect(serialized).toContain("Karan: XSS risk in contact form input");
});

test("selectRelevantContext: never splits a functionCall from its matching functionResponse in the trailing window", () => {
  // Same pairing hazard compaction.test.ts pins for compactGeminiHistory —
  // selectRelevantContext must reuse safeTrailingSlice so this holds here too.
  const fullHistory: GeminiMessage[] = [
    { role: "system", content: "system prompt" },
    makeUserTurn("initial task"),
    makeModelTurn("working"),
    makeUserTurn("still going"),
    // a naive slice(-4) would start exactly here, splitting the pair below
    { role: "model", content: [{ functionCall: { name: "write_file", args: { path: "a.ts" } } }] },
    { role: "user", content: [{ functionResponse: { name: "write_file", response: { status: "success" } } }] },
    makeModelTurn("done"),
  ];

  const context = selectRelevantContext(fullHistory, "task", [], [], [], { trailingTurnCount: 4 });

  const hasFunctionResponse = (m: GeminiMessage) => Array.isArray(m.content) && m.content.some((p) => "functionResponse" in p);
  const hasMatchingFunctionCall = (m: GeminiMessage) => Array.isArray(m.content) && m.content.some((p) => "functionCall" in p);

  const responseIdx = context.findIndex(hasFunctionResponse);
  expect(responseIdx).toBeGreaterThan(0);
  expect(hasMatchingFunctionCall(context[responseIdx - 1]!)).toBe(true);
});

test("selectRelevantContext: with an empty ledger and short history, still returns a well-formed, non-empty context", () => {
  const fullHistory: GeminiMessage[] = [
    { role: "system", content: "sys" },
    makeUserTurn("hello"),
  ];
  const context = selectRelevantContext(fullHistory, "do the thing", [], [], []);
  expect(context.length).toBeGreaterThan(0);
  expect(context[0]!.role).toBe("system");
});

test("selectRelevantContext: omits the ledger message entirely when the ledger is empty (no empty-section noise)", () => {
  const fullHistory: GeminiMessage[] = [
    { role: "system", content: "sys" },
    makeUserTurn("hello"),
  ];
  const context = selectRelevantContext(fullHistory, "do the thing", [], [], []);
  const serialized = JSON.stringify(context);
  expect(serialized).not.toContain("FACT LEDGER");
});

test("selectRelevantContext: includes a ledger section header when facts exist", () => {
  const fullHistory: GeminiMessage[] = [
    { role: "system", content: "sys" },
    makeUserTurn("hello"),
  ];
  const ledger: FactLedgerEntry[] = [{ type: "decision", summary: "picked bcrypt", turnIndex: 1 }];
  const context = selectRelevantContext(fullHistory, "do the thing", [], [], ledger);
  const serialized = JSON.stringify(context);
  expect(serialized).toContain("FACT LEDGER");
  expect(serialized).toContain("picked bcrypt");
});

// ── touchedFilesFromLedger / compactViaRelevantContext (cost-control Task 4) ─

test("touchedFilesFromLedger: collects only file_written entries, de-duplicated in first-seen order", () => {
  let ledger: FactLedgerEntry[] = [];
  ledger = appendFactLedgerEntry(ledger, 1, [
    { toolName: "write_file", args: { path: "a.ts", content: "1" }, result: { status: "success" } },
  ]);
  ledger = appendFactLedgerEntry(ledger, 2, [
    { toolName: "run_command", args: { command: "bun test" }, result: { status: "error", summary: "boom" } },
  ]);
  ledger = appendFactLedgerEntry(ledger, 3, [
    { toolName: "edit_file", args: { path: "b.ts", old_str: "x", new_str: "y" }, result: { status: "success" } },
  ]);
  // a.ts written again — must not appear twice
  ledger = appendFactLedgerEntry(ledger, 4, [
    { toolName: "write_file", args: { path: "a.ts", content: "2" }, result: { status: "success" } },
  ]);

  expect(touchedFilesFromLedger(ledger)).toEqual(["a.ts", "b.ts"]);
});

test("touchedFilesFromLedger: returns an empty array for a ledger with no file_written entries", () => {
  const ledger: FactLedgerEntry[] = [{ type: "decision", summary: "picked bcrypt", turnIndex: 1 }];
  expect(touchedFilesFromLedger(ledger)).toEqual([]);
});

test("compactViaRelevantContext: below threshold, returns the identical messages reference unchanged", () => {
  const messages: GeminiMessage[] = [
    { role: "system", content: "sys" },
    makeUserTurn("hello"),
  ];
  const result = compactViaRelevantContext(messages, "task", [], 1_000_000);
  expect(result).toBe(messages);
});

test("compactViaRelevantContext: above threshold, rebuilds via selectRelevantContext (fact ledger survives, touched files derived from it)", () => {
  const fullHistory: GeminiMessage[] = [{ role: "system", content: "sys" }];
  let ledger: FactLedgerEntry[] = [];
  for (let turn = 1; turn <= 20; turn++) {
    fullHistory.push(makeModelTurn(`Turn ${turn}: ${"x".repeat(2000)}`));
    fullHistory.push(makeUserTurn(`Turn ${turn}: ack`));
    if (turn === 3) {
      ledger = appendFactLedgerEntry(ledger, turn, [
        { toolName: "write_file", args: { path: "backend/src/auth.ts", content: "x" }, result: { status: "success" } },
      ]);
    }
  }

  const result = compactViaRelevantContext(fullHistory, "Continue the auth work", ledger, 100);
  expect(result).not.toBe(fullHistory);
  expect(result.length).toBeLessThan(fullHistory.length);

  const serialized = JSON.stringify(result);
  expect(serialized).toContain("backend/src/auth.ts");
  expect(serialized).toContain("TOUCHED FILES");
  expect(serialized).toContain("FACT LEDGER");
});
