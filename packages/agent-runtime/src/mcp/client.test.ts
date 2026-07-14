import { test, expect } from "bun:test";
import { MCPClient } from "./client.ts";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

test("MCPClient stdio handshake and tool calling", async () => {
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
          result: { content: [{ type: "text", text: "called mock_tool" }] }
        }));
      }
    });
  `;
  const scriptPath = join(__dirname, "mock-server.cjs");
  writeFileSync(scriptPath, mockServerScript, "utf-8");

  try {
    const client = new MCPClient("node", [scriptPath]);
    await client.start();

    const toolsResult = await client.listTools();
    expect(toolsResult.tools).toHaveLength(1);
    expect(toolsResult.tools[0].name).toBe("mock_tool");

    const callResult = await client.callTool("mock_tool", {});
    expect(callResult.content).toHaveLength(1);
    expect(callResult.content[0].text).toBe("called mock_tool");

    await client.stop();
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {}
  }
});
