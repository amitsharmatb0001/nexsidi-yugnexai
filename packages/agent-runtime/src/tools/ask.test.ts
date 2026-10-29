import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execAskQuestion, openCustomerQuestions, recordCustomerAnswer, readAnswers, answersSection, ASK_QUESTION_TOOL_DEF } from "./ask.ts";
import { internalTermsIn } from "../customer-text.ts";

// 2026-10-29 (team plan, stage 2): a builder that needs a value asks instead of guessing. The Chief AI answers from the
// approved request and spec with a quote; when they do not answer it, the question goes to the customer as a plain chat
// message (no agent names) and the build waits for the answer, which every agent then reads.
const prev = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});
function setup(): void {
  dir = mkdtempSync(join(tmpdir(), "ask-"));
  process.env.BUILD_DIR = dir;
  mkdirSync(join(dir, "p1"), { recursive: true });
  writeFileSync(join(dir, "p1", "user-request.txt"), "Build Brewline. One physical store location. No limit on orders per pickup time.");
}

test("an answer the documents give, with a quote that is really there, goes back to the builder and is kept", async () => {
  setup();
  const r = await execAskQuestion("p1", "shubham", { question: "Is there a limit on orders per pickup slot?", why: "slot validation" }, async () => ({
    answer: "No limit.",
    quote: "No limit on orders per pickup time.",
  }));
  expect(r.status).toBe("success");
  expect(r.summary).toContain("No limit.");
  expect(readAnswers("p1")[0]).toMatchObject({ source: "spec", answer: "No limit." });
  expect(openCustomerQuestions("p1")).toEqual([]);
});

test("an answer whose quote is not in the documents is not accepted: the question goes to the customer", async () => {
  setup();
  await execAskQuestion("p1", "aanya", { question: "What are the store hours?", why: "pickup slots" }, async () => ({
    answer: "7am to 7pm",
    quote: "The store is open 7am to 7pm.",
  }));
  expect(readAnswers("p1")).toEqual([]);
  expect(openCustomerQuestions("p1").length).toBe(1);
});

test("a question the documents do not answer goes to the customer in plain words, and the builder is told not to guess", async () => {
  setup();
  const r = await execAskQuestion("p1", "shubham", { question: "What are the store hours? Shubham needs them for slot validation.", why: "slots" }, async () => ({
    forCustomer: "The backend builder needs your store hours: what time do you open and close each day?",
  }));
  expect(r.summary).toContain("Do not guess");
  const [q] = openCustomerQuestions("p1");
  expect(q!.askedBy).toBe("shubham");
  expect(internalTermsIn(q!.forCustomer)).toEqual([]);
  expect(q!.forCustomer).toContain("store hours");
});

test("the same question is not asked twice", async () => {
  setup();
  const answerer = async () => ({ forCustomer: "What are your store hours?" });
  await execAskQuestion("p1", "shubham", { question: "What are the store hours?", why: "x" }, answerer);
  const again = await execAskQuestion("p1", "aanya", { question: "what are the store hours", why: "y" }, answerer);
  expect(openCustomerQuestions("p1").length).toBe(1);
  expect(again.summary).toContain("already");
});

test("the customer's answer closes the question and every agent can read it", async () => {
  setup();
  await execAskQuestion("p1", "shubham", { question: "What are the store hours?", why: "x" }, async () => ({ forCustomer: "What are your store hours?" }));
  const [q] = openCustomerQuestions("p1");
  recordCustomerAnswer("p1", q!.id, "Mon–Sat 7:00–18:00, closed Sunday");
  expect(openCustomerQuestions("p1")).toEqual([]);
  expect(readAnswers("p1")[0]).toMatchObject({ source: "customer", answer: "Mon–Sat 7:00–18:00, closed Sunday" });
  expect(answersSection("p1")).toContain("Mon–Sat 7:00–18:00, closed Sunday");
});

test("an answered question is answered from the record, without asking again", async () => {
  setup();
  await execAskQuestion("p1", "shubham", { question: "What are the store hours?", why: "x" }, async () => ({ forCustomer: "What are your store hours?" }));
  recordCustomerAnswer("p1", openCustomerQuestions("p1")[0]!.id, "7:00–18:00 daily");
  let asked = 0;
  const r = await execAskQuestion("p1", "aanya", { question: "What are the store hours?", why: "y" }, async () => {
    asked++;
    return {};
  });
  expect(asked).toBe(0);
  expect(r.summary).toContain("7:00–18:00 daily");
});

test("no answers yet: the section is empty", () => {
  setup();
  expect(answersSection("p1")).toBe("");
});

test("the tool asks for the question and why it matters", () => {
  expect(ASK_QUESTION_TOOL_DEF.function.name).toBe("ask_question");
  expect(ASK_QUESTION_TOOL_DEF.function.parameters.required).toEqual(["question", "why"]);
});

test("the answers block is empty without answers and starts on its own paragraph with them", async () => {
  setup();
  const { answersBlock } = await import("./ask.ts");
  expect(answersBlock("p1")).toBe("");
  await execAskQuestion("p1", "shubham", { question: "Store hours?", why: "x" }, async () => ({ forCustomer: "What are your store hours?" }));
  recordCustomerAnswer("p1", openCustomerQuestions("p1")[0]!.id, "7–18 daily");
  expect(answersBlock("p1").startsWith("\n\nANSWERS GIVEN DURING THE BUILD")).toBe(true);
});

// 2026-10-29 (stage 2 proof on Brewline 3): "What are the store's opening hours for each day?" and "Store opening hours?"
// were two questions, so the customer would have been asked twice.
test("the same question in other words is not asked twice", async () => {
  setup();
  const answerer = async () => ({ forCustomer: "What are your store's opening hours?" });
  await execAskQuestion("p1", "aanya", { question: "What are the store's opening hours for each day?", why: "x" }, answerer);
  const again = await execAskQuestion("p1", "shubham", { question: "Store opening hours?", why: "y" }, answerer);
  expect(openCustomerQuestions("p1").length).toBe(1);
  expect(again.summary).toContain("already");
});

test("different questions are both asked", async () => {
  setup();
  const answerer = async () => ({ forCustomer: "q" });
  await execAskQuestion("p1", "aanya", { question: "What are the store's opening hours?", why: "x" }, answerer);
  await execAskQuestion("p1", "shubham", { question: "Is there a delivery fee?", why: "y" }, answerer);
  expect(openCustomerQuestions("p1").length).toBe(2);
});

test("questions that differ in a key word stay different", async () => {
  const { sameQuestion } = await import("./ask.ts");
  expect(sameQuestion("Is there a minimum order?", "Is there a maximum order?")).toBe(false);
  expect(sameQuestion("What are the store hours?", "What are the store's opening hours?")).toBe(true);
});
