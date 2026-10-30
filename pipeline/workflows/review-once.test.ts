import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-30 (team plan, stage 5): the three reviewers, the browser review and the design review each run once, and every
// finding needs proof. Checked in source, like the other wiring tests: the live paths call models and a browser.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf-8");
const loop = read("../orchestrator/stages/stage5-qa-fix-loop.ts");
const stage5 = read("../orchestrator/stages/stage5-adversarial-qa.ts");
const stage6 = read("../orchestrator/stages/stage6-deployment.ts");
const tier3 = read("../../agents/tilotma/src/tier3-review.ts");
const qaLoop = read("../../packages/agent-runtime/src/qa-loop.ts");

test("the review step runs the reviewers once by default; REVIEW_ONCE=off brings back the rounds", () => {
  const fn = loop.slice(loop.indexOf("export async function runQAFixLoop("));
  expect(fn).toContain('if (process.env.REVIEW_ONCE !== "off") {');
  expect(fn).toContain("runReviewOnceWithDeps(");
  expect(fn).toContain("runAcceptanceGate(");
  expect(fn).toContain("recordReviewExamples(");
});

test("on the live step the static reviewers are not run again; the browser and design reviews each run once", () => {
  const start = stage6.indexOf('if (process.env.REVIEW_ONCE !== "off" && !browserReviewOnly) {\n      const dir = buildDirFor(projectId);');
  const end = stage6.indexOf("let result: Stage5Result;", start);
  expect(start).toBeGreaterThan(0);
  const once = stage6.slice(start, end);
  expect(once).not.toContain("runStage5(");
  expect(once).toContain("liveReviewState(dir)");
  expect(once).toContain('markLiveReview(dir, "browser")');
  expect(once).toContain('markLiveReview(dir, "design")');
  expect(once).toContain("proveLiveFindings(");
});

test("every reviewer is told what proof is, and the findings tool takes a reproduction", () => {
  expect(stage5).toContain("PROOF: a finding about what the customer asked for");
  expect(tier3).toContain('(process.env.REVIEW_ONCE !== "off" ? reproInstruction() : "")');
  expect(qaLoop).toContain('required: ["title", "as", "kind", "steps"]');
});
