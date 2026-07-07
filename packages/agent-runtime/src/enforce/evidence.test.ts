import { test, expect } from "bun:test";
import { createEvidenceLedger } from "./evidence.ts";

// Phase 5 Task 1 (final-bundle/phase5-harness-enforcement-plan.md): per-run
// evidence ledger backing Rule 6 (evidence before claims). Tool executors
// report into it; the completion gate (Task 3) reads it before allowing
// task_complete. consume() returns-and-clears so the NEXT completion claim
// needs FRESH evidence — closing the gap in the bash verify-gate hook
// (nexsidi-master-workflow), which is file-based and not per-run/typed.

test("a fresh ledger has no evidence", () => {
  const ledger = createEvidenceLedger();
  expect(ledger.hasFreshEvidence()).toBe(false);
});

test("recording evidence makes hasFreshEvidence true", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npm test exited 0");
  expect(ledger.hasFreshEvidence()).toBe(true);
});

test("consume returns the recorded records", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit exited 0");
  ledger.record("file_read", "src/index.ts");
  const records = ledger.consume();
  expect(records).toHaveLength(2);
  expect(records[0]).toEqual({ kind: "command_output", ref: "npx tsc --noEmit exited 0" });
  expect(records[1]).toEqual({ kind: "file_read", ref: "src/index.ts" });
});

test("consume clears the ledger — a second consume returns nothing", () => {
  const ledger = createEvidenceLedger();
  ledger.record("http_check", "GET /health -> 200");
  ledger.consume();
  expect(ledger.consume()).toHaveLength(0);
  expect(ledger.hasFreshEvidence()).toBe(false);
});

test("hasFreshEvidence goes false again after consume — the next completion claim needs NEW evidence", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npm run build exited 0");
  expect(ledger.hasFreshEvidence()).toBe(true);
  ledger.consume();
  expect(ledger.hasFreshEvidence()).toBe(false);
});

test("each ledger instance is independent — no shared module-level state", () => {
  const a = createEvidenceLedger();
  const b = createEvidenceLedger();
  a.record("command_output", "a's evidence");
  expect(a.hasFreshEvidence()).toBe(true);
  expect(b.hasFreshEvidence()).toBe(false);
});

test("all three evidence kinds are accepted", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "cmd");
  ledger.record("file_read", "path");
  ledger.record("http_check", "url");
  expect(ledger.consume()).toHaveLength(3);
});
