import { test, expect } from "bun:test";
import { runExploring } from "./index.ts";

// 2026-07-11: runExploring() — the tool-loop-based review (qa-loop.ts) that
// replaces the one-shot text-dump run() uses. Same root cause as Navya's
// hallucinated finding: a one-shot call over a dumped codebase has no way
// to verify its own claim. Scoring/error-handling logic tested via the
// injected runAgent, same DI pattern as run()'s `chat` dep — the real
// network loop is verified live, not mocked.

test("runExploring() maps the generic finding shape to SecurityFinding and zero-tolerance-scores it", async () => {
  const deps = {
    runAgent: async () => ({
      findings: [{ severity: "HIGH" as const, category: "csrf", detail: "no CSRF token on state-changing POST" }],
      iterations: 5,
      errors: [],
    }),
  };
  const result = await runExploring("diag", [{ label: "backend", path: "/tmp/x" }], deps);
  expect(result.agent).toBe("karan");
  expect(result.findings[0]!.description).toBe("csrf: no CSRF token on state-changing POST");
  expect(result.score).toBe(90);
  expect(result.passed).toBe(true);
});

// Token-waste-reduction plan, Task 1 (2026-08-16): round-scoped re-review —
// stage5-adversarial-qa.ts threads forward what changed since the last round
// (from Shubham/Aanya/Pranav's own filesWritten) plus Karan's own previous
// findings, so runQAAgent can focus reads there instead of a full
// re-explore. Karan's own findings are SecurityFinding[] ({severity,
// description, file?, line?}), a different shape from qa-loop.ts's
// canonical Finding ({severity, category, detail, file?, line?}) that
// Navya/Deepika share directly with it — runExploring converts before
// threading through, and the round-trip back (via
// qaLoopFindingToSecurityFinding on the returned findings) must not lose the
// original description.
test("runExploring() forwards changedFilesSinceLastRound and converts previousFindings from SecurityFinding to qa-loop's Finding shape", async () => {
  let capturedConfig: any;
  const deps = {
    runAgent: async (config: any) => {
      capturedConfig = config;
      return { findings: [], iterations: 1, errors: [] };
    },
  };
  const previous = [{ severity: "CRITICAL" as const, description: "SQL injection via string-interpolated query", file: "backend/src/db.ts", line: 12 }];
  await runExploring("diag", [{ label: "backend", path: "/tmp/x" }], deps, undefined, ["backend/src/db.ts"], previous);
  expect(capturedConfig.changedFilesSinceLastRound).toEqual(["backend/src/db.ts"]);
  expect(capturedConfig.previousFindings).toHaveLength(1);
  expect(capturedConfig.previousFindings[0].severity).toBe("CRITICAL");
  expect(capturedConfig.previousFindings[0].file).toBe("backend/src/db.ts");
  expect(capturedConfig.previousFindings[0].line).toBe(12);
  // description must survive the conversion into whatever field the qa-loop
  // Finding shape uses (detail) — not silently dropped.
  expect(capturedConfig.previousFindings[0].detail).toContain("SQL injection via string-interpolated query");
});

test("runExploring() omits changedFilesSinceLastRound/previousFindings when not supplied (round 1, backward compatible)", async () => {
  let capturedConfig: any;
  const deps = {
    runAgent: async (config: any) => {
      capturedConfig = config;
      return { findings: [], iterations: 1, errors: [] };
    },
  };
  await runExploring("diag", [{ label: "backend", path: "/tmp/x" }], deps);
  expect(capturedConfig.changedFilesSinceLastRound).toBeUndefined();
  expect(capturedConfig.previousFindings).toBeUndefined();
});

test("runExploring() does NOT default-FAIL when the loop timed out but had no fatal errors", async () => {
  const deps = {
    runAgent: async () => ({ findings: [], iterations: 30, errors: ["Max iterations (30) reached without submit_findings"] }),
  };
  const result = await runExploring("diag", [{ label: "backend", path: "/tmp/x" }], deps);
  expect(result.passed).toBe(true);
  expect(result.score).toBe(100);
});

test("runExploring() does NOT default-FAIL on a detected stuck-loop exit (no fatal error)", async () => {
  const deps = {
    runAgent: async () => ({
      findings: [],
      iterations: 5,
      errors: ["Stuck: karan repeated the identical tool call (read_file:{\"path\":\"backend/src/x.ts\"}) 3 turns in a row with no progress — stopped early instead of grinding to the 30-iteration cap."],
    }),
  };
  const result = await runExploring("diag", [{ label: "backend", path: "/tmp/x" }], deps);
  expect(result.passed).toBe(true);
  expect(result.score).toBe(100);
});

test("runExploring() default-FAILs when there is a fatal error in the loop", async () => {
  const deps = {
    runAgent: async () => ({ findings: [], iterations: 30, errors: ["Gemini call failed on iteration 5: network error"] }),
  };
  const result = await runExploring("diag", [{ label: "backend", path: "/tmp/x" }], deps);
  expect(result.passed).toBe(false);
  expect(result.score).toBe(0);
});

test("runExploring() treats a genuinely clean review as a real pass", async () => {
  const deps = { runAgent: async () => ({ findings: [], iterations: 4, errors: [] }) };
  const result = await runExploring("diag", [{ label: "backend", path: "/tmp/x" }], deps);
  expect(result.passed).toBe(true);
  expect(result.score).toBe(100);
});
