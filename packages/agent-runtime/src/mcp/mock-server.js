
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
  