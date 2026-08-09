import { test, expect, mock } from "bun:test";
import { runAgent } from "../loop.ts";
import type { ModelId } from "@nexsidi/llm-client";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let callCount = 0;

// Mock the chat client
mock.module("@nexsidi/llm-client", () => {
  return {
    nimChatWithTools: async (model: string, messages: any[], tools: any[]) => {
      callCount++;
      if (callCount === 1) {
        return {
          id: "m1",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "mock_tool", arguments: "{}" } },
                  {
                    id: "c1.5",
                    type: "function",
                    function: { name: "read_file", arguments: JSON.stringify({ path: "evidence.txt" }) },
                  },
                ],
              },
            },
          ],
        };
      }
      return {
        id: "m2",
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "c2",
                  type: "function",
                  function: {
                    name: "task_complete",
                    arguments: JSON.stringify({
                      summary: "done",
                      files_written: ["evidence.txt"],
                      verification_passed: true,
                    }),
                  },
                },
              ],
            },
          },
        ],
      };
    },
  };
});

test("runAgent auto-discovers and executes MCP tools from mcp-config.json", async () => {
  const mockServerScript = `
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on("line", (line) => {
      const request = JSON.parse(line);
      if (request.method === "initialize") {
        console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05" } }));
      } else if (request.method === "tools/list") {
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [{ name: "mock_tool", description: "d", inputSchema: { type: "object", properties: {} } }] }
        }));
      } else if (request.method === "tools/call") {
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: "called" }] }
        }));
      }
    });
  `;
  const scriptPath = join(__dirname, "mock-integration-server.cjs");
  writeFileSync(scriptPath, mockServerScript, "utf-8");

  const configPath = join(process.cwd(), "mcp-config.json");
  const mcpConfig = {
    mcpServers: {
      "mock-server": {
        command: "node",
        args: [scriptPath],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), "utf-8");

  const testSandbox = join(tmpdir(), "mcp-sandbox-" + Date.now());
  mkdirSync(testSandbox, { recursive: true });
  writeFileSync(join(testSandbox, "evidence.txt"), "evidence data", "utf-8");

  try {
    const result = await runAgent({
      agentName: "shubham",
      // 2026-08-09: "google/" prefix required — sanitizeModelChain now gets
      // a fail-fast empty-chain guard (real bug found live: an unprefixed
      // model sanitized to empty and silently fell through to the
      // disallowed value anyway instead of failing). nimChatWithTools is
      // fully mocked above and ignores the model string entirely — this is
      // a placeholder, not a real model to add to ModelId.
      model: "google/mock-model" as ModelId,
      apiKey: "key",
      systemPrompt: "prompt",
      initialMessage: "start",
      sandboxDir: testSandbox,
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("done");
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {}
    try {
      unlinkSync(configPath);
    } catch {}
  }
});
