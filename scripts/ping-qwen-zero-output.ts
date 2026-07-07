// Direct reproduction attempt: across stress4/5/6 (3 independent runs, 7
// total occurrences in the tool-calling loop + 1 in a one-shot QA call),
// EVERY single "0 completion_tokens" response was qwen/qwen3.5-122b-a10b —
// never any other model. All 7 tool-calling occurrences happened as the
// FALLBACK model receiving a conversation history built by a DIFFERENT
// model's tool-calling turn. This tests that exact shape directly: a
// system+user+assistant(tool_calls)+tool(result) history handed to
// qwen3.5-122b-a10b cold, mirroring exactly what runAgent's fallback
// handoff does.
import { nimChatWithTools, type NimMessage, type NimToolDef } from "../packages/llm-client/src/nim.ts";

const MODEL = "qwen/qwen3.5-122b-a10b";

const TOOLS: NimToolDef[] = [
  { type: "function", function: { name: "write_file", description: "Write a file.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "run_command", description: "Run a shell command.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "task_complete", description: "Call when done.", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } } },
];

async function probe(label: string, messages: NimMessage[]): Promise<void> {
  try {
    const res = await nimChatWithTools(MODEL, messages, TOOLS, process.env.NIM_API_KEY ?? "");
    const choice = res.choices[0];
    console.log(`[${label}] finish_reason=${(choice as any)?.finish_reason} content_len=${choice?.message.content?.length ?? "null"} tool_calls=${choice?.message.tool_calls?.length ?? 0}`);
  } catch (err) {
    console.log(`[${label}] THREW — ${String(err).slice(0, 300)}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  console.log("NIM_API_KEY present:", !!apiKey, "length:", apiKey.length);

  // Shape 1: fresh, no history — the ALWAYS-SUCCEEDS case in every run.
  await probe("1: fresh, no history", [
    { role: "system", content: "You are a coding agent. Use tools to write files." },
    { role: "user", content: "Write a simple hello.txt file with 'hello world' in it, then call task_complete." },
  ]);

  // Shape 2: the exact fallback-handoff shape — a PRIOR model's tool_calls +
  // tool result already in history, cold-started on qwen3.5 as the fallback.
  await probe("2: mid-conversation handoff (assistant tool_calls + tool result already present)", [
    { role: "system", content: "You are a coding agent. Use tools to write files." },
    { role: "user", content: "Write hello.txt with 'hello world', then run 'cat hello.txt' to verify, then call task_complete." },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_abc123", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "hello.txt", content: "hello world" }) } }],
    },
    { role: "tool", tool_call_id: "call_abc123", content: JSON.stringify({ status: "success", summary: "Wrote 11 chars to hello.txt" }) },
  ]);

  // Shape 3: same as shape 2 but with a LARGER history (multiple tool
  // rounds) — matches the 13-24-iterations-deep cases in the real logs.
  const deepMessages: NimMessage[] = [
    { role: "system", content: "You are a coding agent. Use tools to write files." },
    { role: "user", content: "Build a small task manager: types, mock data, 3 components, then verify with npm build, then call task_complete." },
  ];
  for (let i = 0; i < 6; i++) {
    const callId = `call_${i}`;
    deepMessages.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id: callId, type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: `file${i}.ts`, content: `export const x${i} = ${i};\n`.repeat(50) }) } }],
    });
    deepMessages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify({ status: "success", summary: `Wrote file${i}.ts` }) });
  }
  await probe("3: deep history (6 prior tool rounds, matches 13-24-iteration real cases)", deepMessages);
}

main().catch((err) => {
  console.log("FAILED —", String(err));
  process.exit(1);
});
