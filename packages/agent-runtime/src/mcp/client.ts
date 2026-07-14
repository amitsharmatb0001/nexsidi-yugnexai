import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPListToolsResult {
  tools: MCPTool[];
}

export interface MCPCallToolResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

export class MCPClient {
  private serverProcess: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();

  constructor(
    private serverCommand: string,
    private serverArgs: string[] = [],
    private env: Record<string, string> = {},
  ) {}

  async start(): Promise<void> {
    const useShell = process.platform === "win32" && (
      this.serverCommand.endsWith(".cmd") ||
      this.serverCommand.endsWith(".bat") ||
      ["npm", "npx", "bun", "tsc"].includes(this.serverCommand)
    );

    this.serverProcess = spawn(this.serverCommand, this.serverArgs, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...this.env },
      shell: useShell,
    });

    const rl = createInterface({
      input: this.serverProcess.stdout!,
      terminal: false,
    });

    rl.on("line", (line: string) => {
      try {
        const response = JSON.parse(line);
        if (response.id !== undefined) {
          const handler = this.pendingRequests.get(response.id);
          if (handler) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              handler.reject(new Error(response.error.message || JSON.stringify(response.error)));
            } else {
              handler.resolve(response.result);
            }
          }
        }
      } catch (err) {
        // Suppress parse warnings on non-JSON noise from stdio startup
      }
    });

    // Send the MCP initialization request
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nexsidi-v3-client", version: "3.0.0" },
    });

    // Notify initialized
    const notification = { jsonrpc: "2.0", method: "notifications/initialized" };
    this.serverProcess.stdin!.write(JSON.stringify(notification) + "\n");
  }

  async sendRequest<T>(method: string, params: Record<string, any> = {}): Promise<T> {
    if (!this.serverProcess) throw new Error("MCP Server not started");
    const id = this.requestId++;
    const request = { jsonrpc: "2.0", id, method, params };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.serverProcess!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  async listTools(): Promise<MCPListToolsResult> {
    return this.sendRequest<MCPListToolsResult>("tools/list");
  }

  async callTool(name: string, args: Record<string, any>): Promise<MCPCallToolResult> {
    return this.sendRequest<MCPCallToolResult>("tools/call", { name, arguments: args });
  }

  async stop(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }
}
