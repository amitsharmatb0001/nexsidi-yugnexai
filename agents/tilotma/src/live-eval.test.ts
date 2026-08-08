import { test, expect } from "bun:test";
import {
  parseLiveEvalScores,
  calculateLiveScore,
  buildLiveEvalTask,
  runLiveEval,
  LIVE_EVAL_WEIGHTS,
  LIVE_PASS_THRESHOLD,
  LIVE_EVAL_SYSTEM_PROMPT,
  type LiveEvalDeps,
} from "./live-eval.ts";

// System B (subjective live quality — CLAUDE.md) did not exist before this
// file: runLiveTest (pipeline/activities/index.ts) was a hardcoded
// `return 8.0` stub with zero callers. These tests cover the deterministic
// scoring/parsing logic; the real agent call (runAgentEscalated, live
// browser tools) is exercised via injected deps, same convention as
// tier3-review's Stage1/Stage2 agent calls not being unit-tested directly.

test("LIVE_EVAL_WEIGHTS matches CLAUDE.md System B exactly: design+originality 0.35 each, craft+functionality 0.15 each", () => {
  expect(LIVE_EVAL_WEIGHTS).toEqual({ designQuality: 0.35, originality: 0.35, craft: 0.15, functionality: 0.15 });
  const total = Object.values(LIVE_EVAL_WEIGHTS).reduce((a, b) => a + b, 0);
  expect(total).toBeCloseTo(1.0, 10);
});

test("LIVE_PASS_THRESHOLD is 7.0 per CLAUDE.md System B", () => {
  expect(LIVE_PASS_THRESHOLD).toBe(7.0);
});

test("calculateLiveScore: all 10s scores 10", () => {
  expect(calculateLiveScore({ designQuality: 10, originality: 10, craft: 10, functionality: 10 })).toBe(10);
});

test("calculateLiveScore: all 1s scores 1", () => {
  expect(calculateLiveScore({ designQuality: 1, originality: 1, craft: 1, functionality: 1 })).toBe(1);
});

// The whole point of the 0.35/0.35/0.15/0.15 split (per CLAUDE.md's own
// stated rationale): Claude-tier models already score well on craft/
// functionality by default, so weighting design+originality higher is what
// actually penalizes AI-slop (generic layout, purple gradients) even when
// the app is technically competent and usable.
test("calculateLiveScore: design+originality dominate the weighted score over craft+functionality", () => {
  const slop = calculateLiveScore({ designQuality: 3, originality: 2, craft: 9, functionality: 9 });
  const distinctive = calculateLiveScore({ designQuality: 9, originality: 9, craft: 6, functionality: 6 });
  expect(distinctive).toBeGreaterThan(slop);
});

test("calculateLiveScore: a realistic passing profile clears the 7.0 threshold", () => {
  const score = calculateLiveScore({ designQuality: 8, originality: 7, craft: 8, functionality: 8 });
  expect(score).toBeGreaterThanOrEqual(LIVE_PASS_THRESHOLD);
});

test("parseLiveEvalScores extracts a well-formed score block", () => {
  const summary = `DESIGN_QUALITY: 8
ORIGINALITY: 7.5
CRAFT: 9
FUNCTIONALITY: 8
REASONING: coherent palette, custom hero layout, clean spacing, primary CTA is obvious`;
  expect(parseLiveEvalScores(summary)).toEqual({ designQuality: 8, originality: 7.5, craft: 9, functionality: 8 });
});

test("parseLiveEvalScores is case-insensitive and tolerant of extra whitespace", () => {
  const summary = "design_quality:  6\noriginality: 5\ncraft:7\nfunctionality: 6.5";
  expect(parseLiveEvalScores(summary)).toEqual({ designQuality: 6, originality: 5, craft: 7, functionality: 6.5 });
});

test("parseLiveEvalScores returns null (not an invented score) when the block is missing entirely", () => {
  expect(parseLiveEvalScores("The agent got confused and never produced a score block.")).toBeNull();
});

test("parseLiveEvalScores returns null when any single dimension is missing — a partial score is not a score", () => {
  const summary = `DESIGN_QUALITY: 8
ORIGINALITY: 7
CRAFT: 9`; // functionality missing
  expect(parseLiveEvalScores(summary)).toBeNull();
});

test("parseLiveEvalScores returns null when a score is out of the valid 1-10 range", () => {
  const summary = `DESIGN_QUALITY: 11
ORIGINALITY: 7
CRAFT: 9
FUNCTIONALITY: 8`;
  expect(parseLiveEvalScores(summary)).toBeNull();
});

test("buildLiveEvalTask includes the frontend URL and the screenshot directory", () => {
  const task = buildLiveEvalTask("proj1", "http://localhost:3200", "live-eval-screenshots/proj1");
  expect(task).toContain("FRONTEND URL: http://localhost:3200");
  expect(task).toContain("live-eval-screenshots/proj1");
});

test("LIVE_EVAL_SYSTEM_PROMPT cites the verbatim CLAUDE.md System B criteria text, not a paraphrase", () => {
  expect(LIVE_EVAL_SYSTEM_PROMPT).toContain("coherent whole");
  expect(LIVE_EVAL_SYSTEM_PROMPT).toContain("purple gradients over white cards");
  expect(LIVE_EVAL_SYSTEM_PROMPT).toContain("A competence check, not a");
});

test("runLiveEval computes pass/score from the agent's parsed summary", async () => {
  const deps: LiveEvalDeps = {
    runAgent: async () => ({
      success: true,
      summary: "DESIGN_QUALITY: 8\nORIGINALITY: 8\nCRAFT: 8\nFUNCTIONALITY: 8",
      filesWritten: [],
      iterations: 5,
      errors: [],
      escalated: false,
    }),
  };
  const result = await runLiveEval("diagproj", "http://localhost:3200", "/tmp/frontend", deps);
  expect(result.score).toBe(8);
  expect(result.pass).toBe(true);
  expect(result.scores).toEqual({ designQuality: 8, originality: 8, craft: 8, functionality: 8 });
});

// 2026-08-07: real bug found live (project bae438767bed, redeploy #5) —
// runLiveEval used the shared MAX_ITERATIONS default (40) with no scaling
// to real app size, and hit the cap mid-investigation (reading component
// source) with no task_complete, losing the whole evaluation pass. Same
// class of bug as Tier 3's computeTier3MaxIterations fix; same fix here.
// Also verifies readOnly (D26 — a judge is not a fixer, see loop.ts).
test("runLiveEval scales maxIterations by real page count and runs readOnly", async () => {
  let capturedConfig: any;
  const deps: LiveEvalDeps = {
    runAgent: async (config: any) => {
      capturedConfig = config;
      return {
        success: true,
        summary: "DESIGN_QUALITY: 8\nORIGINALITY: 8\nCRAFT: 8\nFUNCTIONALITY: 8",
        filesWritten: [],
        iterations: 5,
        errors: [],
        escalated: false,
      };
    },
  };
  await runLiveEval("diagproj", "http://localhost:3200", "/tmp/nonexistent-frontend-dir", deps);
  expect(capturedConfig.readOnly).toBe(true);
  // countAppPages returns 0 for a missing dir (see tier3-review.test.ts) —
  // computeTier3MaxIterations(0) still floors at the shared default, so this
  // asserts the wiring is live, not a specific number tied to a fixture.
  expect(typeof capturedConfig.maxIterations).toBe("number");
  expect(capturedConfig.maxIterations).toBeGreaterThanOrEqual(40);
});

// D25-style default-FAIL: an unparseable evaluation must never silently
// read as a passing score.
test("runLiveEval defaults to FAIL when the agent's summary has no parseable score block", async () => {
  const deps: LiveEvalDeps = {
    runAgent: async () => ({
      success: true,
      summary: "I looked at the app and it seemed fine.",
      filesWritten: [],
      iterations: 3,
      errors: [],
      escalated: false,
    }),
  };
  const result = await runLiveEval("diagproj", "http://localhost:3200", "/tmp/frontend", deps);
  expect(result.pass).toBe(false);
  expect(result.score).toBe(0);
  expect(result.scores).toBeNull();
});

test("runLiveEval fails a low-scoring (slop) evaluation even when the agent run itself succeeded", async () => {
  const deps: LiveEvalDeps = {
    runAgent: async () => ({
      success: true,
      summary: "DESIGN_QUALITY: 3\nORIGINALITY: 2\nCRAFT: 6\nFUNCTIONALITY: 7",
      filesWritten: [],
      iterations: 5,
      errors: [],
      escalated: false,
    }),
    // A low design/originality score triggers the instinct-memory write
    // path (see runLiveEval) — stub it so this test doesn't make a real
    // LLM call via the un-stubbable summarizeFindingToInstinctRule.
    recordDesignInstinct: async () => {},
  };
  const result = await runLiveEval("diagproj", "http://localhost:3200", "/tmp/frontend", deps);
  expect(result.pass).toBe(false);
  expect(result.score).toBeLessThan(LIVE_PASS_THRESHOLD);
});

// 2026-08-08: real gap found live, explicit user request (project
// bae438767bed) — this whole qualitative review path had zero connection
// to instinct memory before this fix; recordInstinct was only ever called
// from the static QA fix-loop. These tests confirm the write actually
// fires on a low score and is skipped on a good one.
test("runLiveEval records a design instinct when designQuality or originality scores below the pass threshold", async () => {
  const recorded: string[] = [];
  const deps: LiveEvalDeps = {
    runAgent: async () => ({
      success: true,
      summary: "DESIGN_QUALITY: 3\nORIGINALITY: 2\nCRAFT: 6\nFUNCTIONALITY: 7",
      filesWritten: [],
      iterations: 5,
      errors: [],
      escalated: false,
    }),
    recordDesignInstinct: async (findingText) => { recorded.push(findingText); },
  };
  await runLiveEval("diagproj", "http://localhost:3200", "/tmp/frontend", deps);
  expect(recorded.length).toBe(1);
  expect(recorded[0]).toContain("DESIGN_QUALITY");
});

test("runLiveEval does NOT record a design instinct when the score passes", async () => {
  const recorded: string[] = [];
  const deps: LiveEvalDeps = {
    runAgent: async () => ({
      success: true,
      summary: "DESIGN_QUALITY: 8\nORIGINALITY: 8\nCRAFT: 8\nFUNCTIONALITY: 8",
      filesWritten: [],
      iterations: 5,
      errors: [],
      escalated: false,
    }),
    recordDesignInstinct: async (findingText) => { recorded.push(findingText); },
  };
  await runLiveEval("diagproj", "http://localhost:3200", "/tmp/frontend", deps);
  expect(recorded.length).toBe(0);
});

test("runLiveEval does NOT record a design instinct when only craft/functionality are low but design/originality pass", async () => {
  const recorded: string[] = [];
  const deps: LiveEvalDeps = {
    runAgent: async () => ({
      success: true,
      summary: "DESIGN_QUALITY: 8\nORIGINALITY: 8\nCRAFT: 3\nFUNCTIONALITY: 4",
      filesWritten: [],
      iterations: 5,
      errors: [],
      escalated: false,
    }),
    recordDesignInstinct: async (findingText) => { recorded.push(findingText); },
  };
  await runLiveEval("diagproj", "http://localhost:3200", "/tmp/frontend", deps);
  expect(recorded.length).toBe(0);
});

test("runLiveEval rejects an invalid projectId before calling the agent (assertValidIdentifier)", async () => {
  const deps: LiveEvalDeps = {
    runAgent: async () => {
      throw new Error("should not be called");
    },
  };
  await expect(runLiveEval("../../etc/passwd", "http://localhost:3200", "/tmp/frontend", deps)).rejects.toThrow();
});
