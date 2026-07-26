// Test NIM with shorter trigger_build spec to confirm the issue
const NIM_URL = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const apiKey = process.env.NIM_API_KEY ?? "";
const MODEL = "qwen/qwen3.5-122b-a10b";

const messages = [
  { role: "system", content: "You are a software product assistant. When ready to build, call trigger_build immediately. If the user says 'yes', 'go ahead', 'build it' — call trigger_build right now." },
  { role: "user", content: "Build a website for my company." },
  { role: "assistant", content: "Ready to proceed? Confirm." },
  { role: "user", content: "yes go ahead build it" },
];

// Minimal trigger_build tool
const TOOL = {
  type: "function" as const,
  function: {
    name: "trigger_build",
    description: "Call when user confirms. Provide the app name and description.",
    parameters: {
      type: "object",
      required: ["appName", "appDescription"],
      properties: {
        appName: { type: "string" },
        appDescription: { type: "string" },
      },
    },
  },
};

console.log("Testing with minimal trigger_build schema...");
const start = Date.now();
const res = await fetch(`${NIM_URL}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model: MODEL, messages, max_tokens: 200, stream: true, tools: [TOOL], tool_choice: "required" }),
});
console.log(`Status: ${res.status} in ${Date.now()-start}ms`);

let chunks = 0;
let toolCallArgs = "";
let isToolCall = false;
const reader = res.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") { console.log("\n[DONE received]"); break; }
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      chunks++;
      if (delta.tool_calls?.length) {
        isToolCall = true;
        const arg = delta.tool_calls[0]?.function?.arguments ?? "";
        toolCallArgs += arg;
        process.stdout.write(".");
      }
      if (delta.content) process.stdout.write(delta.content);
    } catch {}
  }
}

console.log(`\nTotal chunks: ${chunks}, isToolCall: ${isToolCall}, toolArgsLen: ${toolCallArgs.length}`);
console.log(`Total time: ${Date.now()-start}ms`);
if (toolCallArgs) {
  try { const p = JSON.parse(toolCallArgs); console.log("parsed:", p); }
  catch(e) { console.log("parse error:", e.message, toolCallArgs.substring(0, 100)); }
}
