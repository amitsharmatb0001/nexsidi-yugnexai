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

// 2026-10-25 (brewline3): a backend finding (order lines show the menu item's current name) was escalated to the database builder, who
// had already added the column and disputed it; Tilotma ruled the finding true, and it went back to the DISPUTER, who had nothing to
// change. Three rounds, then "stuck". A confirmed finding goes to the owner of the file it names.
test("a confirmed finding goes to the builder who owns the file it names, not to the one who disputed it", async () => {
  setup();
  const since = new Date(Date.now() - 1000).toISOString();
  recordDispute("p1", "pranav", { finding: "backend/src/routes/orders.ts: [INT1] backend/src/routes/orders.ts:298 — line names are read from menu_items", checked: "read db/migrations", observed: "0001_fix.sql adds order_items.name_at_time" });
  recordDispute("p1", "pranav", { finding: "db/migrations/0000_initial.sql: [INT2] no index", checked: "c", observed: "o" });
  recordDispute("p1", "aanya", { finding: "something without a path", checked: "c", observed: "o" });
  const sent: Record<string, string[]> = {};
  const fixer = (who: string) => async (_plan: unknown, f: string[]) => { sent[who] = f; return { success: true, filesWritten: ["x"] }; };
  await resolveDisputes("p1", since, PLAN, {
    settle: async (_p, disputes) => disputes.map((d) => ({ dispute: d, verdict: "true" as const, evidence: "name_at_time exists; orders.ts never reads it" })),
    fixers: { shubham: fixer("shubham"), aanya: fixer("aanya"), pranav: fixer("pranav") },
  });
  expect(sent.shubham?.length).toBe(1);
  expect(sent.shubham![0]).toContain("orders.ts:298");
  expect(sent.pranav?.length).toBe(1);
  expect(sent.pranav![0]).toContain("db/migrations/0000_initial.sql");
  expect(sent.aanya?.length).toBe(1); // no path: back to whoever disputed it
});

// 2026-10-29 (team plan, stage 1): when Tilotma names the file that must change, its owner gets the finding.
test("a confirmed finding goes to the owner of the file Tilotma says must change, with that file named", async () => {
  setup();
  const since = new Date(Date.now() - 1000).toISOString();
  recordDispute("p1", "pranav", { finding: "db/migrations/0001_fix.sql: [INT1] past orders show today's item name", checked: "read 0001_fix.sql", observed: "ADD COLUMN name_at_time" });
  const sent: Record<string, string[]> = {};
  const fixer = (who: string) => async (_plan: unknown, f: string[]) => { sent[who] = f; return { success: true, filesWritten: ["x"] }; };
  await resolveDisputes("p1", since, PLAN, {
    settle: async (_p, disputes) => disputes.map((d) => ({ dispute: d, verdict: "true" as const, evidence: "the column exists; orders.ts never writes it", fixIn: "backend/src/routes/orders.ts" })),
    fixers: { shubham: fixer("shubham"), pranav: fixer("pranav") },
  });
  expect(sent.pranav).toBeUndefined();
  expect(sent.shubham?.length).toBe(1);
  expect(sent.shubham![0]).toContain("Change backend/src/routes/orders.ts");
});

// 2026-10-29 (Brewline 3 replay): a confirmed finding that comes back disputed again starts with "Tilotma checked…", not with
// its file, and went back to the database builder who disputed it — the ping-pong of 25 Oct. The first project path counts.
test("the owner is found from the first project path in the finding, even after a verdict's preface", async () => {
  const { ownerOfFinding } = await import("./disputes.ts");
  expect(ownerOfFinding("Tilotma checked this disputed finding and it IS true — fix it: backend/src/routes/orders.ts: [INT1] uses mi.name")).toBe("shubham");
  expect(ownerOfFinding("frontend/app/order/page.tsx: calls backend/src/routes/orders.ts")).toBe("aanya");
  expect(ownerOfFinding("something without a path")).toBeNull();
  expect(ownerOfFinding("see mybackend/notes and ../db/x")).toBeNull();
});
