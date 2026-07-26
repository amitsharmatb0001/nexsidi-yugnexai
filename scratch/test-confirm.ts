// Test what NIM returns when user says "yes go ahead build it"
const NIM_URL = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const apiKey = process.env.NIM_API_KEY ?? "";
const MODEL = "qwen/qwen3.5-122b-a10b";

const messages = [
  { role: "system", content: "You are a software product assistant. You help people plan and build web apps. When ready to build, call trigger_build. If the user says 'go ahead', 'yes', 'start', 'build it' — that IS confirmation. Immediately call trigger_build with the complete specification." },
  { role: "user", content: "i want a website for nextech IT services company. Pages: Vision, Mission, About Us, Services, Contact. Need sign in for both clients and internal team." },
  { role: "assistant", content: "Got it. I'm building **Nextech IT Hub**. Ready to proceed? Confirm, and I'll start building." },
  { role: "user", content: "yes go ahead build it" },
];

const TOOL = {
  type: "function" as const,
  function: {
    name: "trigger_build",
    description: "Call this when the user confirms. Pass the complete technical specification.",
    parameters: {
      type: "object",
      required: ["appName", "appDescription", "pages", "authType", "apiContract", "dbSchema", "frontendTasks", "backendTasks", "databaseTasks"],
      properties: {
        appName: { type: "string" },
        appDescription: { type: "string" },
        pages: { type: "array", items: { type: "object", required: ["name", "path", "description"], properties: { name: { type: "string" }, path: { type: "string" }, description: { type: "string" } } } },
        authType: { type: "string", enum: ["none", "jwt"] },
        apiContract: { type: "object", required: ["endpoints"], properties: { endpoints: { type: "array", items: { type: "object", required: ["route", "method", "description"], properties: { route: { type: "string" }, method: { type: "string", enum: ["GET","POST","PUT","PATCH","DELETE"] }, description: { type: "string" } } } } } },
        dbSchema: { type: "object", required: ["tables"], properties: { tables: { type: "array", items: { type: "object", required: ["name", "fields"], properties: { name: { type: "string" }, fields: { type: "array", items: { type: "object", required: ["name", "type"], properties: { name: { type: "string" }, type: { type: "string" } } } } } } } } },
        frontendTasks: { type: "array", items: { type: "object", required: ["description", "outputFiles"], properties: { description: { type: "string" }, outputFiles: { type: "array", items: { type: "string" } } } } },
        backendTasks: { type: "array", items: { type: "object", required: ["description", "outputFiles"], properties: { description: { type: "string" }, outputFiles: { type: "array", items: { type: "string" } } } } },
        databaseTasks: { type: "array", items: { type: "object", required: ["description", "outputFiles"], properties: { description: { type: "string" }, outputFiles: { type: "array", items: { type: "string" } } } } },
      },
    },
  },
};

console.log("Testing NIM with 'yes go ahead build it' confirmation...");
const res = await fetch(`${NIM_URL}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model: MODEL, messages, max_tokens: 4096, stream: true, tools: [TOOL], tool_choice: "auto" }),
});

console.log("Status:", res.status, res.ok);
if (!res.ok) { console.log(await res.text()); process.exit(1); }

let chunks = 0;
let textContent = "";
let toolCallArgs = "";
let isToolCall = false;
const reader = res.body!.getReader();
const decoder = new TextDecoder();

outer: while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") break outer;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      chunks++;
      if (delta.content) { textContent += delta.content; process.stdout.write(delta.content); }
      if (delta.tool_calls?.length) {
        isToolCall = true;
        const arg = delta.tool_calls[0]?.function?.arguments ?? "";
        toolCallArgs += arg;
        if (chunks <= 3) console.log(`\n[tool_call chunk ${chunks}]: "${arg.substring(0, 80)}"`);
      }
    } catch {}
  }
}

console.log(`\n\nTotal chunks: ${chunks}, isToolCall: ${isToolCall}, textLen: ${textContent.length}, toolArgsLen: ${toolCallArgs.length}`);
if (toolCallArgs.length > 0) {
  try {
    const plan = JSON.parse(toolCallArgs);
    console.log("✅ trigger_build parsed OK:", plan.appName, "pages:", plan.pages?.length);
  } catch(e) {
    console.log("❌ JSON parse failed:", e.message);
    console.log("First 200 chars:", toolCallArgs.substring(0, 200));
  }
}
