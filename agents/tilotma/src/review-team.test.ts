import { test, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { reviewAreas, mergeCollectorRuns, reviewAreaBlock } from "./tier3-review.ts";

// 2026-10-24 (Amit: split the work in the review too, to bring its time down): the live evidence collector drove the whole
// app alone, one browser action per model call (~16 min a round on Brewline). Up to 3 collectors now run at the same time,
// each covering its share of the approved plan's success criteria in its own browser; their findings are merged and the
// reality checker verifies them once, as before.

const prev = process.env.NEXSIDI_REVIEW_TEAMS;
afterEach(() => {
  if (prev === undefined) delete process.env.NEXSIDI_REVIEW_TEAMS;
  else process.env.NEXSIDI_REVIEW_TEAMS = prev;
});

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `SC${i + 1}`, text: `criterion ${i + 1}` }));

test("the success criteria are shared out across at most 3 collectors; few criteria keep one collector", () => {
  const areas = reviewAreas(items(8));
  expect(areas.length).toBe(3);
  expect(areas.flat().map((i) => i.id).sort()).toEqual(items(8).map((i) => i.id).sort());
  expect(Math.max(...areas.map((a) => a.length)) - Math.min(...areas.map((a) => a.length))).toBeLessThanOrEqual(1);
  expect(reviewAreas(items(2)).length).toBe(1);
  process.env.NEXSIDI_REVIEW_TEAMS = "off";
  expect(reviewAreas(items(8)).length).toBe(1);
});

test("each collector is told its own criteria; the first also covers landing, sign-up and sign-in", () => {
  const areas = reviewAreas(items(6));
  const first = reviewAreaBlock(areas[0]!, 0, areas.length);
  const second = reviewAreaBlock(areas[1]!, 1, areas.length);
  expect(first).toContain("landing page, sign-up and sign-in");
  expect(second).not.toContain("landing page, sign-up and sign-in");
  for (const i of areas[1]!) expect(second).toContain(`[${i.id}]`);
});

test("the collectors' findings are merged; the review is complete only if every collector finished", () => {
  const summary = (lines: string[]) => `FINDINGS:\n${lines.map((l) => `- ${l}`).join("\n")}\nVERDICT: NEEDS_WORK`;
  const merged = mergeCollectorRuns([
    { success: true, summary: summary(["[SC1] menu page is empty"]), errors: [] },
    { success: false, summary: summary(["[SC4] order total is wrong"]), errors: ["ran out of steps"] },
  ]);
  expect(merged.success).toBe(false);
  expect(merged.summary).toContain("[SC1] menu page is empty");
  expect(merged.summary).toContain("[SC4] order total is wrong");
  expect(merged.errors).toEqual(["ran out of steps"]);
});

test("the live review runs its collectors at the same time, each on its own model and screenshot folder", () => {
  const src = readFileSync(new URL("./tier3-review.ts", import.meta.url), "utf-8");
  expect(src).toContain("await Promise.all(areas.map(");
  expect(src).toContain("firstModelIndex: i");
  expect(src).toContain("`${screenshotDir}/area-${i + 1}`");
});
