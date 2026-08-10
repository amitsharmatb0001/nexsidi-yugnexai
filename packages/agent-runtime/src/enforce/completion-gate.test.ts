import { test, expect } from "bun:test";
import { checkCompletion } from "./completion-gate.ts";
import { createEvidenceLedger } from "./evidence.ts";

// Phase 5 Task 3 (final-bundle/phase5-harness-enforcement-plan.md):
// task_complete is REJECTED (not discouraged) when the ledger has no fresh
// evidence — a model claiming "verification_passed: true" with zero
// successful tool calls this run is exactly the failure mode Rule 6 exists
// to prevent. The loop (not this module) is responsible for continuing
// on rejection and injecting the reason as the tool result.

const CLAIM = { summary: "Built the feature", filesWritten: ["a.ts"], verificationPassed: true };

test("rejects completion when the ledger has no evidence at all", () => {
  const ledger = createEvidenceLedger();
  const result = checkCompletion(ledger, CLAIM);
  expect(result.allowed).toBe(false);
  if (!result.allowed) {
    expect(result.reason).toBe("Completion rejected: no verification evidence this run. Run your check, read its output, then call task_complete.");
  }
});

test("allows completion when the ledger has fresh evidence", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit -> exited 0");
  const result = checkCompletion(ledger, CLAIM);
  expect(result).toEqual({ allowed: true });
});

test("checking completion does not itself consume the ledger — that's the caller's job", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npm test -> exited 0");
  checkCompletion(ledger, CLAIM);
  expect(ledger.hasFreshEvidence()).toBe(true);
});

test("any evidence kind satisfies the gate — file_read counts same as command_output", () => {
  const ledger = createEvidenceLedger();
  ledger.record("file_read", "src/index.ts");
  expect(checkCompletion(ledger, CLAIM)).toEqual({ allowed: true });
});

test("rejects completion when the model says verification did not pass", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit -> exited 0");

  const result = checkCompletion(ledger, { ...CLAIM, verificationPassed: false });
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("verification_passed must be true");
});

test("rejects unrelated successful commands when an exact verification command is required", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "node -v -> exited 0");

  const result = checkCompletion(ledger, CLAIM, ["npx tsc --noEmit"]);
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("npx tsc --noEmit");
});

test("allows a required verification command with additional safe arguments", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit --pretty false -> exited 0");

  expect(checkCompletion(ledger, CLAIM, ["npx tsc --noEmit"])).toEqual({ allowed: true });
});

// 2026-07-25 (P5.W5.4, full agentic upgrade): traced live — Riya (deploy
// agent) sets NO requiredVerificationCommands at all, so its completion gate
// was satisfied by "any evidence kind" (test above: file_read counts the
// same as a real health check) — exactly the gap that let the historical
// "Riya reports done, live round-trip fails" bug happen. Riya's real tools
// are docker_compose/http_request, not run_command, so
// requiredVerificationCommands (which matches exact shell command strings)
// can't express "you must have called http_request successfully" at all.
// requiredEvidenceKinds closes that: a kind-level requirement any tool's
// evidence-recording call can satisfy, not tied to a specific command string.
test("rejects completion when a required evidence kind was never recorded", () => {
  const ledger = createEvidenceLedger();
  ledger.record("file_read", "docker-compose.yml"); // some evidence, but not the required kind
  const result = checkCompletion(ledger, CLAIM, [], ["http_check"]);
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("http_check");
});

test("allows completion once the required evidence kind was recorded", () => {
  const ledger = createEvidenceLedger();
  ledger.record("http_check", "GET http://localhost:3300/health -> 200");
  expect(checkCompletion(ledger, CLAIM, [], ["http_check"])).toEqual({ allowed: true });
});

test("requiredEvidenceKinds and requiredVerificationCommands compose — both must be satisfied", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit -> exited 0");
  // command satisfied, but the required evidence kind (http_check) is still missing
  const result = checkCompletion(ledger, CLAIM, ["npx tsc --noEmit"], ["http_check"]);
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("http_check");
});

// 2026-08-06: real bug found live (project 88d7b375eaef) — Tilotma's Stage 2
// reality-checker (an EVALUATOR, not a generator) is explicitly prompted to
// "Set it false if [verdict is NEEDS_WORK]" when it confirms a real bug in
// the app under review — a legitimate, complete finding. The gate rejected
// that honest false unconditionally, forcing the agent to resubmit with the
// flag flipped to true and the identical finding text (no new evidence, no
// fix), coercing a false-positive pass that let a confirmed, documented bug
// deploy. allowFailedVerification opts an evaluator OUT of the "must be
// true" rule while still enforcing every other evidence requirement.
test("allowFailedVerification lets an honest verification_passed=false through when evidence exists", () => {
  const ledger = createEvidenceLedger();
  ledger.record("http_check", "GET http://localhost:3201 -> 200");
  const result = checkCompletion(ledger, { ...CLAIM, verificationPassed: false }, [], [], true);
  expect(result).toEqual({ allowed: true });
});

test("allowFailedVerification does not waive the OTHER evidence requirements — no evidence still rejects", () => {
  const ledger = createEvidenceLedger();
  const result = checkCompletion(ledger, { ...CLAIM, verificationPassed: false }, [], [], true);
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("no verification evidence");
});

test("allowFailedVerification defaults to false — existing generator callers are unaffected", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit -> exited 0");
  const result = checkCompletion(ledger, { ...CLAIM, verificationPassed: false });
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("verification_passed must be true");
});

test("allowFailedVerification=true still allows a genuine true completion", () => {
  const ledger = createEvidenceLedger();
  ledger.record("command_output", "npx tsc --noEmit -> exited 0");
  expect(checkCompletion(ledger, CLAIM, [], [], true)).toEqual({ allowed: true });
});

// 2026-08-10: real gap found live (user request) — requiredEvidenceKinds
// only checks PRESENCE ("was http_check ever recorded"), satisfied by ONE
// call. Shubham's self-check currently claims done after testing a single
// endpoint's auth boundary, leaving every other resource's CRUD chain
// unverified until QA or a live deploy round-trip catches it later — the
// exact "self-check the obvious stuff at the source" gap the user asked to
// close. requiredEvidenceCounts requires a MINIMUM count per kind, not just
// presence, so "at least one call per resource" is mechanically enforceable.
test("rejects completion when a required evidence kind's count is below the minimum", () => {
  const ledger = createEvidenceLedger();
  ledger.record("http_check", "GET /a -> 200"); // only 1, but 3 resources need testing
  const result = checkCompletion(ledger, CLAIM, [], [], false, { http_check: 3 });
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("http_check");
});

test("allows completion once the required evidence count is met", () => {
  const ledger = createEvidenceLedger();
  ledger.record("http_check", "POST /a -> 201");
  ledger.record("http_check", "POST /b -> 201");
  ledger.record("http_check", "POST /c -> 201");
  expect(checkCompletion(ledger, CLAIM, [], [], false, { http_check: 3 })).toEqual({ allowed: true });
});

test("requiredEvidenceCounts defaults to no minimum — existing callers unaffected", () => {
  const ledger = createEvidenceLedger();
  ledger.record("http_check", "GET /health -> 200");
  expect(checkCompletion(ledger, CLAIM, [], ["http_check"])).toEqual({ allowed: true });
});
