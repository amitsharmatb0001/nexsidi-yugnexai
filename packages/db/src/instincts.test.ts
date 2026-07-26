import { test, expect } from "bun:test";
import { buildInstinctRecord, formatInstinctsForPrompt, escalateConfidence } from "./instincts.ts";

test("buildInstinctRecord formats correct Drizzle insert shape", () => {
  const record = buildInstinctRecord({
    agentName: "shubham",
    domain: "security",
    trigger: "database query",
    finding: "do not use string interpolation",
  });

  expect(record).toEqual({
    trigger: "database query",
    action: "do not use string interpolation",
    confidence: "0.5",
    domain: "security",
    scope: "project",
    projectId: null,
    outcome: "mistake",
  });
});

test("formatInstinctsForPrompt formats prompt text correctly", () => {
  const instincts = [
    { trigger: "dynamic sql", action: "use dynamic query params", confidence: "0.5" },
    { trigger: "jwt validation", action: "verify tokens", confidence: "0.7" },
  ];

  const formatted = formatInstinctsForPrompt(instincts);
  expect(formatted).toContain("KNOWN PAST MISTAKES");
  expect(formatted).toContain("- dynamic sql: use dynamic query params (confidence: 0.5)");
  expect(formatted).toContain("- jwt validation: verify tokens (confidence: 0.7)");
});

test("formatInstinctsForPrompt returns empty string when list is empty", () => {
  const formatted = formatInstinctsForPrompt([]);
  expect(formatted).toBe("");
});

// 2026-07-24 (P3.W3.3, full agentic upgrade): before this, EVERY instinct
// was inserted at a flat "0.5" confidence forever — a mistake QA catches
// for the 5th time in a row got logged with the exact same weight as the
// first time. D31 ("confidence tiers change enforcement") only means
// anything if confidence actually climbs when a pattern repeats.
test("escalateConfidence climbs one tier at a time: 0.3 -> 0.5 -> 0.7 -> 0.9", () => {
  expect(escalateConfidence("0.3")).toBe("0.5");
  expect(escalateConfidence("0.5")).toBe("0.7");
  expect(escalateConfidence("0.7")).toBe("0.9");
});

test("escalateConfidence caps at 0.9 — never invents a tier above the highest defined", () => {
  expect(escalateConfidence("0.9")).toBe("0.9");
});
