// Test the exact NIM call the planner makes
import { AGENT_MODELS, MODEL_RPM_LIMITS, NIM_CONTEXT_LIMITS } from "../packages/llm-client/src/types.ts";

const MODEL = AGENT_MODELS.tilotma;
const CTX_LIMIT = NIM_CONTEXT_LIMITS[MODEL] ?? 32768;
const NIM_URL = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const apiKey = process.env.NIM_API_KEY ?? "";

console.log("Model:", MODEL);
console.log("NIM_URL:", NIM_URL);
console.log("API key set:", apiKey ? "YES" : "NO");

const TOOL = {
  type: "function" as const,
  function: {
    name: "trigger_build",
    description: "Call this ONLY when you have gathered enough information to build the app and the user has confirmed.",
    parameters: {
      type: "object",
      required: ["appName", "appDescription", "pages", "authType", "apiContract", "dbSchema", "frontendTasks", "backendTasks", "databaseTasks"],
      properties: {
        appName:        { type: "string" },
        appDescription: { type: "string" },
        pages: { type: "array", items: { type: "object", required: ["name", "path", "description"], properties: { name: { type: "string" }, path: { type: "string" }, description: { type: "string" } } } },
        authType: { type: "string", enum: ["none", "jwt"] },
        apiContract: { type: "object", required: ["endpoints"], properties: { endpoints: { type: "array", items: { type: "object", required: ["route", "method", "description"], properties: { route: { type: "string" }, method: { type: "string", enum: ["GET","POST","PUT","PATCH","DELETE"] }, description: { type: "string" } } } } } },
        dbSchema: { type: "object", required: ["tables"], properties: { tables: { type: "array", items: { type: "object", required: ["name", "fields"], properties: { name: { type: "string" }, fields: { type: "array", items: { type: "object", required: ["name", "type"], properties: { name: { type: "string" }, type: { type: "string" }, nullable: { type: "boolean" } } } } } } } } },
        frontendTasks: { type: "array", items: { type: "object", required: ["description", "outputFiles"], properties: { description: { type: "string" }, outputFiles: { type: "array", items: { type: "string" } } } } },
        backendTasks: { type: "array", items: { type: "object", required: ["description", "outputFiles"], properties: { description: { type: "string" }, outputFiles: { type: "array", items: { type: "string" } } } } },
        databaseTasks: { type: "array", items: { type: "object", required: ["description", "outputFiles"], properties: { description: { type: "string" }, outputFiles: { type: "array", items: { type: "string" } } } } },
      },
    },
  },
};

const messages = [
  { role: "system" as const, content: "You are a software product assistant. Help people plan and build web apps. When ready to build, call trigger_build." },
  { role: "user" as const, content: "hi, what can you do?" },
];

const maxTokens = Math.min(1024, Math.floor(CTX_LIMIT * 0.4));
console.log("maxTokens:", maxTokens);

const body = {
  model: MODEL,
  messages,
  max_tokens: maxTokens,
  stream: true,
  tools: [TOOL],
  tool_choice: "auto",
};

console.log("Request body size:", JSON.stringify(body).length, "bytes");
console.log("\nFetching...");

const res = await fetch(`${NIM_URL}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body),
});

console.log("Status:", res.status, res.statusText);
console.log("ok:", res.ok);

if (!res.ok) {
  const text = await res.text();
  console.log("Error body:", text.substring(0, 500));
  process.exit(1);
}

// Stream first 3 chunks
let chunkCount = 0;
const reader = res.body!.getReader();
const decoder = new TextDecoder();
outer: while (chunkCount < 5) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") break outer;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      console.log(`Chunk ${++chunkCount}: content="${delta?.content ?? ""}" tool_calls=${delta?.tool_calls ? "YES" : "NO"}`);
      if (chunkCount >= 3) break outer;
    } catch { }
  }
}
reader.cancel();
console.log("\nDone.");
