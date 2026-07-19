import { test, expect } from "bun:test";
import { validateHandoff } from "./contracts.ts";

// Phase 5 Task 5 (final-bundle/phase5-harness-enforcement-plan.md): output
// contract validator (Rule 9). Called at EVERY agent boundary BEFORE the
// context-chain hash is computed — a malformed handoff is rejected back to
// the producing agent with the exact zod errors, never hashed and forwarded
// as if it were valid. Schemas mirror the real existing types (see
// contracts/schemas.ts's header comment) — semantics unchanged, just made
// runtime-checkable.

const VALID_SPEC = {
  projectId: "abc123",
  name: "TaskFlow",
  description: "A task manager",
  appType: "web",
  features: [{ name: "tasks", description: "manage tasks", userStories: ["as a user I can add a task"] }],
  auth: { provider: "custom", features: ["sign-in", "sign-up"] },
  apiEndpoints: [],
  dbTables: [],
  successCriteria: ["user can sign up"],
  lockedAt: "2026-07-07T00:00:00Z",
  specHash: "deadbeef",
};

test("a valid ProjectSpec passes validation", () => {
  const result = validateHandoff("project_spec", JSON.stringify(VALID_SPEC));
  expect(result.ok).toBe(true);
});

test("a ProjectSpec missing a required field is rejected with the exact error path", () => {
  const { specHash, ...missingHash } = VALID_SPEC;
  const result = validateHandoff("project_spec", JSON.stringify(missingHash));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.includes("specHash"))).toBe(true);
  }
});

test("malformed JSON is rejected, not thrown as an unhandled exception", () => {
  const result = validateHandoff("project_spec", "{not valid json{{{");
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.length).toBeGreaterThan(0);
  }
});

// ── ready_to_build (Maya's __READY_TO_BUILD__ marker) ───────────────────────

test("a valid __READY_TO_BUILD__ marker passes, even with conversational text before it", () => {
  const raw = 'Great, I have everything I need!\n__READY_TO_BUILD__{"name":"TaskFlow","description":"A task manager","features":["add tasks","mark complete"]}';
  const result = validateHandoff("ready_to_build", raw);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ name: "TaskFlow", description: "A task manager", features: ["add tasks", "mark complete"] });
  }
});

test("__READY_TO_BUILD__ with trailing text after the JSON is rejected", () => {
  const raw = '__READY_TO_BUILD__{"name":"TaskFlow","description":"A task manager","features":[]} hope that helps!';
  const result = validateHandoff("ready_to_build", raw);
  expect(result.ok).toBe(false);
});

test("text with no __READY_TO_BUILD__ marker at all is rejected", () => {
  const result = validateHandoff("ready_to_build", "Sure, let me help you build that.");
  expect(result.ok).toBe(false);
});

test("__READY_TO_BUILD__ with a missing required field is rejected", () => {
  const raw = '__READY_TO_BUILD__{"name":"TaskFlow","features":[]}';
  const result = validateHandoff("ready_to_build", raw);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.includes("description"))).toBe(true);
  }
});

// ── verdict (normalized PASS | NEEDS_WORK first-line contract) ─────────────

test("a first-line PASS verdict is accepted", () => {
  const result = validateHandoff("verdict", "PASS\n\nEverything looks good.");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual({ verdict: "PASS" });
});

test("a first-line NEEDS_WORK verdict with a reason is accepted", () => {
  const result = validateHandoff("verdict", "NEEDS_WORK: missing input validation on the task form\n\nDetails...");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual({ verdict: "NEEDS_WORK", reason: "missing input validation on the task form" });
});

test("a verdict that doesn't start with PASS or NEEDS_WORK on the first line is rejected", () => {
  const result = validateHandoff("verdict", "Looks mostly fine, PASS I guess?");
  expect(result.ok).toBe(false);
});

test("the verdict contract enforces the FIRST line specifically — PASS buried later in the text does not count", () => {
  const result = validateHandoff("verdict", "Let me review this.\nPASS");
  expect(result.ok).toBe(false);
});

// ── deploy_result / build_plan smoke tests (schema wiring, not exhaustive) ──

test("a valid DeployResult passes validation", () => {
  const result = validateHandoff("deploy_result", JSON.stringify({ success: true, appUrl: "http://localhost:3000", githubRepo: null, errors: [] }));
  expect(result.ok).toBe(true);
});

test("an invalid DeployResult (wrong type) is rejected", () => {
  const result = validateHandoff("deploy_result", JSON.stringify({ success: "yes", appUrl: "http://localhost:3000", githubRepo: null, errors: [] }));
  expect(result.ok).toBe(false);
});
