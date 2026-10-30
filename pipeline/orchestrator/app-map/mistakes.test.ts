import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mistakePatterns, recordMistakePatterns } from "./mistakes.ts";
import type { RuleViolation } from "./rules.ts";

// 2026-10-30 (team plan stage 7, Amit: "by facts, in code"): mistake memory recognised a repeat only when a model's summary
// of the finding came out word for word the same — 595 rows, every one seen once. A broken rule now has a key from its facts:
// the rule and the kind of break (INT1/no-copy, SEC9/role-from-request). The same mistake in another project, with other
// table names and other words, has the same key, so the store counts it across projects (patent claim 7).

const v = (over: Partial<RuleViolation>): RuleViolation => ({ rule: "INT1", kind: "no-copy", owner: "pranav", file: "db/migrations/0000.sql", line: 1, fact: "x", fix: "y", ...over });

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

test("the same break in two projects, with other tables and words, has one key; another kind of break has another", () => {
  const a = mistakePatterns([v({ fact: "order_items keeps no copy of menu_items.name" })]);
  const b = mistakePatterns([v({ fact: "booking_items keeps no copy of gear.name" })]);
  expect(a[0]!.key).toBe("INT1/no-copy");
  expect(b[0]!.key).toBe(a[0]!.key);
  expect(mistakePatterns([v({ kind: "cascade" })])[0]!.key).toBe("INT1/cascade");
  expect(mistakePatterns([v({ rule: "SEC9", kind: "role-from-request" })])[0]).toMatchObject({ key: "SEC9/role-from-request", domain: "security" });
});

test("one pattern per key per build: a builder that breaks it in five places, or calls 'done' five times, is one sighting", async () => {
  dir = mkdtempSync(join(tmpdir(), "mistakes-"));
  const recorded: string[] = [];
  const recorder = async (_agent: string, _domain: string, key: string) => void recorded.push(key);
  const twice = [v({ line: 1 }), v({ line: 9 })];
  await recordMistakePatterns(dir, "p1", "pranav", twice, recorder);
  await recordMistakePatterns(dir, "p1", "pranav", twice, recorder);
  await recordMistakePatterns(dir, "p1", "shubham", [v({ rule: "SEC1", kind: "sql-from-request", owner: "shubham" })], recorder);
  expect(recorded).toEqual(["INT1/no-copy", "SEC1/sql-from-request"]);
});

test("a store that cannot be reached does not stop the build", async () => {
  dir = mkdtempSync(join(tmpdir(), "mistakes-"));
  const failing = async () => {
    throw new Error("ECONNREFUSED");
  };
  await expect(recordMistakePatterns(dir, "p1", "pranav", [v({})], failing)).resolves.toBeUndefined();
});
