import { test, expect } from "bun:test";
import { scoreSecurityFindings } from "./index.ts";

// 2026-07-09: rewritten from the zero-tolerance behavior to CLAUDE.md
// System A (authoritative, lines 370-373): Score = 100 − CRITICAL×20 −
// HIGH×10 − MEDIUM×5 − LOW×1, pass ≥ 85 — the formula that explicitly
// includes Karan alongside Navya/Deepika. The zero-tolerance version these
// tests previously encoded was an implementation deviation from that spec
// (see scoreSecurityFindings' comment for the empirical convergence
// evidence from live runs 1-8). Fuller boundary coverage lives in
// parsing.test.ts — these are the original scoring cases, re-expressed.

test("zero findings scores 100 and passes", () => {
  expect(scoreSecurityFindings([])).toEqual({ pass: true, score: 100, reason: "No vulnerabilities found" });
});

test("a single LOW-severity finding scores 99 and passes — real CRITICALs block, hardening notes don't", () => {
  const result = scoreSecurityFindings([{ severity: "LOW", description: "verbose error message leaks stack trace" }]);
  expect(result.score).toBe(99);
  expect(result.pass).toBe(true);
});

test("a CRITICAL plus a LOW scores 79 and fails — a real critical still blocks on its own", () => {
  const result = scoreSecurityFindings([
    { severity: "CRITICAL", description: "SQL injection in tasks.routes.ts" },
    { severity: "LOW", description: "missing rate limit header" },
  ]);
  expect(result.score).toBe(79);
  expect(result.pass).toBe(false);
  expect(result.reason).toContain("2");
});
