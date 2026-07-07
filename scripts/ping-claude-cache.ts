// Cheap, direct verification of T7's prompt caching (packages/llm-client/src/claude.ts):
// makes two real claudeChatWithTools() calls with a growing message history
// (mirroring runAgentWithClaude's loop shape) and checks whether the SECOND
// call shows cache_read_input_tokens > 0. This costs pennies and seconds —
// far cheaper than re-running a full 60-minute stress test just to answer
// "is caching actually hitting, or silently invalidating on every call?".
import { claudeChatWithTools, type ClaudeMessage, type ClaudeToolDef } from "../packages/llm-client/src/claude.ts";

// A deliberately large-ish system prompt — caching has a model-dependent
// minimum prefix (Sonnet-tier is 2048-4096 tokens per shared/prompt-caching.md);
// a one-line prompt would silently never cache regardless of correctness.
const SYSTEM_PROMPT = `You are a careful software engineer agent. ${"Follow every instruction precisely and verify your work before calling task_complete. ".repeat(150)}`;

const TOOLS: ClaudeToolDef[] = [
  {
    name: "read_file",
    description: "Read a file from the project.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "task_complete",
    description: "Call this when done.",
    input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
  },
];

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  console.log("ANTHROPIC_API_KEY present:", !!apiKey, "length:", apiKey.length);

  const messages: ClaudeMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "List the files in the project, then call task_complete with a one-sentence summary." },
  ];

  console.log("\n--- Call 1 (cold — expect cache WRITE, cache_creation_input_tokens > 0, cache_read_input_tokens near 0) ---");
  const r1 = await claudeChatWithTools(messages, TOOLS, apiKey);
  console.log("stopReason:", r1.stopReason, "toolCalls:", r1.toolCalls.map((t) => t.name));

  // Mirror claude-loop.ts's runAgentWithClaude: push the assistant turn, then
  // a synthetic tool_result, before the second call — same shape the real
  // escalation loop produces.
  messages.push({ role: "assistant", content: r1.rawContent });
  const firstCall = r1.toolCalls[0];
  if (firstCall) {
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: firstCall.id, content: JSON.stringify({ status: "success", output: "file1.ts\nfile2.ts" }) }],
    });
  } else {
    messages.push({ role: "user", content: "Please call a tool now." });
  }

  console.log("\n--- Call 2 (warm — expect cache READ, cache_read_input_tokens > 0 if caching is genuinely working) ---");
  const r2 = await claudeChatWithTools(messages, TOOLS, apiKey);
  console.log("stopReason:", r2.stopReason, "toolCalls:", r2.toolCalls.map((t) => t.name));

  console.log("\n(Check the [claude:claude-sonnet-5] usage log lines above for cache-write/cache-read token counts.)");
}

main().catch((err) => {
  console.log("FAILED —", String(err));
  process.exit(1);
});
