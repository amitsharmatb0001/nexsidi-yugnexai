import { test, expect } from "bun:test";
import { parseSecurityFindings, run, QA_SYSTEM_PROMPT } from "./index.ts";

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
