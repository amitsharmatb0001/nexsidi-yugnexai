import { test, expect } from "bun:test";
import { parseAndScoreFindings, run, QA_SYSTEM_PROMPT } from "./index.ts";

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
    JSON.stringify([{ severity: "LOW", category: "allocation", detail: "minor unnecessary copy" }]),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.score).toBe(99);
});

test("a mix of findings landing above 85 passes — exact CRITICAL/HIGH/MEDIUM/LOW arithmetic", () => {
  // 1 MEDIUM (-5) + 2 LOW (-2) = 100 - 7 = 93 >= 85 -> passes
  const result = parseAndScoreFindings(
    JSON.stringify({
      findings: [
        { severity: "MEDIUM", category: "big-o", detail: "O(n^2) sort on already-sorted input" },
        { severity: "LOW", category: "allocation", detail: "unnecessary array copy in a hot path" },
        { severity: "LOW", category: "allocation", detail: "redundant JSON.parse/stringify roundtrip" },
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
        { severity: "CRITICAL", category: "memory-leak", detail: "event listener never removed on unmount" },
        { severity: "HIGH", category: "n-plus-one", detail: "tasks list issues one query per row" },
      ],
    }),
  );
  expect(result.score).toBe(70);
  expect(result.passed).toBe(false);
});

test("score never goes below 0 even with many CRITICAL findings", () => {
  const findings = Array.from({ length: 10 }, () => ({
    severity: "CRITICAL",
    category: "memory-leak",
    detail: "unbounded cache growth",
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
          category: "blocking-call",
          detail: "synchronous fs.readFileSync on the request path",
          file: "backend/src/routes/tasks.routes.ts",
        },
      ],
    }),
  );
  expect(result.findings[0]!.file).toBe("backend/src/routes/tasks.routes.ts");
});

test("a finding without a file field leaves file undefined rather than inventing one", () => {
  const result = parseAndScoreFindings(
    JSON.stringify({ findings: [{ severity: "LOW", category: "allocation", detail: "no file supplied" }] }),
  );
  expect(result.findings[0]!.file).toBeUndefined();
});

// Found in stress-test 1 (F7): the model's real output was wrapped in
// markdown code fences despite the prompt saying "Output ONLY JSON",
// tripping the D25 default-FAIL path even though the underlying findings
// were well-formed JSON.
test("JSON wrapped in ```json fences is still parsed correctly, not treated as a parse failure", () => {
  const fenced = "```json\n" + JSON.stringify({ findings: [] }) + "\n```";
  const result = parseAndScoreFindings(fenced);
  expect(result.score).toBe(100);
  expect(result.passed).toBe(true);
  expect(result.findings).toEqual([]);
});

test("JSON wrapped in bare ``` fences (no json tag) is still parsed correctly", () => {
  const fenced = "```\n" + JSON.stringify({ findings: [{ severity: "LOW", category: "allocation", detail: "x" }] }) + "\n```";
  const result = parseAndScoreFindings(fenced);
  expect(result.findings).toHaveLength(1);
  expect(result.score).toBe(99);
});

test("fenced JSON with leading/trailing whitespace around the fences is still parsed correctly", () => {
  const fenced = "  \n```json\n" + JSON.stringify({ findings: [] }) + "\n```\n  ";
  const result = parseAndScoreFindings(fenced);
  expect(result.passed).toBe(true);
});

// Deepika didn't hit this bug live (her stress5timeout output parsed fine),
// but she carried the IDENTICAL unquoted-key prompt bug found in Karan and
// Navya (grepped and confirmed across all 3 QA agents) — fixed preemptively
// rather than waiting for her turn to fail the same way.
test("QA_SYSTEM_PROMPT's JSON schema example uses quoted keys, not JS object-literal syntax", () => {
  expect(QA_SYSTEM_PROMPT).toContain('"findings"');
  expect(QA_SYSTEM_PROMPT).not.toMatch(/\{\s*findings:/);
});

// A7-pattern retry (same precedent as Saanvi/Arjun, Navya, Karan) — mitigates
// the sporadic empty-response infra flake observed elsewhere in the same run.
test("run() retries once on an empty/unparseable first response before giving up", async () => {
  let callCount = 0;
  const deps = {
    chat: async () => {
      callCount++;
      return callCount === 1
        ? { content: "", modelUsed: "mistralai/mistral-nemotron" as const }
        : { content: JSON.stringify({ findings: [] }), modelUsed: "mistralai/mistral-nemotron" as const };
    },
  };
  const result = await run("diag", 1, "// some code", deps);
  expect(callCount).toBe(2);
  expect(result.passed).toBe(true);
});

test("run() returns the default-FAIL result (not a thrown error) when BOTH attempts are empty/unparseable", async () => {
  const deps = { chat: async () => ({ content: "", modelUsed: "mistralai/mistral-nemotron" as const }) };
  const result = await run("diag", 1, "// some code", deps);
  expect(result.passed).toBe(false);
});
