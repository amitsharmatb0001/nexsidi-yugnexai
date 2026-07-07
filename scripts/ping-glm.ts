// Empirical diagnosis of WHY z-ai/glm-5.2 fails as an agent model.
// Observed pattern in stress-test runs 2/3: iteration 1 (no history) succeeds,
// then the very next call — the first one carrying an assistant tool_calls
// message + a role:"tool" result — throws and triggers fallback. And all 3 QA
// agents' one-shot 80K-token calls failed on it too. This script isolates the
// variables: plain chat, tools-no-history, tools-with-history, large input.
import { nimChat, nimChatWithTools, type NimMessage, type NimToolDef } from "../packages/llm-client/src/nim.ts";

const MODEL = "z-ai/glm-5.2" as const;

const TOOLS: NimToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in the project.",
      parameters: { type: "object", properties: { dir: { type: "string" } }, required: [] },
    },
  },
];

async function probe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`[${label}] SUCCESS`);
  } catch (err) {
    console.log(`[${label}] FAILED — ${String(err).slice(0, 500)}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  console.log("NIM_API_KEY present:", !!apiKey, "length:", apiKey.length);

  // 1. Plain small chat — baseline (known-working per ping-nim history)
  await probe("1: plain chat, small", () =>
    nimChat(MODEL, [{ role: "user", content: "Say hi in 3 words." }], apiKey, 50));

  // 2. Tools, NO history — matches every run's successful iteration 1
  await probe("2: tools, no history", () =>
    nimChatWithTools(MODEL, [
      { role: "system", content: "You are an agent. Use tools." },
      { role: "user", content: "List the files." },
    ], TOOLS, apiKey));

  // 3. Tools WITH a tool-calling history — matches the exact shape of every
  //    run's FAILING iteration 2 (assistant tool_calls + role:"tool" result)
  const historyMessages: NimMessage[] = [
    { role: "system", content: "You are an agent. Use tools." },
    { role: "user", content: "List the files." },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ status: "success", output: "a.ts\nb.ts\nc.ts" }) },
  ];
  await probe("3: tools, WITH tool-result history (the failing iteration-2 shape)", () =>
    nimChatWithTools(MODEL, historyMessages, TOOLS, apiKey));

  // 4. Large input, no tools — matches the QA agents' one-shot ~80K-token call
  const bigBlob = "// filler line of code with some content here\n".repeat(8000); // ~90-100K tokens
  await probe("4: plain chat, ~90K-token input (QA-agent shape)", () =>
    nimChat(MODEL, [{ role: "user", content: `Review this code and reply OK:\n${bigBlob}` }], apiKey, 50));

  // 5. Medium input, no tools — bisect if 4 fails
  const midBlob = "// filler line of code with some content here\n".repeat(2000); // ~24K tokens
  await probe("5: plain chat, ~24K-token input", () =>
    nimChat(MODEL, [{ role: "user", content: `Review this code and reply OK:\n${midBlob}` }], apiKey, 50));
}

main();
