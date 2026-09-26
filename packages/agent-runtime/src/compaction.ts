import { readFileSync, existsSync } from "node:fs";
import type { GeminiMessage, GeminiPart } from "@nexsidi/llm-client";

export type CompactionChat = (
  messages: Array<{ role: "user"; content: string }>,
) => Promise<{ content: string }>;

async function chatWithGemini(messages: Array<{ role: "user"; content: string }>): Promise<{ content: string }> {
  const { geminiChat } = await import("@nexsidi/llm-client");
  return geminiChat(messages);
}

// 2026-09-26: compactHistory serves two shapes — NimMessage (loop.ts: string
// content, tool calls in `tool_calls`, results as role "tool") and
// ClaudeMessage (claude-loop.ts: content is an array of text/tool_use/
// tool_result/image blocks). The old estimate read `content.length`, which
// for a block array is the NUMBER OF BLOCKS: a ~50K-token Claude history was
// estimated at 2 tokens, so the Claude escalation tier never compacted at all.
type CompactableMessage = { role: string; content?: unknown };

// Claude bills an image by its pixel size (about 1,600 tokens for a full
// screenshot), not by its base64 length.
const CLAUDE_IMAGE_TOKENS = 1_600;

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "image") {
      n += CLAUDE_IMAGE_TOKENS * 4;
      continue;
    }
    if (typeof block.text === "string") n += block.text.length;
    if (block.type === "tool_use") n += JSON.stringify(block.input ?? {}).length;
    if (block.type === "tool_result") n += contentChars(block.content);
  }
  return n;
}

export function estimateTokenCount(messages: ReadonlyArray<{ role: string; content?: unknown; tool_calls?: unknown }>): number {
  let totalChars = 0;
  for (const m of messages) {
    totalChars += contentChars(m.content);
    if (m.tool_calls) totalChars += JSON.stringify(m.tool_calls).length;
  }
  return Math.round(totalChars / 4);
}

function isToolResultMessage(m: CompactableMessage): boolean {
  if (m.role === "tool") return true;
  return m.role === "user" && Array.isArray(m.content) && (m.content as Array<{ type?: string }>).some((b) => b.type === "tool_result");
}

// Same hazard class as safeTrailingSlice (Gemini, below): walk the window
// start back so a tool result never appears without the assistant turn that
// called it. A plain "last 4 messages" could start on a NIM `tool` message
// or a Claude tool_result whose call had just been summarized away, which
// both APIs reject.
export function safeToolTrailingStart(messages: ReadonlyArray<CompactableMessage>, desiredCount: number, floor: number): number {
  let start = Math.max(floor, messages.length - desiredCount);
  while (start > floor && isToolResultMessage(messages[start]!)) start--;
  return start;
}

// Never send screenshot bytes to the summarizer: they are what compaction is
// removing, and a placeholder still tells it an image existed.
function summarizableContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return (content as Array<Record<string, unknown>>).map((b) =>
    b.type === "image"
      ? { type: "text", text: "[screenshot]" }
      : b.type === "tool_result"
        ? { ...b, content: summarizableContent(b.content) }
        : b,
  );
}

export async function compactHistory<T extends CompactableMessage>(
  messages: T[],
  chat: CompactionChat = chatWithGemini,
): Promise<T[]> {
  const tokens = estimateTokenCount(messages);
  if (tokens < 30000) return messages; // No compaction needed

  console.log(`[compaction] History size ${tokens} tokens exceeds 30K limit. Running compaction...`);

  if (messages.length < 8) return messages; // Too short to compact safely

  const systemPrompt = messages[0]!;
  const initialUserMessage = messages[1]!;

  // Preserve the last ~4 messages for immediate turn context, widened when
  // needed so no tool result is separated from its call.
  const start = safeToolTrailingStart(messages, 4, 2);
  const trailingMessages = messages.slice(start);

  // The middle portion to compact
  const middleMessages = messages.slice(2, start);
  if (middleMessages.length === 0) return messages; // pairing-safety consumed the whole window

  try {
    const middleSerialized = JSON.stringify(middleMessages.map((m) => ({ role: m.role, content: summarizableContent(m.content) })));
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

    // A plain { role: "user", content: string } is valid in both NIM and Claude shapes.
    const summaryMessage = {
      role: "user",
      content: `Here is a summary of the work and debugging steps you completed so far:\n${summary}\n\nPlease proceed with the next steps.`,
    } as T;
    return [systemPrompt, initialUserMessage, summaryMessage, ...trailingMessages];
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
  return Math.round(estimateGeminiChars(messages) / 4);
}

// The character count behind estimateGeminiTokenCount, exported (2026-09-26)
// so the triage pass can adjust it exactly and incrementally per replaced
// functionResponse instead of re-measuring the whole history each time.
export function estimateGeminiChars(messages: GeminiMessage[]): number {
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
      // 2026-08-27: real bug found live (project 852be5aeaef4, $322 spend).
      // inlineData (base64 screenshots, pushed by gemini-loop.ts's
      // browser_screenshot handler) was counted as ZERO here, so a history
      // carrying several screenshots reported ~272K tokens while the request
      // Gemini actually billed was ~598K — a 2.2x blind spot. Because this
      // estimate is what decides WHETHER to compact, the images were both
      // invisible to the threshold AND (see context-selection.ts's capPart)
      // exempt from being trimmed, so they rode along in every subsequent
      // call forever and history could never get back under the threshold.
      // Counting them at the same chars/4 rate as everything else is a rough
      // proxy (Gemini tokenizes images by tile, not by base64 length), but a
      // deliberately conservative one: over-reporting an image's cost makes
      // compaction fire sooner, which is the correct failure direction for a
      // payload that should not be replayed indefinitely anyway.
      else if ("inlineData" in part) totalChars += part.inlineData.data.length;
    }
  }
  return totalChars;
}

function hasFunctionResponsePart(m: GeminiMessage): boolean {
  return Array.isArray(m.content) && m.content.some((p) => "functionResponse" in p);
}

// Walk the desired trailing-window start backward past any turn that is a
// functionResponse reply, so its matching functionCall (the immediately
// preceding turn) is always kept alongside it. Without this, compacting
// mid-tool-call would send Gemini a functionResponse with no functionCall
// in the same request, which the API rejects.
//
// Exported (2026-08-13, cost-control Task 2) so context-selection.ts's
// selectRelevantContext can reuse the exact same pairing-safety walk for its
// "last N raw turns" window instead of reimplementing it — this is the same
// hazard class (a naive slice(-N) splitting a functionCall/functionResponse
// pair) regardless of which mechanism is choosing the trailing window.
export function safeTrailingSlice(nonSys: GeminiMessage[], desiredCount: number): GeminiMessage[] {
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
    // 2026-08-27 (systematic audit of the GeminiPart-variant bug class, the
    // same class as estimateGeminiTokenCount/capPart above): an inlineData
    // part (a screenshot) matched none of the branches above and fell into
    // the `{ thought: true }` default — telling the summarizer LLM that a
    // screenshot was an empty thought marker. Any conclusion that depended
    // on having LOOKED at the app ("the hero renders white-on-white") was
    // therefore erased from the summary it produced, silently and with no
    // way to notice. Never send the base64 payload here (that is what the
    // caller is compacting AWAY), but do say an image existed so the
    // summarizer can carry that fact forward honestly.
    if ("inlineData" in p) return { image: `[screenshot: ${p.inlineData.mimeType}]` };
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
