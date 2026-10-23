// Agents that must never call Gemini (2026-10-23). Google flagged the project's Agent Platform use under its Acceptable
// Use Policy; the security review (and training that plants bugs in copies of our own code) is the work most likely to
// read like misuse, so it runs on NVIDIA's hosted models and everything else stays on Gemini (Amit's decision).
// NIM_ONLY_AGENTS lists the agents (comma-separated; default none). 2026-10-23 (Amit): the reviews are too important for a
// weaker model, so no agent is NVIDIA-only by default; the setting stays for work that should be kept off Gemini. The agent loops keep speaking the
// Gemini message format: this module translates the conversation to NVIDIA's (OpenAI-style) format and the answer back,
// so routeToolsWithFallback / agentChat can hand these agents over without any loop changing.
// Measured 2026-10-23: muse-glimmer-30b and nemotron-3-ultra each made a correct tool call in ~12 s; the local
// qwen2.5-coder 7B made none in 85 s, so no local model is used.
import { nimChatWithTools, nimChat, type NimMessage, type NimToolDef, type NimToolResponse } from "./nim.ts";
import type { GeminiMessage, GeminiPart, GeminiToolDef, GeminiChatWithToolsResult } from "./gemini.ts";
import type { ChatMessage, ModelId } from "./types.ts";

export const NIM_ONLY_CHAIN: ModelId[] = ["meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"] as ModelId[];

export function isNimOnlyAgent(agentName: string | undefined): boolean {
  if (!agentName) return false;
  const list = (process.env.NIM_ONLY_AGENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(agentName.toLowerCase());
}

const partsOf = (content: string | GeminiPart[]): GeminiPart[] => (typeof content === "string" ? [{ text: content }] : content);
const textOf = (parts: GeminiPart[]) =>
  parts.filter((p): p is { text: string } => "text" in p && !("thought" in p) && typeof p.text === "string").map((p) => p.text).join("\n");

/** The same conversation in NVIDIA's format. Call ids are made from the model turn's position, matched in order to the
 * function responses that follow it. Thought parts and images are not sent (NVIDIA's models here take text only). */
export function geminiToNimMessages(messages: GeminiMessage[]): NimMessage[] {
  const out: NimMessage[] = [];
  let pendingIds: string[] = [];
  messages.forEach((m, i) => {
    if (m.role === "system") { out.push({ role: "system", content: m.content }); return; }
    const parts = partsOf(m.content);
    if (m.role === "model") {
      const calls = parts.filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in p);
      pendingIds = calls.map((_, j) => `call_${i}_${j}`);
      const text = textOf(parts);
      out.push(calls.length > 0
        ? { role: "assistant", content: text || null, tool_calls: calls.map((c, j) => ({ id: pendingIds[j]!, type: "function" as const, function: { name: c.functionCall.name, arguments: JSON.stringify(c.functionCall.args ?? {}) } })) }
        : { role: "assistant", content: text });
      return;
    }
    const responses = parts.filter((p): p is { functionResponse: { name: string; response: Record<string, unknown> } } => "functionResponse" in p);
    responses.forEach((r, j) => out.push({ role: "tool", tool_call_id: pendingIds[j] ?? `call_orphan_${i}_${j}`, content: JSON.stringify(r.functionResponse.response) }));
    const text = textOf(parts) + (parts.some((p) => "inlineData" in p) ? "\n[an image was attached here; this model reads text only]" : "");
    if (text.trim()) out.push({ role: "user", content: text });
  });
  return out;
}

export function nimToGeminiResult(resp: NimToolResponse): GeminiChatWithToolsResult {
  const msg = resp.choices[0]?.message ?? { role: "assistant", content: null };
  const toolCalls = (msg.tool_calls ?? []).map((c) => {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(c.function.arguments || "{}"); } catch { input = { _unparsed: c.function.arguments }; }
    return { id: c.id, name: c.function.name, input };
  });
  const content = msg.content ?? "";
  const rawParts: GeminiPart[] = [
    ...(content ? [{ text: content }] : []),
    ...toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })),
  ];
  return {
    content,
    toolCalls,
    stopReason: resp.choices[0]?.finish_reason === "tool_calls" ? "STOP" : (resp.choices[0]?.finish_reason ?? null)?.toUpperCase() ?? null,
    rawParts,
    promptTokens: resp.usage?.prompt_tokens,
    completionTokens: resp.usage?.completion_tokens,
    cachedContentTokens: 0,
  };
}

type NimToolsFn = (model: ModelId, messages: NimMessage[], tools: NimToolDef[], apiKey: string) => Promise<NimToolResponse>;

export async function routeToolsViaNim(
  messages: GeminiMessage[],
  tools: GeminiToolDef[],
  agentName: string,
  deps: { chat?: NimToolsFn } = {},
): Promise<GeminiChatWithToolsResult & { modelUsed: string }> {
  const chat = deps.chat ?? nimChatWithTools;
  const nimMessages = geminiToNimMessages(messages);
  const nimTools: NimToolDef[] = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const errors: string[] = [];
  for (const model of NIM_ONLY_CHAIN) {
    const startedAt = Date.now();
    try {
      const resp = await chat(model, nimMessages, nimTools, process.env.NIM_API_KEY ?? "");
      console.log(`[call-time:nim-only] ${agentName} ${model} ok in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return { ...nimToGeminiResult(resp), modelUsed: model };
    } catch (err) {
      console.log(`[call-time:nim-only] ${agentName} ${model} FAILED in ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${String(err).replace(/\s+/g, " ").slice(0, 160)}`);
      errors.push(`${model}: ${String(err)}`);
    }
  }
  // Never falls back to Gemini: these agents are kept off it on purpose.
  throw new Error(`[llm-client] ${agentName} is NVIDIA-only and every NVIDIA model failed:\n${errors.join("\n")}`);
}

/** Plain chat (no tools) for an NVIDIA-only agent, same chain, never Gemini. */
export async function chatViaNim(agentName: string, messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<{ content: string; modelUsed: ModelId }> {
  const errors: string[] = [];
  for (const model of NIM_ONLY_CHAIN) {
    try {
      const res = await nimChat(model, messages, process.env.NIM_API_KEY ?? "", opts?.maxTokens);
      return { content: res.choices[0]?.message.content ?? "", modelUsed: model };
    } catch (err) {
      errors.push(`${model}: ${String(err)}`);
    }
  }
  throw new Error(`[llm-client] ${agentName} is NVIDIA-only and every NVIDIA model failed:\n${errors.join("\n")}`);
}
