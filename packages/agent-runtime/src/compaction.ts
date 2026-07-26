import { readFileSync, existsSync } from "node:fs";
import type { NimMessage, GeminiMessage, GeminiPart } from "@nexsidi/llm-client";

export type CompactionChat = (
  messages: Array<{ role: "user"; content: string }>,
) => Promise<{ content: string }>;

async function chatWithGemini(messages: Array<{ role: "user"; content: string }>): Promise<{ content: string }> {
  const { geminiChat } = await import("@nexsidi/llm-client");
  return geminiChat(messages);
}

export function estimateTokenCount(messages: { role: string; content?: string | null }[]): number {
  let totalChars = 0;
  for (const m of messages) {
    if (m.content) totalChars += m.content.length;
  }
  return Math.round(totalChars / 4);
}

export async function compactHistory(
  messages: NimMessage[],
  chat: CompactionChat = chatWithGemini,
): Promise<NimMessage[]> {
  const tokens = estimateTokenCount(messages);
  if (tokens < 30000) return messages; // No compaction needed

  console.log(`[compaction] History size ${tokens} tokens exceeds 30K limit. Running compaction...`);

  if (messages.length < 8) return messages; // Too short to compact safely

  const systemPrompt = messages[0]!;
  const initialUserMessage = messages[1]!;

  // Preserve the last 4 messages for immediate turn context
  const trailingCount = 4;
  const trailingMessages = messages.slice(messages.length - trailingCount);

  // The middle portion to compact
  const middleMessages = messages.slice(2, messages.length - trailingCount);

  try {
    const middleSerialized = JSON.stringify(middleMessages.map((m) => ({ role: m.role, content: m.content })));
    const prompt = `\
You are a context compaction utility.
Summarize the following sequence of agent actions, file edits, compilation errors, and command outputs into a single cohesive summary.
Describe:
1. What files were successfully written or modified.
2. What compiler or test errors were encountered, and what changes resolved them.
3. The current state of the code and environment.

Keep it concise, actionable, and under 1000 words. Do NOT include raw compiler stack traces or long code blocks.
RAW HISTORY TO SUMMARIZE:
${middleSerialized}`;

    const chatResponse = await chat([
      { role: "user", content: prompt }
    ]);
    const summary = chatResponse.content;

    console.log(`[compaction] Successfully compacted history. Summary size: ${Math.round(summary.length / 4)} tokens.`);

    return [
      systemPrompt,
      initialUserMessage,
      {
        role: "user",
        content: `Here is a summary of the work and debugging steps you completed so far:\n${summary}\n\nPlease proceed with the next steps.`,
      },
      ...trailingMessages,
    ];
  } catch (err) {
    console.error("[compaction] Context compaction failed:", err);
    return messages;
  }
}

// ── Gemini-shaped compaction (W0.3, full agentic upgrade) ──────────────────
//
// compactHistory above operates on NimMessage[] (OpenAI-style: separate
// "assistant"/"tool" roles) and is NOT shape-compatible with GeminiMessage
// (role "model", content is a GeminiPart[] that inlines functionCall/
// functionResponse). This is why it was never wired into gemini-loop.ts/
// qa-loop.ts despite existing since well before this fix. A second gap:
// Gemini's API requires every functionCall part to be answered by a
// functionResponse in the IMMEDIATELY NEXT turn — a naive slice(-N) trailing
// window (as gemini-loop.ts's old 720K reactive hard-drop used) can cut
// between them, producing an invalid request. The pairing-safety walk below
// exists specifically to prevent that.

export type GeminiCompactionChat = (
  messages: Array<{ role: "user"; content: string }>,
) => Promise<{ content: string }>;

async function chatWithGeminiForCompaction(
  messages: Array<{ role: "user"; content: string }>,
): Promise<{ content: string }> {
  const { geminiChat } = await import("@nexsidi/llm-client");
  return geminiChat(messages);
}

export function estimateGeminiTokenCount(messages: GeminiMessage[]): number {
  let totalChars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      totalChars += m.content.length;
      continue;
    }
    for (const part of m.content) {
      // "text" also matches the thought variant's optional text field (which
      // can be undefined) — exclude thought parts explicitly, same pattern
      // gemini.ts's partsToText uses, both because thought text can be
      // undefined and because thought parts are intentionally excluded from
      // this estimate (a rough proactive check for WHETHER to compact, not a
      // billing calculation).
      if ("text" in part && !("thought" in part)) totalChars += part.text.length;
      else if ("functionCall" in part) totalChars += JSON.stringify(part.functionCall).length;
      else if ("functionResponse" in part) totalChars += JSON.stringify(part.functionResponse).length;
    }
  }
  return Math.round(totalChars / 4);
}

function hasFunctionResponsePart(m: GeminiMessage): boolean {
  return Array.isArray(m.content) && m.content.some((p) => "functionResponse" in p);
}

// Walk the desired trailing-window start backward past any turn that is a
// functionResponse reply, so its matching functionCall (the immediately
// preceding turn) is always kept alongside it. Without this, compacting
// mid-tool-call would send Gemini a functionResponse with no functionCall
// in the same request, which the API rejects.
function safeTrailingSlice(nonSys: GeminiMessage[], desiredCount: number): GeminiMessage[] {
  let start = Math.max(0, nonSys.length - desiredCount);
  while (start > 0 && hasFunctionResponsePart(nonSys[start]!)) {
    start--;
  }
  return nonSys.slice(start);
}

// Strip fields the summarizer LLM doesn't need (thoughtSignature is opaque
// bytes meaningless in a text summary) while keeping the shape readable.
function partsForSummaryPrompt(parts: GeminiPart[]): unknown[] {
  return parts.map((p) => {
    if ("text" in p && !("thought" in p)) return { text: p.text };
    if ("functionCall" in p) return { functionCall: p.functionCall };
    if ("functionResponse" in p) return { functionResponse: p.functionResponse };
    return { thought: true };
  });
}

export async function compactGeminiHistory(
  messages: GeminiMessage[],
  chat: GeminiCompactionChat = chatWithGeminiForCompaction,
  thresholdTokens = 40_000,
): Promise<GeminiMessage[]> {
  const tokens = estimateGeminiTokenCount(messages);
  if (tokens < thresholdTokens) return messages;

  const sys = messages.filter((m) => m.role === "system");
  const nonSys = messages.filter((m) => m.role !== "system");
  if (nonSys.length < 8) return messages; // too short to compact safely

  const trailing = safeTrailingSlice(nonSys, 6);
  const middle = nonSys.slice(0, nonSys.length - trailing.length);
  if (middle.length === 0) return messages; // pairing-safety consumed the whole window

  console.log(
    `[gemini-compaction] History ~${tokens} tokens exceeds ${thresholdTokens} — summarizing ${middle.length} messages, keeping ${trailing.length} trailing.`,
  );

  try {
    const middleSerialized = JSON.stringify(
      middle.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : partsForSummaryPrompt(m.content),
      })),
    );
    const prompt = `\
You are a context compaction utility.
Summarize the following sequence of agent actions, file edits, tool calls, and their results into a single cohesive summary.
Describe:
1. What files were successfully written or modified.
2. What compiler or test errors were encountered, and what changes resolved them.
3. The current state of the code and environment.

Keep it concise, actionable, and under 1000 words. Do NOT include raw compiler stack traces or long code blocks.
RAW HISTORY TO SUMMARIZE:
${middleSerialized}`;

    const chatResponse = await chat([{ role: "user", content: prompt }]);
    const summary = chatResponse.content;
    console.log(`[gemini-compaction] Summarized. Summary size: ~${Math.round(summary.length / 4)} tokens.`);

    const summaryMsg: GeminiMessage = {
      role: "user",
      content: `[CONTEXT COMPACTED: summary of ${middle.length} earlier messages]\n${summary}\n\nContinue from this state.`,
    };
    return [...sys, summaryMsg, ...trailing];
  } catch (err) {
    console.error("[gemini-compaction] Summarization failed, falling back to hard-drop:", err);
    // Fail-safe: still shrink the context even if the summarizer call itself
    // fails, matching gemini-loop.ts's pre-existing hard-drop behavior.
    const fallbackMsg: GeminiMessage = {
      role: "user",
      content: `[CONTEXT COMPACTED: ${middle.length} earlier messages dropped — summarization failed, continuing without a summary.]`,
    };
    return [...sys, fallbackMsg, ...trailing];
  }
}

export function findSymbolInFile(filePath: string, symbol: string): string {
  if (!existsSync(filePath)) return `File not found: ${filePath}`;
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const regex = new RegExp(`\\b(class|function|const|let|interface|type|enum)\\s+${symbol}\\b`, "i");
  let matchLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && regex.test(line)) {
      matchLineIdx = i;
      break;
    }
  }

  if (matchLineIdx === -1) {
    return `Symbol "${symbol}" not found in ${filePath}`;
  }

  const start = Math.max(0, matchLineIdx - 5);
  const end = Math.min(lines.length, matchLineIdx + 25);
  const slice = lines.slice(start, end).join("\n");
  return `// ${filePath} L${start + 1}-${end}\n${slice}\n...[truncated]`;
}
