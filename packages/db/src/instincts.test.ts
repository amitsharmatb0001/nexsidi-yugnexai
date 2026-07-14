import { test, expect } from "bun:test";
import { buildInstinctRecord, formatInstinctsForPrompt } from "./instincts.ts";

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
