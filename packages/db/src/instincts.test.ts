import { test, expect } from "bun:test";
import { formatInstinctsForPrompt, buildInstinctRecord } from "./instincts.ts";

// 2026-07-08: Patent Claim 2 (confidence-scored mistake memory) had a real
// DB table (`instincts` in schema.ts) but ZERO code anywhere read or wrote
// to it — confirmed via a repo-wide grep. Every pipeline run started with
// total amnesia, so the same bug classes (e.g. SQL injection in dynamic
// UPDATE queries) could resurface run after run with nothing actually
// learning. This file is the real read/write path. DB access itself
// (recordInstinct/queryRecentInstincts) needs a live Postgres connection —
// not unit-tested here (matches this repo's convention: DB-touching code is
// exercised by live runs, not unit tests). The PURE formatting/building
// logic below has zero DB dependency and is fully unit-testable.

test("buildInstinctRecord shapes a QA finding into an instinct record with mistake outcome", () => {
  const record = buildInstinctRecord({
    agentName: "shubham",
    domain: "security",
    trigger: "dynamic UPDATE query with variable SET clause",
    finding: "[security/CRITICAL] SQL Injection vulnerability in updateTask — paramIndex interpolated directly into the query string",
  });
  expect(record.outcome).toBe("mistake");
  expect(record.domain).toBe("security");
  expect(record.scope).toBe("project"); // default per D29 — project-scoped unless promoted
  expect(record.confidence).toBe("0.5"); // moderate — single observation, not yet repeated
  expect(record.trigger).toBe("dynamic UPDATE query with variable SET clause");
  expect(record.action).toContain("SQL Injection");
});

test("formatInstinctsForPrompt returns an empty string for no instincts — no throw, no empty section header", () => {
  expect(formatInstinctsForPrompt([])).toBe("");
});

test("formatInstinctsForPrompt renders past mistakes as a readable prompt section", () => {
  const text = formatInstinctsForPrompt([
    { trigger: "dynamic UPDATE query with variable SET clause", action: "SQL Injection: paramIndex interpolated directly into the query string", confidence: "0.5" },
  ]);
  expect(text).toContain("KNOWN PAST MISTAKES");
  expect(text).toContain("dynamic UPDATE query with variable SET clause");
  expect(text).toContain("SQL Injection");
});

test("formatInstinctsForPrompt renders multiple instincts as a list, most-confident-relevant first order preserved from input", () => {
  const text = formatInstinctsForPrompt([
    { trigger: "trigger A", action: "action A", confidence: "0.7" },
    { trigger: "trigger B", action: "action B", confidence: "0.5" },
  ]);
  const idxA = text.indexOf("trigger A");
  const idxB = text.indexOf("trigger B");
  expect(idxA).toBeGreaterThanOrEqual(0);
  expect(idxB).toBeGreaterThan(idxA);
});
