import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { pendingCustomerQuestion, cleanAnswer } from "./customer-question.ts";
import { USER_STAGE_MESSAGES } from "./stage-labels.ts";
import { internalTermsIn } from "../../../../packages/agent-runtime/src/customer-text.ts";

// 2026-10-29 (Amit, team plan stage 2): a question for the customer during a build reads like a chat message: no agent
// names, no internal words. These are the API's last check before the browser.
test("the waiting question is shown in the customer's words", () => {
  expect(pendingCustomerQuestion({ stage: "awaiting_customer", pendingQuestions: ["What are your store hours?"] })).toBe("What are your store hours?");
  const q = pendingCustomerQuestion({ pendingQuestions: ["Shubham needs your store hours for the pickup slots."] })!;
  expect(internalTermsIn(q)).toEqual([]);
});

test("no question waiting: nothing is shown", () => {
  expect(pendingCustomerQuestion({ stage: "generate" })).toBeNull();
  expect(pendingCustomerQuestion(null)).toBeNull();
  expect(pendingCustomerQuestion({ pendingQuestions: [] })).toBeNull();
});

test("an answer is trimmed, kept to a sensible length, and an empty one is refused", () => {
  expect(cleanAnswer("  7am to 6pm  ")).toBe("7am to 6pm");
  expect(cleanAnswer("   ")).toBeNull();
  expect(cleanAnswer(42)).toBeNull();
  expect(cleanAnswer("x".repeat(5000))!.length).toBe(2000);
  expect(cleanAnswer("a\u0000b")).toBe("ab");
});

test("the waiting stage has a plain label", () => {
  expect(USER_STAGE_MESSAGES.awaiting_customer).toBeDefined();
  expect(internalTermsIn(USER_STAGE_MESSAGES.awaiting_customer!)).toEqual([]);
});

test("the build's status stream carries the question, and the customer can read and answer it", () => {
  const src = readFileSync(new URL("../routes/pipeline.ts", import.meta.url), "utf-8");
  expect(src).toContain('type: "question"');
  expect(src).toContain('pipelineRouter.get("/:projectId/question"');
  const answer = src.slice(src.indexOf('pipelineRouter.post("/:projectId/answer"'));
  expect(answer.indexOf("sendAnswerSignal(projectId,")).toBeGreaterThan(-1);
  expect(answer.indexOf("saveSession(")).toBeGreaterThan(-1);
  expect(answer.indexOf("saveSession(")).toBeLessThan(answer.indexOf("sendAnswerSignal(projectId,"));
});
