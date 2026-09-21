import { test, expect } from "bun:test";
import type { AgentName, ChatMessage } from "@nexsidi/llm-client";
import {
  buildPickSourcePrompt,
  parsePickSourceResult,
  pickCloneSource,
  type CloneSourceCandidate,
} from "./clone-source-picker.ts";

const CANDIDATES: CloneSourceCandidate[] = [
  { id: "ac85eb0fa344", name: "Gatherly", description: "A marketplace for creators to sell limited-quantity product drops." },
  { id: "bae438767bed", name: "Northgate Consulting Portal", description: "A consulting firm portal with services, case studies, and a client dashboard." },
  { id: "88d7b375eaef", name: "NexTech", description: "A company website with services, products, and a contact form." },
];

// ── buildPickSourcePrompt (pure) ──────────────────────────────────────────
test("buildPickSourcePrompt includes the requested description and every real candidate", () => {
  const prompt = buildPickSourcePrompt("A law firm site with attorney bios and a contact form", CANDIDATES);
  expect(prompt).toContain("A law firm site with attorney bios and a contact form");
  expect(prompt).toContain("ac85eb0fa344");
  expect(prompt).toContain("Northgate Consulting Portal");
  expect(prompt).toContain("NexTech");
});

// ── parsePickSourceResult (pure) ──────────────────────────────────────────
test("parsePickSourceResult accepts a valid pick", () => {
  const raw = JSON.stringify({ sourceId: "bae438767bed", reasoning: "Both are professional services portals with similar page structure." });
  const result = parsePickSourceResult(raw, CANDIDATES.map((c) => c.id));
  expect(result.sourceId).toBe("bae438767bed");
});

test("parsePickSourceResult rejects a sourceId that isn't one of the real candidates — never fabricate a project id", () => {
  const raw = JSON.stringify({ sourceId: "not-a-real-id", reasoning: "x" });
  expect(() => parsePickSourceResult(raw, CANDIDATES.map((c) => c.id))).toThrow();
});

test("parsePickSourceResult throws on unparseable text instead of guessing", () => {
  expect(() => parsePickSourceResult("I'm not sure which one.", CANDIDATES.map((c) => c.id))).toThrow();
});

// ── pickCloneSource (I/O, DI'd chat) ──────────────────────────────────────
test("pickCloneSource skips the LLM call entirely when there's only one real candidate", async () => {
  let called = false;
  const chatFn = async () => { called = true; return { content: "{}" }; };
  const result = await pickCloneSource("anything", [CANDIDATES[0]!], "test-key", { chatFn });
  expect(result.sourceId).toBe("ac85eb0fa344");
  expect(called).toBe(false);
});

test("pickCloneSource throws a clear error rather than picking blindly when there are no candidates at all", async () => {
  await expect(pickCloneSource("anything", [], "test-key")).rejects.toThrow(/no.*candidate/i);
});

test("pickCloneSource calls the LLM with all candidates and returns its real pick when there's a genuine choice to make", async () => {
  const calls: { agentName: AgentName; messages: ChatMessage[] }[] = [];
  const chatFn = async (agentName: AgentName, messages: ChatMessage[]) => {
    calls.push({ agentName, messages });
    return { content: JSON.stringify({ sourceId: "bae438767bed", reasoning: "Closest structural match — services + case studies + contact." }) };
  };

  const result = await pickCloneSource("A law firm site with attorney bios and a contact form", CANDIDATES, "test-key", { chatFn });

  expect(result.sourceId).toBe("bae438767bed");
  expect(calls[0]!.agentName).toBe("arjun");
  expect(calls[0]!.messages[0]!.content).toContain("law firm");
});
