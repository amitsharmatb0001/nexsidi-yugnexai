import { test, expect } from "bun:test";
import { planConsolidation, applyConsolidation, undoConsolidation, type Store, type ProjectRow, type UserRow } from "./consolidate-projects.ts";

// Moving every older project under one account. Ownership is one column (projects.user_id); everything else is keyed by project id.

const users: UserRow[] = [
  { id: "u-main", email: "Amit@Yugnex.com" },
  { id: "u-gmail", email: "amitsharma.tb0001@gmail.com" },
  { id: "u-test", email: "ui-check@example.test" },
];
const p = (id: string, userId: string, name = id): ProjectRow => ({ id, userId, name, status: "done", createdAt: "2026-10-01" });
const projects: ProjectRow[] = [p("a1", "u-main"), p("a2", "u-main"), p("b1", "u-gmail"), p("b2", "u-gmail"), p("c1", "u-test"), p("o1", "u-ghost")];

function fakeStore(rows: ProjectRow[]): Store & { rows: ProjectRow[]; calls: string[] } {
  const state = rows.map((r) => ({ ...r }));
  const calls: string[] = [];
  return {
    rows: state,
    calls,
    users: async () => users,
    projects: async () => state.map((r) => ({ ...r })),
    reassign: async (ids, to) => {
      calls.push(`reassign ${ids.length}`);
      let n = 0;
      for (const r of state) if (ids.includes(r.id)) (r.userId = to, n++);
      return n;
    },
    restore: async (back) => {
      calls.push(`restore ${back.length}`);
      for (const b of back) {
        const r = state.find((x) => x.id === b.id);
        if (r) r.userId = b.userId;
      }
      return back.length;
    },
  };
}

test("the target is found by email without regard to case, and every other owner's projects are planned to move", () => {
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  expect(plan.target.id).toBe("u-main");
  expect(plan.moves.map((m) => m.project.id).sort()).toEqual(["b1", "b2", "c1", "o1"]);
  expect(plan.alreadyOnTarget).toBe(2);
});

test("owners are summarised, including an owner id that no user account has (an orphan)", () => {
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  const by = Object.fromEntries(plan.owners.map((o) => [o.label, o.count]));
  expect(by["amitsharma.tb0001@gmail.com"]).toBe(2);
  expect(by["(no account: u-ghost)"]).toBe(1);
});

test("--from limits the move to the named owners; the rest stay where they are", () => {
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com", from: ["amitsharma.tb0001@gmail.com"] });
  if ("error" in plan) throw new Error(plan.error);
  expect(plan.moves.map((m) => m.project.id).sort()).toEqual(["b1", "b2"]);
});

test("an unknown target, an ambiguous target, or an unknown --from owner is an error, not a guess", () => {
  expect("error" in planConsolidation(users, projects, { to: "nobody@x.com" })).toBe(true);
  expect("error" in planConsolidation([...users, { id: "u-dup", email: "amit@yugnex.com" }], projects, { to: "amit@yugnex.com" })).toBe(true);
  expect("error" in planConsolidation(users, projects, { to: "amit@yugnex.com", from: ["ghost@x.com"] })).toBe(true);
});

test("a plan with nothing to move says so and applying it changes nothing", async () => {
  const plan = planConsolidation(users, [p("a1", "u-main")], { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  expect(plan.moves).toEqual([]);
  const store = fakeStore([p("a1", "u-main")]);
  const r = await applyConsolidation(store, plan, async () => "unused");
  expect(r.moved).toBe(0);
  expect(store.calls).toEqual([]);
});

test("applying writes the backup FIRST, moves every planned project, and checks the result", async () => {
  const store = fakeStore(projects);
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  const order: string[] = [];
  let saved: any = null;
  const r = await applyConsolidation(store, plan, async (backup) => {
    order.push("backup");
    saved = backup;
    return "backup-file.json";
  });
  order.push("done");
  expect(order).toEqual(["backup", "done"]);
  expect(r).toMatchObject({ moved: 4, backupPath: "backup-file.json" });
  expect(store.rows.every((x) => x.userId === "u-main")).toBe(true);
  expect(saved.rows.map((x: any) => `${x.id}:${x.userId}`).sort()).toEqual(["b1:u-gmail", "b2:u-gmail", "c1:u-test", "o1:u-ghost"]);
});

test("if the backup cannot be written nothing is moved", async () => {
  const store = fakeStore(projects);
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  await expect(applyConsolidation(store, plan, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
  expect(store.calls).toEqual([]);
  expect(store.rows.filter((x) => x.userId !== "u-main").length).toBe(4);
});

test("if fewer rows moved than planned the result is reported as a failure, not success", async () => {
  const store = fakeStore(projects);
  store.reassign = async () => 3;
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  await expect(applyConsolidation(store, plan, async () => "b.json")).rejects.toThrow("expected 4");
});

test("undo puts every project back with the owner it had, from the backup alone", async () => {
  const store = fakeStore(projects);
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  let saved: any;
  await applyConsolidation(store, plan, async (b) => ((saved = b), "b.json"));
  const r = await undoConsolidation(store, saved);
  expect(r.restored).toBe(4);
  expect(store.rows.map((x) => `${x.id}:${x.userId}`).sort()).toEqual(projects.map((x) => `${x.id}:${x.userId}`).sort());
});

test("undo leaves alone a project that has since been moved by someone else", async () => {
  const store = fakeStore(projects);
  const plan = planConsolidation(users, projects, { to: "amit@yugnex.com" });
  if ("error" in plan) throw new Error(plan.error);
  let saved: any;
  await applyConsolidation(store, plan, async (b) => ((saved = b), "b.json"));
  store.rows.find((x) => x.id === "b1")!.userId = "u-test"; // changed after the consolidation
  const r = await undoConsolidation(store, saved);
  expect(r.restored).toBe(3);
  expect(r.skipped).toEqual(["b1"]);
  expect(store.rows.find((x) => x.id === "b1")!.userId).toBe("u-test");
});
