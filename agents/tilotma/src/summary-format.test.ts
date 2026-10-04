import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { summaryRejection } from "../../../packages/agent-runtime/src/enforce/summary-format.ts";
import { LIVE_EVAL_SUMMARY_RULE } from "./live-eval.ts";

// 2026-10-04 (Ledgerly run 4, final pass): the design evaluator drove the app
// and wrote a factual log with no judgement and no scores. A follow-up that
// asked another model to invent the scores from that log produced 5/4/6/7 with
// reasoning about "Tailwind defaults" the app does not use — a guess. The
// evaluator must produce its scores itself, while it still has the screenshots
// in front of it: a finish whose summary lacks the score lines is refused and
// it keeps working.
const rule = { pattern: /SCORE:\s*\d/, message: "include a SCORE: line" };

test("a finish that does not match the required format is refused with the reason", () => {
  expect(summaryRejection(rule, "all good, no score")).toBe("include a SCORE: line");
  expect(summaryRejection(rule, "SCORE: 7\nREASONING: x")).toBeNull();
  expect(summaryRejection(undefined, "anything")).toBeNull();
});

test("the design evaluator must include all four score lines to finish", () => {
  const ok = "DESIGN_QUALITY: 8\nORIGINALITY: 7\nCRAFT: 8\nFUNCTIONALITY: 9\nREASONING: x";
  expect(summaryRejection(LIVE_EVAL_SUMMARY_RULE, ok)).toBeNull();
  expect(summaryRejection(LIVE_EVAL_SUMMARY_RULE, "DESIGN_QUALITY: 8\nORIGINALITY: 7")).not.toBeNull();
  expect(summaryRejection(LIVE_EVAL_SUMMARY_RULE, "Evaluated the app, header colour rgb(15,23,42).")).not.toBeNull();
});

test("all three agent loops apply the rule before accepting task_complete", () => {
  for (const f of ["../loop.ts", "../gemini-loop.ts", "../claude-loop.ts"]) {
    const src = readFileSync(new URL("../../../packages/agent-runtime/src/" + f.replace("../", ""), import.meta.url), "utf-8");
    expect({ f, wired: src.includes("summaryRejection(config.summaryMustMatch") }).toEqual({ f, wired: true });
  }
});
