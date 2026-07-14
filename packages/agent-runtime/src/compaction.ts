import { readFileSync, existsSync } from "node:fs";
import type { NimMessage } from "@nexsidi/llm-client";

export function estimateTokenCount(messages: { role: string; content?: string | null }[]): number {
  let totalChars = 0;
  for (const m of messages) {
    if (m.content) totalChars += m.content.length;
  }
  return Math.round(totalChars / 4);
}

export async function compactHistory(messages: NimMessage[]): Promise<NimMessage[]> {
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
    const { geminiChat } = await import("@nexsidi/llm-client");
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

    const chatResponse = await geminiChat([
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
