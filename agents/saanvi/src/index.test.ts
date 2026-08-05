import { test, expect } from "bun:test";
import { run } from "./index.ts";

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
