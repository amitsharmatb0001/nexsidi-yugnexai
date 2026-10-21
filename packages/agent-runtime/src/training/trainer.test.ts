import { test, expect } from "bun:test";
import { nextLevel, type RoundResult } from "./curriculum.ts";
import { runTrainingRound, isCaught, memoryStore, recordRound, formatMissedForPrompt, type Checker, type TrainingFile } from "./trainer.ts";
import { MUTATIONS, plantDefect } from "./mutations.ts";

// Patent claim 4: checkers are trained against defects. An adversarial example database keeps the defects a checker missed,
// a curriculum raises the difficulty as the checker gets better, and the missed examples go back into the checker's prompt.

const r = (level: 1 | 2 | 3 | 4 | 5, planted: number, caught: number): RoundResult => ({ level, planted, caught });

test("the curriculum moves up when the checker catches most defects at the current level, over two rounds", () => {
  expect(nextLevel(2, [r(2, 5, 5), r(2, 5, 4)]).level).toBe(3);
});

test("it moves down when the checker catches few, and stays when it is in between or has too little history", () => {
  expect(nextLevel(3, [r(3, 5, 1), r(3, 5, 1)]).level).toBe(2);
  expect(nextLevel(3, [r(3, 5, 3), r(3, 5, 3)]).level).toBe(3);
  expect(nextLevel(3, [r(3, 5, 5)]).level).toBe(3);
  expect(nextLevel(3, [r(3, 5, 5)]).reason).toContain("not enough");
});

test("it never goes below level 1 or above level 5, and only rounds at the current level count", () => {
  expect(nextLevel(1, [r(1, 5, 0), r(1, 5, 0)]).level).toBe(1);
  expect(nextLevel(5, [r(5, 5, 5), r(5, 5, 5)]).level).toBe(5);
  expect(nextLevel(3, [r(2, 5, 5), r(2, 5, 5), r(3, 5, 5)]).level).toBe(3); // the level-2 rounds do not count towards level 3
});

const FILE_A: TrainingFile = {
  path: "backend/src/routes/items.ts",
  source: `import { Router } from "express";
const router = Router();
router.get("/items/:id", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const rows = await db.query("SELECT * FROM items WHERE id = $1", [req.params.id]);
  res.json(rows.rows);
});
export default router;
`,
};
const FILE_B: TrainingFile = { path: "backend/src/lib/util.ts", source: `export const add = (a: number, b: number) => a + b;\n` };

test("a checker that finds nothing misses every planted defect", async () => {
  const none: Checker = async () => [];
  const res = await runTrainingRound({ checker: none, checkerName: "none", files: [FILE_A, FILE_B], level: 3, count: 3 });
  expect(res.planted.length).toBeGreaterThan(0);
  expect(res.caught).toEqual([]);
  expect(res.missed.length).toBe(res.planted.length);
  expect(res.catchRate).toBe(0);
});

test("a checker that reports on the planted line is credited, and its baseline findings are not", async () => {
  const ideal: Checker = async (files) => {
    const out: Array<{ file: string; line?: number; issue: string }> = [{ file: "backend/src/lib/util.ts", line: 1, issue: "an old complaint that was always there" }];
    for (const f of files) if (!f.source.includes("if (!req.user)") && f.path.endsWith("items.ts")) out.push({ file: f.path, line: 4, issue: "the sign-in check is missing" });
    return out;
  };
  const res = await runTrainingRound({ checker: ideal, checkerName: "ideal", files: [FILE_A, FILE_B], level: 3, count: 5 });
  expect(res.caught.map((d) => d.operator)).toContain("remove-auth-check");
  expect(res.baselineFindings).toBe(1);
  expect(res.unexplainedFindings).toBe(0);
});

test("a finding in another file, far from the planted line and not about it, does not count", () => {
  const planted = plantDefect(FILE_A.path, FILE_A.source, MUTATIONS.find((m) => m.operator === "remove-auth-check")!)!.defect;
  expect(isCaught(planted, [{ file: "backend/src/other.ts", line: 4, issue: "sign-in check missing" }])).toBe(false);
  expect(isCaught(planted, [{ file: FILE_A.path, line: 40, issue: "variable could be const" }])).toBe(false);
  expect(isCaught(planted, [{ file: FILE_A.path, line: 5, issue: "anything" }])).toBe(true); // within 3 lines of the planted line
  expect(isCaught(planted, [{ file: FILE_A.path, line: 12, issue: "anything" }])).toBe(false); // too far to be about it
  expect(isCaught(planted, [{ file: FILE_A.path, issue: "route has no authentication" }])).toBe(true); // about it, no line given
});

test("the original files are never changed, and the checker is run on the changed copies", async () => {
  const before = JSON.stringify([FILE_A, FILE_B]);
  const seen: string[] = [];
  await runTrainingRound({ checker: async (files) => (seen.push(...files.map((f) => f.source)), []), checkerName: "c", files: [FILE_A, FILE_B], level: 3, count: 2 });
  expect(JSON.stringify([FILE_A, FILE_B])).toBe(before);
  expect(seen.some((s) => !s.includes("if (!req.user)") && s.includes("items"))).toBe(true);
});

test("the same inputs plant the same defects, so rounds can be compared", async () => {
  const none: Checker = async () => [];
  const a = await runTrainingRound({ checker: none, checkerName: "c", files: [FILE_A, FILE_B], level: 3, count: 3, seed: "s1" });
  const b = await runTrainingRound({ checker: none, checkerName: "c", files: [FILE_A, FILE_B], level: 3, count: 3, seed: "s1" });
  expect(a.planted.map((d) => d.id)).toEqual(b.planted.map((d) => d.id));
});

test("a round with no file the level's defects apply to plants nothing and says so", async () => {
  const res = await runTrainingRound({ checker: async () => [], checkerName: "c", files: [FILE_B], level: 3, count: 3 });
  expect(res.planted).toEqual([]);
  expect(res.catchRate).toBe(0);
  expect(res.note).toContain("no file");
});

test("the examples a checker missed are kept, caught ones are counted, and the history feeds the curriculum", async () => {
  const store = memoryStore();
  const none: Checker = async () => [];
  const res = await runTrainingRound({ checker: none, checkerName: "karan", files: [FILE_A, FILE_B], level: 3, count: 3 });
  await recordRound(store, res);
  const missed = await store.missedFor("karan", 5, 10);
  expect(missed.length).toBe(res.missed.length);
  expect(missed[0]).toMatchObject({ checker: "karan", missed: 1, caught: 0 });
  await recordRound(store, res);
  expect((await store.missedFor("karan", 5, 10))[0]!.missed).toBe(2);
  expect(await store.history("karan")).toEqual([r(3, res.planted.length, 0), r(3, res.planted.length, 0)]);
  expect(await store.missedFor("navya", 5, 10)).toEqual([]);
});

test("the missed examples are written into a short block for the checker's prompt, hardest-missed first and capped", async () => {
  const store = memoryStore();
  const res = await runTrainingRound({ checker: async () => [], checkerName: "karan", files: [FILE_A], level: 3, count: 3 });
  await recordRound(store, res);
  const text = formatMissedForPrompt(await store.missedFor("karan", 5, 10), 5);
  expect(text).toContain("missed before");
  expect(text).toContain("remove-auth-check");
  expect(text).toContain("if (!req.user)");
  expect(formatMissedForPrompt([], 5)).toBe("");
});
