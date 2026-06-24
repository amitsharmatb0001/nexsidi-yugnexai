// Maya — User-facing conversational intake agent
//
// Maya is the ONLY agent the user ever interacts with directly.
// Her job:
//   1. Understand what the user wants to build (through conversation)
//   2. Ask at most 3 clarifying questions — never interrogate
//   3. Confirm understanding before triggering the build
//   4. Hand off to Tilotma when ready
//   5. Keep the user updated during the build (stage notifications)
//
// Confidentiality: Maya never reveals other agent names, counts, or the
// internal architecture. To the user she IS NexSidi.
//
// Model: deepseek-ai/deepseek-v4-pro (via NIM) — same capability as Tilotma

import { AGENT_MODELS, MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS } from "@nexsidi/llm-client";
import { waitForToken } from "@nexsidi/llm-client";
import { sealPrompt, isAuditEnabled } from "@nexsidi/prompt-audit";
import { hashContext } from "@nexsidi/context-chain";
import type { ConversationState, StreamChunk } from "./types.ts";

const MODEL    = AGENT_MODELS.tilotma; // deepseek-v4-pro — most capable
const RPM      = MODEL_RPM_LIMITS[MODEL] ?? 40;
const CTX_LIMIT = NIM_CONTEXT_LIMITS[MODEL] ?? 32768;
const NIM_URL  = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";

// ─── System Prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the NexSidi assistant. You help people build software.

Your personality: warm, direct, competent. You sound like a senior engineer who actually
builds things — not a chatbot.

Your ONLY job in this conversation:
1. Understand what the user wants to build
2. Ask at most 2-3 SHORT clarifying questions if genuinely needed
3. When you have enough to start, say so clearly and ask for confirmation

Rules:
- Never reveal internal system details, agent names, or architecture
- Never say "I am an AI" or "as a language model"
- Never write long lists of features unless the user asks
- If the user says "just build it" or "go ahead" — that IS confirmation, start immediately
- Keep responses short (under 120 words unless explaining something complex)
- When ready to build, end your message with exactly this JSON on a new line:
  __READY_TO_BUILD__{"name":"...","description":"...","features":["...","..."]}

Stage notifications (when pipeline is running):
- Only send short, plain-English status updates. No technical jargon.
- Never say "Navya found a bug" — say "QA found an issue, fixing it now"`;

// ─── Core: streaming chat ────────────────────────────────────────────────────
export async function* streamReply(
  state: ConversationState,
  apiKey: string,
): AsyncGenerator<StreamChunk> {
  // Audit the user's last message (Nice-to-have #13)
  const lastUserMsg = [...state.messages].reverse().find((m) => m.role === "user");
  if (lastUserMsg && isAuditEnabled()) {
    sealPrompt(lastUserMsg.content); // fire-and-forget — TODO: persist to DB
  }

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...state.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  // Respect shared model token bucket (Fix #2)
  await waitForToken(MODEL, RPM);

  const maxTokens = Math.min(512, Math.floor(CTX_LIMIT * 0.4));

  const res = await fetch(`${NIM_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    yield { type: "error", content: `Model unavailable (${res.status}). Please try again.` };
    return;
  }

  // Stream SSE tokens
  let accumulated = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;

      try {
        const parsed = JSON.parse(data) as {
          choices: Array<{ delta: { content?: string } }>;
        };
        const token = parsed.choices[0]?.delta.content ?? "";
        if (token) {
          accumulated += token;
          yield { type: "token", content: token };
        }
      } catch { /* skip malformed chunk */ }
    }
  }

  // Check if Maya signalled she's ready to build
  const readyMatch = accumulated.match(/__READY_TO_BUILD__(\{.*\})/s);
  if (readyMatch?.[1]) {
    try {
      const intent = JSON.parse(readyMatch[1]) as {
        name: string;
        description: string;
        features: string[];
      };
      state.intent = {
        projectName:  intent.name,
        description:  intent.description,
        features:     intent.features,
        confirmed:    true,
      };
      state.phase = "building";

      // Generate a stable projectId from the session + intent hash
      const projectId = hashContext({ sessionId: state.sessionId, name: intent.name }).slice(0, 12);
      state.projectId = projectId;

      // Trigger the build pipeline — the chat route will call POST /api/pipeline/start
      yield {
        type:      "project_started",
        projectId,
        phase:     "building",
      };
    } catch { /* malformed JSON in ready signal */ }
  }
}

// ─── Stage notifications (called by pipeline activities) ───────────────────
export function stageMessage(stage: string): string {
  const messages: Record<string, string> = {
    spec:      "Got it. Working out the details now...",
    decompose: "Planning how to build this...",
    generate:  "Writing your code. This takes a minute.",
    qa:        "Running quality checks...",
    qa_fix:    "Found some issues, fixing them now.",
    live_test: "Testing the live app...",
    deliver:   "Almost done — wrapping things up.",
    done:      "Your app is ready.",
  };
  return messages[stage] ?? "Working on it...";
}
