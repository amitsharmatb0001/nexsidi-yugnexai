import { test, expect } from "bun:test";
import { run, SAANVI_SYSTEM_PROMPT } from "./index.ts";

// Full-system audit A7: one empty/unparseable NIM response used to crash
// the ENTIRE pipeline outright — stress-test run 9 died 12 seconds in when
// Saanvi's very first call returned empty content, before any of this
// session's other fixes were even relevant. run() takes an injectable
// `chat` dependency (matching this codebase's established DI pattern —
// e.g. runAgentEscalated's `deps` param) specifically so this retry
// behavior is unit-testable without a live LLM call.

const VALID_SPEC_JSON = JSON.stringify({
  name: "Test App",
  description: "A test app",
  features: [],
  apiEndpoints: [],
  dbTables: [],
  successCriteria: [],
});

test("a single empty response is retried once and succeeds on the second attempt", async () => {
  let callCount = 0;
  const stubChat = async () => {
    callCount++;
    return { content: callCount === 1 ? "" : VALID_SPEC_JSON, modelUsed: "mistralai/mistral-nemotron" as const };
  };

  const result = await run("proj123", "build me a task app", { chat: stubChat });

  expect(callCount).toBe(2);
  expect(result.status).toBe("locked");
  if (result.status === "locked") expect(result.spec.name).toBe("Test App");
});

test("two consecutive empty responses still throw — retry is not infinite masking of a real outage", async () => {
  const stubChat = async () => ({ content: "", modelUsed: "mistralai/mistral-nemotron" as const });

  await expect(run("proj123", "build me a task app", { chat: stubChat })).rejects.toThrow();
});

test("a well-formed first response does not trigger a second call at all", async () => {
  let callCount = 0;
  const stubChat = async () => {
    callCount++;
    return { content: VALID_SPEC_JSON, modelUsed: "mistralai/mistral-nemotron" as const };
  };

  await run("proj123", "build me a task app", { chat: stubChat });

  expect(callCount).toBe(1);
});

// ── Clarification path (2026-08-05) ─────────────────────────────────────────
const CLARIFICATION_JSON = JSON.stringify({
  needsClarification: true,
  questions: ["What kind of app is this — a tool, a marketplace, or a content site?"],
});

test("run() returns needs_clarification with the model's questions instead of guessing a spec", async () => {
  const stubChat = async () => ({ content: CLARIFICATION_JSON, modelUsed: "mistralai/mistral-nemotron" as const });

  const result = await run("proj123", "app for my thing", { chat: stubChat });

  expect(result.status).toBe("needs_clarification");
  if (result.status === "needs_clarification") {
    expect(result.questions).toEqual(["What kind of app is this — a tool, a marketplace, or a content site?"]);
  }
});

test("run() falls through to a normal spec when needsClarification is true but questions is empty", async () => {
  const emptyQuestionsJson = JSON.stringify({ needsClarification: true, questions: [], ...JSON.parse(VALID_SPEC_JSON) });
  const stubChat = async () => ({ content: emptyQuestionsJson, modelUsed: "mistralai/mistral-nemotron" as const });

  const result = await run("proj123", "build me a task app", { chat: stubChat });

  expect(result.status).toBe("locked");
});

test("run() ignores needsClarification when it's not the literal boolean true", async () => {
  const weirdJson = JSON.stringify({ needsClarification: "yes", ...JSON.parse(VALID_SPEC_JSON) });
  const stubChat = async () => ({ content: weirdJson, modelUsed: "mistralai/mistral-nemotron" as const });

  const result = await run("proj123", "build me a task app", { chat: stubChat });

  expect(result.status).toBe("locked");
});

// 2026-08-08: real gap found live, explicit user request (project
// bae438767bed) — "build a client portal for Northgate Consulting" was
// clear enough to spec confidently (portal type, pages, auth all
// inferable), so the OLD vagueness-only clarification rule never fired.
// Saanvi invented three generic, interchangeable service names instead of
// asking what Northgate actually offers — the direct root cause of the
// delivered app reading as generic. This asserts the SEPARATE
// business-specifics trigger is actually present in the prompt, not just
// described in a commit — the real behavior (does the model actually ask)
// isn't unit-testable without a live LLM call, same limitation as every
// other prompt-content assertion in this codebase (see vanya/index.test.ts's
// equivalent tests for VANYA_SYSTEM_PROMPT).
test("SAANVI_SYSTEM_PROMPT instructs asking for real business specifics, separately from the vagueness-only trigger", () => {
  expect(SAANVI_SYSTEM_PROMPT).toContain("WHEN TO ASK FOR REAL BUSINESS SPECIFICS");
  expect(SAANVI_SYSTEM_PROMPT).toContain("SEPARATE trigger from vagueness");
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/fabricated business identity/i);
});

test("SAANVI_SYSTEM_PROMPT explicitly names the Northgate-style failure mode: structural clarity is not real content", () => {
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/NOT the same as having REAL\s*\n?\s*CONTENT/i);
  expect(SAANVI_SYSTEM_PROMPT).toContain("do NOT invent plausible-sounding generic service names");
});

test("SAANVI_SYSTEM_PROMPT still allows skipping the business-specifics question when there is no real company behind the app", () => {
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/no real\s*\n?\s*external business behind the app/i);
});

// 2026-08-09: real gap found live (project meridianbk4) — a product-based
// business (sells helmets/lights/tubes) and a service-based business (books
// repair appointments) were never asked whether THEY want to manage their
// own data after launch, or how they want pricing displayed. The existing
// SCOPE CONTROL rule correctly forbids INVENTING an admin/management area
// nobody asked for — but a normal user doesn't know to request "an admin
// dashboard" by that name; they only know their own business. This is a
// THIRD, separate ask-don't-guess trigger (parallel to the two above),
// with an explicit carve-out in SCOPE CONTROL so the two rules don't
// contradict each other: a "yes" answer to this question counts as the
// user's own explicit request, exactly like naming it in the original
// prompt would.
test("SAANVI_SYSTEM_PROMPT asks whether the business wants to self-manage its own data, as a third separate trigger", () => {
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/WHEN TO ASK ABOUT SELF-MANAGEMENT/i);
  expect(SAANVI_SYSTEM_PROMPT).toContain("THIRD trigger");
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/add\/edit\/remove your own/i);
});

test("SAANVI_SYSTEM_PROMPT asks a service business how they want pricing displayed, not just data-management", () => {
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/prices be shown publicly[\s\S]*?contact you[\s\S]*?for a quote/i);
});

test("SAANVI_SYSTEM_PROMPT's self-management trigger explicitly allows a 'no' answer — not a hardcoded default to always building it", () => {
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/is a\s*\n?\s*completely valid answer/i);
});

test("SCOPE CONTROL's admin-dashboard ban has an explicit carve-out for an explicit yes to the self-management question", () => {
  const scopeControlIdx = SAANVI_SYSTEM_PROMPT.indexOf("SCOPE CONTROL — highest priority rule");
  expect(scopeControlIdx).toBeGreaterThan(-1);
  const scopeControlSection = SAANVI_SYSTEM_PROMPT.slice(scopeControlIdx, scopeControlIdx + 400);
  expect(scopeControlSection).toMatch(/explicit mention in the request, or an explicit\s*\n?\s*"yes" answer to the self-management/i);
});

test("SAANVI_SYSTEM_PROMPT instructs treating uploaded attachment content as real grounding, same as build-plan content", () => {
  expect(SAANVI_SYSTEM_PROMPT).toMatch(/USER UPLOADED ATTACHMENTS/);
});
