import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDispute } from "../../packages/agent-runtime/src/tools/dispute.ts";
import { resolveDisputes, dropSettledNotTrue } from "./disputes.ts";

// 2026-10-03 (evidence-only plan, T6): a builder's dispute goes to Tilotma.
// A finding she confirms goes back to its builder with her evidence; one she
// finds not true is dropped and never sent again; one she does not settle
// stays open. Nothing is decided without her checked evidence.
const prev = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const setup = () => {
  dir = mkdtempSync(join(tmpdir(), "disputes-"));
  process.env.BUILD_DIR = dir;
};
const PLAN = { projectId: "p1" } as never;
const COLOUR = "frontend/app/layout.tsx: [spec-compliance] Spec explicitly specifies color #059669 but it does not appear anywhere in the live site's rendered theme";

test("a finding Tilotma rules not true is dropped from later rounds", async () => {
  setup();
  const since = new Date(Date.now() - 1000).toISOString();
  recordDispute("p1", "aanya", { finding: COLOUR, checked: "read layout.tsx; live page", observed: "--nx-color-primary: #059669" });
  const out = await resolveDisputes("p1", since, PLAN, {
    settle: async (_p, disputes) => disputes.map((d) => ({ dispute: d, verdict: "not_true" as const, evidence: "live --nx-color-primary is #059669" })),
    fixers: {},
  });
  expect(out).toMatchObject({ disputed: 1, settledNotTrue: 1, refixChanged: false });
  const { kept, dropped } = dropSettledNotTrue("p1", [
    { file: "frontend/app/layout.tsx", issue: "[spec-compliance] Spec explicitly specifies color #059669 but it does not appear anywhere in the live site's rendered theme" },
    { file: "backend/src/a.ts", issue: "[logic/HIGH] real one" },
  ]);
  expect(dropped.length).toBe(1);
  expect(kept.map((f) => f.file)).toEqual(["backend/src/a.ts"]);
});

test("a finding Tilotma confirms goes back to its builder with her evidence", async () => {
  setup();
  const since = new Date(Date.now() - 1000).toISOString();
  recordDispute("p1", "shubham", { finding: "backend/src/a.ts: [logic/HIGH] x", checked: "c", observed: "o" });
  const sent: string[][] = [];
  const out = await resolveDisputes("p1", since, PLAN, {
    settle: async (_p, disputes) => disputes.map((d) => ({ dispute: d, verdict: "true" as const, evidence: "POST /x returned 500" })),
    fixers: { shubham: async (_plan, f) => { sent.push(f); return { success: true, filesWritten: ["src/a.ts"] }; } },
  });
  expect(sent.length).toBe(1);
  expect(sent[0]![0]).toContain("backend/src/a.ts: [logic/HIGH] x");
  expect(sent[0]![0]).toContain("POST /x returned 500");
  expect(out.refixChanged).toBe(true);
  expect(dropSettledNotTrue("p1", [{ file: "backend/src/a.ts", issue: "[logic/HIGH] x" }]).dropped).toEqual([]);
});

test("a dispute Tilotma does not settle stays open: nothing is dropped", async () => {
  setup();
  const since = new Date(Date.now() - 1000).toISOString();
  recordDispute("p1", "aanya", { finding: COLOUR, checked: "c", observed: "o" });
  const out = await resolveDisputes("p1", since, PLAN, { settle: async () => [], fixers: {} });
  expect(out.settledNotTrue).toBe(0);
  expect(dropSettledNotTrue("p1", [{ file: "frontend/app/layout.tsx", issue: COLOUR.split(": ").slice(1).join(": ") }]).dropped).toEqual([]);
});

test("no disputes this round: nothing to settle", async () => {
  setup();
  let called = false;
  const out = await resolveDisputes("p1", new Date().toISOString(), PLAN, { settle: async () => { called = true; return []; }, fixers: {} });
  expect(called).toBe(false);
  expect(out.disputed).toBe(0);
});
