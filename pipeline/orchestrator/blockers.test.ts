import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockerFacts, ruleByFacts, ruleByChief, resolveBlockers } from "./blockers.ts";
import { openBlockers, blockerId, type BlockedReport } from "../../packages/agent-runtime/src/tools/blocked.ts";
import { readAnswers, openCustomerQuestions } from "../../packages/agent-runtime/src/tools/ask.ts";
import { internalTermsIn } from "../../packages/agent-runtime/src/customer-text.ts";

// 2026-10-30 (Amit: "the owner can't do the edit, then what were you doing — why did nobody flag it"). Brewline 3 recorded 13
// blocker reports and none of them stopped a round: blockers were read only by the final live review. Now an open blocker
// stops paid work, and each one is decided from facts first — the owner of the named file fixes it at once; a system check
// that demands what the system refuses holds the build for a person, quoting both — and only then by the Chief AI, whose
// decision must carry proof or the build holds. Cases below are Brewline 3's own reports.

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "blk-"));
  process.env.BUILD_DIR = root;
  dir = join(root, "p1");
  mkdirSync(join(dir, "db", "migrations"), { recursive: true });
  writeFileSync(join(dir, "db", "migrations", "0000_initial.sql"), 'CREATE TABLE "order_items" ("menu_item_id" uuid REFERENCES "menu_items"("id") ON DELETE CASCADE);\nALTER TABLE "order_items" ADD COLUMN "name_at_time" text NOT NULL DEFAULT \'\';\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.BUILD_DIR;
});

const cascade: BlockedReport = { agent: "shubham", owner: "pranav", what: "order_items.menu_item_id uses ON DELETE CASCADE instead of RESTRICT. The system check blocks me from completing, but I cannot modify db/migrations myself.", checked: "db/migrations/0000_initial.sql has ON DELETE CASCADE for order_items.menu_item_id", at: "2026-10-25T11:24:00Z" };
const compose: BlockedReport = { agent: "shubham", owner: "riya", what: "Deletion of docker-compose.yml from the backend source folder (locked by workspace policy), which is blocking the task completion check.", checked: "Called delete_file on 'docker-compose.yml' and got 'Error: \"docker-compose.yml\" is not one of your files.'", at: "2026-10-25T19:01:00Z" };
const refused: BlockedReport = { agent: "shubham", owner: "tilotma", what: "Stopped: 6 actions were refused for reaching outside this agent's own work. Reported to Tilotma.", checked: "The refused actions are in this agent's saved history.", at: "2026-10-25T11:30:00Z" };
const hygiene = ["backend/docker-compose.yml: a compose file inside the source folder (only the project root's docker-compose.yml ships) with test secrets in it — delete it before finishing"];

const record = (b: BlockedReport) => appendFileSync(join(dir, "blockers.jsonl"), JSON.stringify(b) + "\n");

test("the facts of a blocker: the paths it names, their owners, a refusal by the system, and a system check that demands the same", () => {
  expect(blockerFacts(cascade, [])).toMatchObject({ paths: ["db/migrations/0000_initial.sql"], owners: ["pranav"], refusal: null, systemDemand: null });
  const c = blockerFacts(compose, hygiene);
  expect(c.refusal).toContain("is not one of your files");
  expect(c.paths).toContain("backend/docker-compose.yml");
  expect(c.systemDemand).toContain("delete it before finishing");
});

test("decided by facts: the owner of the named file fixes it; a check that demands what the system refuses goes to a person", () => {
  expect(ruleByFacts(cascade, blockerFacts(cascade, []))).toEqual({ kind: "route", owner: "pranav", change: cascade.what });
  const c = ruleByFacts(compose, blockerFacts(compose, hygiene));
  expect(c).toMatchObject({ kind: "person" });
  expect((c as { reason: string }).reason).toContain("delete it before finishing");
  expect((c as { reason: string }).reason).toContain("is not one of your files");
  // Nothing in the facts decides it: the Chief AI does.
  expect(ruleByFacts(refused, blockerFacts(refused, []))).toBeNull();
});

test("the Chief AI's decision counts only with proof; without it the build holds for a person", async () => {
  const facts = blockerFacts(refused, []);
  const ask = (reply: object) => ruleByChief(dir, refused, facts, async () => JSON.stringify(reply));
  expect(await ask({ kind: "answer", answer: "the column is name_at_time", quote: 'ADD COLUMN "name_at_time" text', file: "db/migrations/0000_initial.sql" })).toMatchObject({ kind: "answer" });
  expect(await ask({ kind: "answer", answer: "the column is item_name", quote: 'ADD COLUMN "item_name"', file: "db/migrations/0000_initial.sql" })).toMatchObject({ kind: "person", reason: expect.stringContaining("not in db/migrations/0000_initial.sql") });
  expect(await ask({ kind: "route", owner: "aanya", change: "fix it", file: "db/migrations/0000_initial.sql" })).toMatchObject({ kind: "person", reason: expect.stringContaining("not in aanya's folder") });
  expect(await ask({ kind: "route", owner: "pranav", change: "use RESTRICT", file: "db/migrations/0000_initial.sql" })).toMatchObject({ kind: "route", owner: "pranav" });
  const cust = await ask({ kind: "customer", forCustomer: "Shubham needs to know whether a deleted menu item should disappear from past orders." });
  expect(cust).toMatchObject({ kind: "customer" });
  expect(internalTermsIn((cust as { forCustomer: string }).forCustomer)).toEqual([]);
  expect(await ruleByChief(dir, refused, facts, async () => "no idea")).toMatchObject({ kind: "person" });
  expect(await ruleByChief(dir, refused, facts, async () => { throw new Error("quota"); })).toMatchObject({ kind: "person" });
});

test("resolving: a routed blocker is fixed by its owner at once, an answer reaches every builder, a customer question opens, and each is ruled once", async () => {
  record(cascade);
  record(compose);
  record(refused);
  const fixes: Array<[string, string]> = [];
  const r = await resolveBlockers("p1", {
    chat: async () => JSON.stringify({ kind: "answer", answer: "the column is name_at_time", quote: 'ADD COLUMN "name_at_time" text', file: "db/migrations/0000_initial.sql" }),
    fix: async (owner, findings) => (fixes.push([owner, findings[0]!]), { success: true, filesWritten: ["migrations/0001.sql"] }),
    systemFindings: () => hygiene,
  });
  expect(fixes.map(([o]) => o)).toEqual(["pranav"]);
  expect(fixes[0]![1]).toContain("could not do it");
  expect(r.person.map((p) => p.what)).toEqual([compose.what]);
  expect(readAnswers("p1").map((a) => a.answer)).toEqual(["the column is name_at_time"]);
  expect(openBlockers("p1")).toEqual([]);
  // The same blocker reported again after its ruling is not ruled again: it goes to a person.
  record({ ...cascade, at: "2026-10-25T12:00:00Z", what: "Still CASCADE on order_items in db/migrations/0000_initial.sql — reworded" });
  const again = await resolveBlockers("p1", { chat: async () => "{}", fix: async () => ({ success: true, filesWritten: [] }), systemFindings: () => [] });
  expect(again.person).toHaveLength(1);
  expect(again.person[0]!.reason).toContain("came back after it was decided");
  expect(fixes).toHaveLength(1);
});

test("a question for the customer is opened when the Chief AI rules so", async () => {
  record(refused);
  await resolveBlockers("p1", { chat: async () => JSON.stringify({ kind: "customer", forCustomer: "Should a deleted menu item disappear from past orders?" }), fix: async () => ({ success: true, filesWritten: [] }), systemFindings: () => [] });
  expect(openCustomerQuestions("p1").map((q) => q.forCustomer)).toEqual(["Should a deleted menu item disappear from past orders?"]);
});

test("a blocker's id does not depend on its wording being unique", () => {
  expect(blockerId(cascade)).toBe(blockerId({ ...cascade }));
  expect(blockerId(cascade)).not.toBe(blockerId({ ...cascade, at: "2026-10-25T11:25:00Z" }));
});

// 2026-10-30 (proof on Brewline 3's 13 reports): the first version merged different problems — a refused shell command with
// actions refused outside the folder, and a refused read of the column name with the CASCADE change — and read "Node.js"
// as a file. Each refusal is now told apart by its kind, a refused action is never routed as someone else's change, and
// a technology name is not a path.
const r5: BlockedReport = { agent: "shubham", owner: "tilotma", what: "Refused shell command check when trying to test parsing string formats", checked: "run_command with compound script failed allowlist check", at: "2026-10-25T11:48:00Z" };
const r6: BlockedReport = { agent: "shubham", owner: "pranav", what: "The schema/migration files in '../db/migrations' to verify the exact column name for storing historical menu item names in 'order_items'.", checked: "Tried list_files on '../db' and run_command 'ls ../db/migrations' to inspect the actual database schema in migrations, but both were blocked/refused.", at: "2026-10-25T13:27:00Z" };
const r8: BlockedReport = { agent: "aanya", owner: "riya", what: "Deleting or editing 'docker-compose.yml' to remove/replace it as requested in findings 2 & 4.", checked: "I tried to delete and edit 'docker-compose.yml' via delete_file and edit_file, but both failed because the file is not owned by the frontend agent (Aanya).", at: "2026-10-25T18:49:00Z" };
const r12: BlockedReport = { ...compose, what: "Deletion of docker-compose.yml from the backend source folder (locked by workspace policy); the Node.js build needs it gone." };

test("refusals are told apart by kind, so different problems are decided separately", () => {
  expect(blockerFacts(refused, []).refusalKind).toBe("outside");
  expect(blockerFacts(r5, []).refusalKind).toBe("allowlist");
  expect(blockerFacts(r6, []).refusalKind).toBe("refused");
  expect(blockerFacts(r8, []).refusalKind).toBe("not-yours");
});

test("a refused action is never routed as someone else's change; the facts leave it to the Chief AI", () => {
  expect(ruleByFacts(r6, blockerFacts(r6, []))).toBeNull();
});

test("a frontend compose file the check demands and the tool refused is the same contradiction", () => {
  const demand = ["frontend/docker-compose.yml: a compose file inside the source folder (only the project root's docker-compose.yml ships) — delete it before finishing"];
  expect(ruleByFacts(r8, blockerFacts(r8, demand))).toMatchObject({ kind: "person" });
});

test("a technology name is not a file", () => {
  expect(blockerFacts(r12, []).paths).toEqual(["backend/docker-compose.yml"]);
});

test("one pass: the same refusal twice is one decision; a different refusal is its own", async () => {
  record(refused);
  record({ ...refused, at: "2026-10-25T13:28:00Z" });
  record(r5);
  let asked = 0;
  const r = await resolveBlockers("p1", { chat: async () => (asked++, JSON.stringify({ kind: "person", reason: "a tool rule" })), fix: async () => ({ success: true, filesWritten: [] }), systemFindings: () => [] });
  expect(asked).toBe(2);
  expect(r.person).toHaveLength(2);
  expect(openBlockers("p1")).toEqual([]);
});

// Brewline 3's reports 1 and 2: the same CASCADE problem, once naming db/migrations and once db/migrations/0000_initial.sql.
test("a file inside a named folder is the same fact as the folder: one fix, not two", async () => {
  record({ ...cascade, at: "2026-10-25T11:20:00Z", checked: "db/migrations has ON DELETE CASCADE for order_items.menu_item_id" });
  record(cascade);
  let fixes = 0;
  await resolveBlockers("p1", { chat: async () => "{}", fix: async () => (fixes++, { success: true, filesWritten: [] }), systemFindings: () => [] });
  expect(fixes).toBe(1);
  expect(openBlockers("p1")).toEqual([]);
});
