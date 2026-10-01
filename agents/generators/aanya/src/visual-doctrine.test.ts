import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-01: Plantly's (a034f90ba50e) first draft scored 5.95 on the live
// design review — a hero and three identical text cards, no imagery — and the
// review rounds kept flagging the same things: a header that showed Sign In
// while signed in, no Sign Out, and a bare-sentence empty dashboard. These
// rules give the first draft that structure. Rules, not drop-in templates: the
// design review's originality criterion penalises template layouts.
const doctrine = readFileSync(new URL("../../../../packages/agent-runtime/skills/aanya/00-identity-and-visual-doctrine.md", import.meta.url), "utf-8");

test("Aanya's visual doctrine requires a composed landing page", () => {
  expect(doctrine).toContain("Landing page composition");
  expect(doctrine).toMatch(/at least three content sections/i);
});

test("Aanya's visual doctrine requires a session-aware header with Sign Out", () => {
  expect(doctrine).toContain("Sign Out");
  expect(doctrine).toMatch(/Never both/);
});

test("Aanya's visual doctrine requires real empty states", () => {
  expect(doctrine).toContain("Empty states");
});
