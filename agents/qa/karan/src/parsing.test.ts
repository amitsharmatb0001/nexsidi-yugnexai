import { test, expect } from "bun:test";
import { parseSecurityFindings, scoreSecurityFindings, run, QA_SYSTEM_PROMPT } from "./index.ts";

// parseSecurityFindings is the deterministic parsing logic behind run() —
// run() itself calls agentChat (a live LLM call) and isn't unit-testable.
// Same pattern as Navya/Deepika's index.test.ts.

test("zero findings parses to an empty array", () => {
  expect(parseSecurityFindings(JSON.stringify({ findings: [] }))).toEqual([]);
});

test("bare array shape (no findings wrapper) is also accepted", () => {
  const result = parseSecurityFindings(
    JSON.stringify([{ severity: "CRITICAL", description: "SQL injection in tasks.routes.ts" }]),
  );
  expect(result).toHaveLength(1);
});

test("unparseable JSON content -> default-FAIL synthetic CRITICAL finding, not a silent pass", () => {
  const result = parseSecurityFindings("this is not JSON at all {{{");
  expect(result).toHaveLength(1);
  expect(result[0]!.severity).toBe("CRITICAL");
});

// Found in stress-test 1 (F7): the model's real output was wrapped in
// markdown code fences despite the prompt saying "Output ONLY JSON",
// tripping the D25 default-FAIL path even though the underlying findings
// were well-formed JSON.
test("JSON wrapped in ```json fences is still parsed correctly, not treated as a parse failure", () => {
  const fenced = "```json\n" + JSON.stringify({ findings: [{ severity: "HIGH", description: "XSS via innerHTML" }] }) + "\n```";
  const result = parseSecurityFindings(fenced);
  expect(result).toHaveLength(1);
  expect(result[0]!.severity).toBe("HIGH");
});

test("JSON wrapped in bare ``` fences (no json tag) is still parsed correctly", () => {
  const fenced = "```\n" + JSON.stringify({ findings: [] }) + "\n```";
  const result = parseSecurityFindings(fenced);
  expect(result).toEqual([]);
});

test("fenced JSON with leading/trailing whitespace around the fences is still parsed correctly", () => {
  const fenced = "  \n```json\n" + JSON.stringify({ findings: [] }) + "\n```\n  ";
  const result = parseSecurityFindings(fenced);
  expect(result).toEqual([]);
});

// Found live in stress5timeout (2026-07-04): Karan's raw output was the
// literal string "{ findings: [] }" — valid JS object-literal syntax
// (unquoted key), invalid JSON. Root cause: the prompt's own "Output ONLY
// JSON" example used unquoted keys. Same bug, same fix, in all 3 QA agents.
test("QA_SYSTEM_PROMPT's JSON schema example uses quoted keys, not JS object-literal syntax", () => {
  expect(QA_SYSTEM_PROMPT).toContain('"findings"');
  expect(QA_SYSTEM_PROMPT).not.toMatch(/\{\s*findings:/);
});

// 2026-07-09: Karan's zero-tolerance ("ANY finding blocks") was an
// IMPLEMENTATION DEVIATION from CLAUDE.md's own System A spec (lines
// 370-373), which explicitly includes Karan in the severity-weighted
// formula: Score = 100 − CRITICAL×20 − HIGH×10 − MEDIUM×5 − LOW×1,
// pass ≥ 85. CLAUDE.md is declared authoritative. The deviation was also
// empirically non-convergent: 8 consecutive live runs never produced a
// zero-findings review — an adversarial LLM reviewer always finds
// SOMETHING to say on ~2000 lines (runs 7-8 flagged correctly-
// parameterized queries as "risky" with no exploit, and flagged BOTH
// cache-present AND cache-absent designs — no implementation can satisfy
// contradictory critiques under a zero threshold).
test("scoreSecurityFindings: zero findings scores 100 and passes", () => {
  expect(scoreSecurityFindings([])).toEqual({ pass: true, score: 100, reason: "No vulnerabilities found" });
});

test("scoreSecurityFindings: one HIGH scores 90 and passes (CLAUDE.md System A: ≥85)", () => {
  const { pass, score } = scoreSecurityFindings([{ severity: "HIGH", description: "x" }]);
  expect(score).toBe(90);
  expect(pass).toBe(true);
});

test("scoreSecurityFindings: one CRITICAL scores 80 and fails", () => {
  const { pass, score } = scoreSecurityFindings([{ severity: "CRITICAL", description: "x" }]);
  expect(score).toBe(80);
  expect(pass).toBe(false);
});

test("scoreSecurityFindings: HIGH+MEDIUM scores exactly 85 and passes (boundary is inclusive)", () => {
  const { pass, score } = scoreSecurityFindings([
    { severity: "HIGH", description: "x" },
    { severity: "MEDIUM", description: "y" },
  ]);
  expect(score).toBe(85);
  expect(pass).toBe(true);
});

test("scoreSecurityFindings: two HIGH scores 80 and fails", () => {
  const { pass, score } = scoreSecurityFindings([
    { severity: "HIGH", description: "x" },
    { severity: "HIGH", description: "y" },
  ]);
  expect(score).toBe(80);
  expect(pass).toBe(false);
});

test("scoreSecurityFindings: score is floored at 0, never negative", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ severity: "CRITICAL" as const, description: `f${i}` }));
  const { score } = scoreSecurityFindings(many);
  expect(score).toBe(0);
});

test("run() carries the weighted score through, not a binary 100/0", async () => {
  const deps = {
    chat: async () => ({
      content: JSON.stringify({ findings: [{ severity: "HIGH", description: "x", file: "a.ts" }] }),
      modelUsed: "mistralai/mistral-medium-3.5-128b" as const,
    }),
  };
  const result = await run("diag", 1, "// some code", deps);
  expect(result.score).toBe(90);
  expect(result.passed).toBe(true);
});

// The evidence rule: a blocking finding must describe a concrete failing
// scenario, not a hypothetical "could be risky if" — the observed failure
// mode in runs 7-8 was structurally-suspicious-but-correct code flagged
// with no demonstrated attack.
test("QA_SYSTEM_PROMPT requires concrete evidence and forbids hypothetical findings", () => {
  expect(QA_SYSTEM_PROMPT).toMatch(/concrete|demonstrat|specific input|exact/i);
  expect(QA_SYSTEM_PROMPT).not.toContain("ANY finding blocks");
});

// A7-pattern retry (same precedent as Saanvi/Arjun and Navya above) —
// mitigates the sporadic empty-response infra flake also observed this run.
test("run() retries once on an empty/unparseable first response before giving up", async () => {
  let callCount = 0;
  const deps = {
    chat: async () => {
      callCount++;
      return callCount === 1
        ? { content: "", modelUsed: "mistralai/mistral-medium-3.5-128b" as const }
        : { content: JSON.stringify({ findings: [] }), modelUsed: "mistralai/mistral-medium-3.5-128b" as const };
    },
  };
  const result = await run("diag", 1, "// some code", deps);
  expect(callCount).toBe(2);
  expect(result.passed).toBe(true);
});

test("run() returns the default-FAIL result (not a thrown error) when BOTH attempts are empty/unparseable", async () => {
  const deps = { chat: async () => ({ content: "", modelUsed: "mistralai/mistral-medium-3.5-128b" as const }) };
  const result = await run("diag", 1, "// some code", deps);
  expect(result.passed).toBe(false);
});

// 2026-07-24 (P2, full agentic upgrade): a finding with `file` but no
// `line` still forces the generator to re-scan the whole file to locate
// the issue — traced live this session as the root cause of QA-fix
// oscillation (a score that improved then regressed across iterations
// because the fix targeted the wrong part of the file). `line` must
// survive parseSecurityFindings the same way `file` already does.
test("parseSecurityFindings carries a numeric line through when present", () => {
  const result = parseSecurityFindings(
    JSON.stringify({ findings: [{ severity: "CRITICAL", description: "SQL injection", file: "backend/src/db.ts", line: 47 }] }),
  );
  expect(result[0]!.line).toBe(47);
  expect(result[0]!.file).toBe("backend/src/db.ts");
});

test("parseSecurityFindings leaves line undefined when the model omits it (not attributable to one line)", () => {
  const result = parseSecurityFindings(
    JSON.stringify({ findings: [{ severity: "MEDIUM", description: "missing CORS config", file: "backend/src/app.ts" }] }),
  );
  expect(result[0]!.line).toBeUndefined();
});

test("QA_SYSTEM_PROMPT's JSON schema example includes line", () => {
  expect(QA_SYSTEM_PROMPT).toContain('"line"');
});
