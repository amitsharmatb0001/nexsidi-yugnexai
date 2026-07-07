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
  const fenced = "```\n" + JSON.stringify({ findings: [{ severity: "LOW", category: "style", detail: "x" }] }) + "\n```";
  const result = parseAndScoreFindings(fenced);
  expect(result.findings).toHaveLength(1);
  expect(result.score).toBe(99);
});

test("fenced JSON with leading/trailing whitespace around the fences is still parsed correctly", () => {
  const fenced = "  \n```json\n" + JSON.stringify({ findings: [] }) + "\n```\n  ";
  const result = parseAndScoreFindings(fenced);
  expect(result.passed).toBe(true);
});

// Found live in stress5timeout (2026-07-04): Karan's raw output was the
// literal string "{ findings: [] }" — valid JAVASCRIPT object-literal syntax
// (unquoted key), INVALID JSON (JSON.parse rejects unquoted keys). Root
// cause, confirmed by re-reading the prompt: the "Output ONLY JSON" example
// itself used unquoted keys ({ findings: [...] } instead of {"findings": [...]}),
// teaching every QA agent's model the wrong syntax. All 3 QA prompts had the
// identical bug (grepped and confirmed). This test locks the fix in place.
test("QA_SYSTEM_PROMPT's JSON schema example uses quoted keys, not JS object-literal syntax", () => {
  expect(QA_SYSTEM_PROMPT).toContain('"findings"');
  expect(QA_SYSTEM_PROMPT).not.toMatch(/\{\s*findings:/); // the exact bug: unquoted "findings:" after a brace
});

// Found live in the same run: Navya's actual API call (qwen/qwen3.5-122b-a10b,
// 82,327 input tokens) returned finish_reason:"stop" with ZERO output
// tokens — a successful HTTP response with empty content, not an error
// nimChat would throw on. Reproduced the request shape directly
// (scripts/ping-qa-large.ts) and could not force it deterministically,
// consistent with the other transient free-tier failures found the same
// run (a 502, a dropped socket) — this is the same class of sporadic
// infra flake, not a code bug. Mitigation: retry once, matching the exact
// precedent already established for Saanvi/Arjun (A7, full-system audit) —
// absorbs a one-off blip without masking a genuinely broken model (which
// fails the retry too and surfaces the real error).
test("run() retries once on an empty/unparseable first response before giving up", async () => {
  let callCount = 0;
  const deps = {
    chat: async () => {
      callCount++;
      return callCount === 1
        ? { content: "", modelUsed: "qwen/qwen3.5-122b-a10b" as const }
        : { content: JSON.stringify({ findings: [] }), modelUsed: "qwen/qwen3.5-122b-a10b" as const };
    },
  };
  const result = await run("diag", 1, "// some code", deps);
  expect(callCount).toBe(2);
  expect(result.passed).toBe(true);
  expect(result.findings).toEqual([]);
});

test("run() returns the default-FAIL result (not a thrown error) when BOTH attempts are empty/unparseable", async () => {
  const deps = { chat: async () => ({ content: "", modelUsed: "qwen/qwen3.5-122b-a10b" as const }) };
  const result = await run("diag", 1, "// some code", deps);
  expect(result.passed).toBe(false);
  expect(result.findings[0]!.severity).toBe("CRITICAL");
});
