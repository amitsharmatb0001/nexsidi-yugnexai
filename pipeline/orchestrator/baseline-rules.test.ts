import { test, expect } from "bun:test";
import { SECURITY_BASELINE, INTEGRITY_BASELINE, baselineRulesSection } from "./baseline-rules.ts";
import * as chief from "./chief-check.ts";

// 2026-10-29 (team plan, stage 2): one rulebook. The rules every app keeps were given to the reviewers and the Chief AI
// but never to the planner that designs the tables, so Brewline 3's plan had no column for the item's name at order
// time and the review flagged it for 18 rounds. One list, read by every agent that plans, builds or judges.
test("the section lists every security and integrity rule with its id", () => {
  const s = baselineRulesSection();
  SECURITY_BASELINE.forEach((r, i) => expect(s).toContain(`[SEC${i + 1}] ${r}`));
  INTEGRITY_BASELINE.forEach((r, i) => expect(s).toContain(`[INT${i + 1}] ${r}`));
});

test("the reviewers' yardstick uses the very same lists", () => {
  expect(chief.SECURITY_BASELINE).toBe(SECURITY_BASELINE);
  expect(chief.INTEGRITY_BASELINE).toBe(INTEGRITY_BASELINE);
});
