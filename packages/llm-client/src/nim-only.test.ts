import { test, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { isNimOnlyAgent, geminiToNimMessages, nimToGeminiResult, routeToolsViaNim } from "./nim-only.ts";
import type { GeminiMessage } from "./gemini.ts";

// 2026-10-23 (Amit): Google flagged the project's Agent Platform use. The security review (and training that plants
// bugs in copies of our own code) is the work most likely to look like misuse, so those agents run on NVIDIA's models
// instead of Gemini; everything else stays on Gemini. NIM_ONLY_AGENTS lists them (default: the security reviewer).
// Measured the same day: NVIDIA muse-glimmer-30b and nemotron-3-ultra each made a correct tool call in ~12 s; the local
// qwen2.5-coder 7B made none in 85 s, so the local model is not used.

afterEach(() => { delete process.env.NIM_ONLY_AGENTS; });

// Same day, Amit: the reviews are too important to move to a weaker model, so by default no agent is NVIDIA-only.
test("no agent is NVIDIA-only by default; the list is a setting", () => {
  expect(isNimOnlyAgent("karan")).toBe(false);
  expect(isNimOnlyAgent("navya")).toBe(false);
  process.env.NIM_ONLY_AGENTS = "karan";
  expect(isNimOnlyAgent("karan")).toBe(true);
  expect(isNimOnlyAgent(undefined)).toBe(false);
  process.env.NIM_ONLY_AGENTS = "karan, navya";
  expect(isNimOnlyAgent("navya")).toBe(true);
  process.env.NIM_ONLY_AGENTS = "";
  expect(isNimOnlyAgent("karan")).toBe(false);
});

test("a Gemini tool conversation becomes the same conversation in NVIDIA's format", () => {
  const msgs: GeminiMessage[] = [
    { role: "system", content: "You review code." },
    { role: "user", content: "Review this." },
    { role: "model", content: [{ thought: true, text: "hidden" }, { text: "Reading." }, { functionCall: { name: "read_file", args: { path: "a.ts" } } }] },
    { role: "user", content: [{ functionResponse: { name: "read_file", response: { content: "x" } } }] },
  ];
  expect(geminiToNimMessages(msgs)).toEqual([
    { role: "system", content: "You review code." },
    { role: "user", content: "Review this." },
    { role: "assistant", content: "Reading.", tool_calls: [{ id: "call_2_0", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
    { role: "tool", tool_call_id: "call_2_0", content: '{"content":"x"}' },
  ]);
});

test("an NVIDIA answer comes back in the shape the agent loops already read", () => {
  const r = nimToGeminiResult({
    choices: [{ message: { role: "assistant", content: "Done.", tool_calls: [{ id: "c1", type: "function", function: { name: "submit_findings", arguments: '{"findings":[]}' } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  });
  expect(r.content).toBe("Done.");
  expect(r.toolCalls).toEqual([{ id: "c1", name: "submit_findings", input: { findings: [] } }]);
  expect(r.rawParts).toEqual([{ text: "Done." }, { functionCall: { name: "submit_findings", args: { findings: [] } } }]);
  expect(r.promptTokens).toBe(100);
  expect(r.completionTokens).toBe(20);
});

test("the NVIDIA chain tries the next model when one fails, and never calls Gemini", async () => {
  const tried: string[] = [];
  const r = await routeToolsViaNim([{ role: "user", content: "hi" }], [], "karan", {
    chat: async (model) => {
      tried.push(model);
      if (tried.length === 1) throw new Error("429");
      return { choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    },
  });
  expect(tried).toEqual(["meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"]);
  expect(r.modelUsed).toBe("nvidia/nemotron-3-ultra-550b-a55b");
  expect(r.content).toBe("ok");
});

test("both router entry points send NVIDIA-only agents to NVIDIA before any Gemini path", () => {
  const src = readFileSync(new URL("./router.ts", import.meta.url), "utf-8");
  const tools = src.slice(src.indexOf("export async function routeToolsWithFallback"));
  expect(tools.indexOf("isNimOnlyAgent(opts?.agentName)")).toBeGreaterThan(-1);
  expect(tools.indexOf("isNimOnlyAgent(opts?.agentName)")).toBeLessThan(tools.indexOf("const pool ="));
  const chat = src.slice(src.indexOf("export async function agentChat"));
  expect(chat.indexOf("isNimOnlyAgent(agentName)")).toBeGreaterThan(-1);
  expect(chat.indexOf("isNimOnlyAgent(agentName)")).toBeLessThan(chat.indexOf("shouldUseGeminiForPipeline(agentName)"));
});
