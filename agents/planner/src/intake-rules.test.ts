import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-02 (Part B.2 of the agentic planner plan, approved by Amit): the
// intake rules were written for the Nextech company website — a fixed
// question list, a typo dictionary for that one brief, and limits ("one
// round of questions maximum", "under 350 words") — so every product got the
// same generic questions. Questions now come from the research.

const rules = readFileSync(new URL("../INTAKE_RULES.md", import.meta.url), "utf-8");

test("no fixed question list, no one-brief leftovers, no limits on questions", () => {
  for (const gone of [
    "Who is sign-in for?",
    "Do you have brand assets?",
    "One round of questions maximum",
    "350 words",
    "Do NOT add questions purely out of thoroughness",
    "protil",
    "NexTech",
    "Do not invent: admin dashboard",
  ]) {
    expect({ gone, present: rules.includes(gone) }).toEqual({ gone, present: false });
  }
});

test("questions come from the research, each says why it matters, as many as the product needs", () => {
  expect(rules).toContain("What you found");
  expect(rules.toLowerCase()).toContain("why it matters");
  expect(rules.toLowerCase()).toContain("as many as");
  expect(rules.toLowerCase()).toContain("senior product team");
});

test("the user's own words win: research that conflicts with the brief becomes a question, never a silent change", () => {
  expect(rules.toLowerCase()).toContain("conflicts with the brief");
});

test("extras are offered as suggested features for the user to tick, never added to the build on their own", () => {
  expect(rules).toContain("suggestedFeatures");
});
