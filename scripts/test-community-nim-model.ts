// Reusable smoke test for a "Launch from Hugging Face" (Beta) community NIM
// deployment — distinct from ping-nim.ts (which only checks plain chat
// against the default catalog endpoint https://integrate.api.nvidia.com/v1).
// Community HF deployments live at a DIFFERENT base URL
// (https://nim.api.nvidia.com/v1) and their tool-calling support depends on
// how the deployer launched vLLM (--enable-auto-tool-choice/--tool-call-parser)
// — this script checks both independently so a "works" verdict on chat never
// gets assumed to mean tools work too.
//
// Usage:
//   NIM_BASE_URL="https://nim.api.nvidia.com/v1" NIM_API_KEY="nvapi-..." \
//     bun run scripts/test-community-nim-model.ts <model-id>
import { nimChat, nimChatWithTools } from "../packages/llm-client/src/nim.ts";

const modelId = process.argv[2];
if (!modelId) {
  console.error("Usage: NIM_BASE_URL=... NIM_API_KEY=... bun run scripts/test-community-nim-model.ts <model-id>");
  process.exit(1);
}

const PING_TOOL = [
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write content to a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
];

async function main(): Promise<void> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const baseUrl = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  console.log("NIM_BASE_URL:", baseUrl);
  console.log("NIM_API_KEY present:", !!apiKey, "length:", apiKey.length);
  console.log("model:", modelId);

  console.log("\n--- Test 1: plain chat (no tools) ---");
  try {
    // Reasoning/distill models emit a <think>...</think> preamble before the
    // real answer — give this a much larger budget than a normal chat model
    // needs, or the response gets cut off mid-thought with no answer at all.
    const res = await nimChat(modelId as never, [{ role: "user", content: "Say hi in exactly 3 words." }], apiKey, 1024);
    const content = res.choices[0]?.message.content ?? "";
    console.log("SUCCESS — finish_reason:", res.choices[0]?.finish_reason);
    console.log("content:", JSON.stringify(content).slice(0, 500));
  } catch (err) {
    console.log("FAILED —", String(err));
  }

  console.log("\n--- Test 2: tool-calling (write_file) ---");
  try {
    const res = await nimChatWithTools(
      modelId as never,
      [{ role: "user", content: "Write a file named hello.txt containing the text: hello world" }],
      PING_TOOL,
      apiKey,
    );
    console.log("SUCCESS — finish_reason:", res.choices[0]?.finish_reason);
    console.log("tool_calls:", JSON.stringify(res.choices[0]?.message.tool_calls));
    if (!res.choices[0]?.message.tool_calls?.length) {
      console.log("NOTE: no tool_calls returned — model may not support tool-calling on this deployment.");
    }
  } catch (err) {
    console.log("FAILED —", String(err));
    console.log("NOTE: a 400 mentioning --enable-auto-tool-choice/--tool-call-parser means this specific");
    console.log("      deployment's vLLM server wasn't launched with tool-calling enabled — not fixable client-side.");
  }
}

main();
