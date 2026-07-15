import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceLedger } from "./evidence.ts";
import { execRunCommand } from "../tools/command.ts";
import { execReadFile } from "../tools/file.ts";

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

test("recognizes only the required successful verification command", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "node -v -> exited 0");
  ledger.record("command_output", "npx tsc --noEmit --pretty false -> exited 0");

  expect(ledger.hasSuccessfulCommand("npx tsc --noEmit")).toBe(true);
  expect(ledger.hasSuccessfulCommand("npm run build")).toBe(false);
});

// ── Task 2: tool executor integration ───────────────────────────────────────
// Executors accept an OPTIONAL ledger param — existing call sites and tests
// (loop.ts, claude-loop.ts, gemini-loop.ts, and every existing tool test)
// keep compiling and passing unchanged. Only successful executions record
// evidence — a failed command is debugging information, not proof of success.

let sandboxDir: string;
beforeEach(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), "nexsidi-evidence-test-"));
});
afterEach(() => {
  rmSync(sandboxDir, { recursive: true, force: true });
});

test("execRunCommand records command_output evidence on success when given a ledger", () => {
  const ledger = createEvidenceLedger();
  const result = execRunCommand(sandboxDir, { command: "node -e \"console.log('test')\"" }, ledger);
  expect(result.status).toBe("success");
  expect(ledger.hasFreshEvidence()).toBe(true);
  const records = ledger.consume();
  expect(records).toHaveLength(1);
  expect(records[0]!.kind).toBe("command_output");
  expect(records[0]!.ref).toContain("node");
});

test("execRunCommand records NO evidence when the command fails, even with a ledger", () => {
  const ledger = createEvidenceLedger();
  const result = execRunCommand(sandboxDir, { command: "not-a-real-command-xyz" }, ledger);
  expect(result.status).toBe("error");
  expect(ledger.hasFreshEvidence()).toBe(false);
});

test("execRunCommand works exactly as before when no ledger is passed (existing call sites unaffected)", () => {
  const result = execRunCommand(sandboxDir, { command: "node -e \"console.log('test')\"" });
  expect(result.status).toBe("success");
});

test("execReadFile records file_read evidence on success when given a ledger", () => {
  writeFileSync(join(sandboxDir, "a.ts"), "export const x = 1;");
  const ledger = createEvidenceLedger();
  const result = execReadFile(sandboxDir, { path: "a.ts" }, ledger);
  expect(result.status).toBe("success");
  const records = ledger.consume();
  expect(records).toHaveLength(1);
  expect(records[0]).toEqual({ kind: "file_read", ref: "a.ts" });
});

test("execReadFile records NO evidence when the file does not exist, even with a ledger", () => {
  const ledger = createEvidenceLedger();
  const result = execReadFile(sandboxDir, { path: "missing.ts" }, ledger);
  expect(result.status).toBe("error");
  expect(ledger.hasFreshEvidence()).toBe(false);
});
