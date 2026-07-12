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
