import { test, expect } from "bun:test";
import { parseAndScoreFindings } from "./index.ts";

// parseAndScoreFindings is the deterministic parsing/scoring logic behind
// run() — run() itself calls agentChat (a live LLM call) and isn't
// unit-testable, so these tests exercise the pure function directly, same
// pattern as Karan's scoring.test.ts (Task 9).

test("zero findings -> score 100, passed true", () => {
  const result = parseAndScoreFindings(JSON.stringify({ findings: [] }));
  expect(result.score).toBe(100);
  expect(result.passed).toBe(true);
  expect(result.findings).toEqual([]);
});

test("bare array shape (no findings wrapper) is also accepted", () => {
  const result = parseAndScoreFindings(
    JSON.stringify([{ severity: "LOW", category: "style", detail: "minor inconsistency" }]),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.score).toBe(99);
});

test("a mix of findings landing above 85 passes — exact CRITICAL/HIGH/MEDIUM/LOW arithmetic", () => {
  // 1 MEDIUM (-5) + 2 LOW (-2) = 100 - 7 = 93 >= 85 -> passes
  const result = parseAndScoreFindings(
    JSON.stringify({
      findings: [
        { severity: "MEDIUM", category: "null-ref", detail: "unchecked optional chaining" },
        { severity: "LOW", category: "style", detail: "unused variable" },
        { severity: "LOW", category: "style", detail: "magic number" },
      ],
    }),
  );
  expect(result.score).toBe(93);
  expect(result.passed).toBe(true);
});

test("a mix of findings landing below 85 fails — exact CRITICAL/HIGH/MEDIUM/LOW arithmetic", () => {
  // 1 CRITICAL (-20) + 1 HIGH (-10) = 100 - 30 = 70 < 85 -> fails
  const result = parseAndScoreFindings(
    JSON.stringify({
      findings: [
        { severity: "CRITICAL", category: "null-ref", detail: "unchecked req.body.title access" },
        { severity: "HIGH", category: "type-mismatch", detail: "string compared to number" },
      ],
    }),
  );
  expect(result.score).toBe(70);
  expect(result.passed).toBe(false);
});

test("score never goes below 0 even with many CRITICAL findings", () => {
  const findings = Array.from({ length: 10 }, () => ({
    severity: "CRITICAL",
    category: "null-ref",
    detail: "unchecked access",
  }));
  const result = parseAndScoreFindings(JSON.stringify({ findings }));
  expect(result.score).toBe(0);
  expect(result.passed).toBe(false);
});

test("unknown/garbage severity value falls back safely to MEDIUM, does not crash, does not drop the finding", () => {
  const result = parseAndScoreFindings(
    JSON.stringify({
      findings: [{ severity: "SUPER_DUPER_BAD", category: "unknown", detail: "model made up a severity" }],
    }),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe("MEDIUM");
  expect(result.score).toBe(95); // treated as MEDIUM: 100 - 5
});

test("unparseable JSON content -> default-FAIL (score 0, not passed), not a silent pass", () => {
  const result = parseAndScoreFindings("this is not JSON at all {{{");
  expect(result.score).toBe(0);
  expect(result.passed).toBe(false);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe("CRITICAL");
});

test("a finding with a file field is preserved through parsing", () => {
  const result = parseAndScoreFindings(
    JSON.stringify({
      findings: [
        {
          severity: "HIGH",
          category: "unreachable-code",
          detail: "dead branch after early return",
          file: "backend/src/routes/tasks.routes.ts",
        },
      ],
    }),
  );
  expect(result.findings[0]!.file).toBe("backend/src/routes/tasks.routes.ts");
});

test("a finding without a file field leaves file undefined rather than inventing one", () => {
  const result = parseAndScoreFindings(
    JSON.stringify({ findings: [{ severity: "LOW", category: "style", detail: "no file supplied" }] }),
  );
  expect(result.findings[0]!.file).toBeUndefined();
});
