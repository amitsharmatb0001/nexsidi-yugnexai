import { test, expect } from "bun:test";
import { scoreSecurityFindings } from "./index.ts";

test("zero findings passes", () => {
  expect(scoreSecurityFindings([])).toEqual({ pass: true, reason: "No vulnerabilities found" });
});

test("a single LOW-severity finding still fails — zero tolerance", () => {
  const result = scoreSecurityFindings([{ severity: "LOW", description: "verbose error message leaks stack trace" }]);
  expect(result.pass).toBe(false);
});

test("multiple findings of any severity all fail the same way", () => {
  const result = scoreSecurityFindings([
    { severity: "CRITICAL", description: "SQL injection in tasks.routes.ts" },
    { severity: "LOW", description: "missing rate limit header" },
  ]);
  expect(result.pass).toBe(false);
  expect(result.reason).toContain("2");
});
