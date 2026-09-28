import { test, expect, afterEach } from "bun:test";
import { createServer, type Server } from "node:http";
import { ollamaChatWithTools } from "./ollama.ts";

// 2026-09-28: the agent tool loop sent EVERY model to NIM, so even a
// correctly-named Ollama model could never run there. Ollama serves the same
// OpenAI-style /v1/chat/completions (with tools) that NIM does.
let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

test("ollamaChatWithTools posts an OpenAI-style tools request to <base>/v1/chat/completions and returns the tool call", async () => {
  let seen: { url?: string; body?: Record<string, unknown> } = {};
  const base = await new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen = { url: req.url, body: JSON.parse(raw) };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "ping", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const a = server!.address();
      resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
    });
  });
  const r = await ollamaChatWithTools("qwen3-coder:30b", [{ role: "user", content: "ping" }],
    [{ type: "function", function: { name: "ping", description: "d", parameters: { type: "object", properties: {} } } }], { baseUrl: base });
  expect(seen.url).toBe("/v1/chat/completions");
  expect(seen.body?.model).toBe("qwen3-coder:30b");
  expect(Array.isArray(seen.body?.tools)).toBe(true);
  expect(r.choices[0]!.message.tool_calls?.[0]?.function.name).toBe("ping");
});
