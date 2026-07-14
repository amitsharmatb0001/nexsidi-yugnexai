import { expect, test } from "bun:test";
import { buildMismatchObservations, selectRecurringInstructionUpdates } from "./instinct-observer.ts";

test("buildMismatchObservations records a critical later finding missed by a clean review", () => {
  expect(buildMismatchObservations([{ agentName: "navya", findings: [] }], [{ severity: "CRITICAL", issue: "Null dereference" }])).toHaveLength(1);
});

test("selectRecurringInstructionUpdates requires two matching observations", () => {
  expect(selectRecurringInstructionUpdates([
    { agentName: "deepika", missedFinding: "N+1", createdAt: "2026-07-14" },
    { agentName: "deepika", missedFinding: "N+1", createdAt: "2026-07-14" },
  ])).toEqual([{ agentName: "deepika", missedFinding: "N+1", occurrences: 2 }]);
});
