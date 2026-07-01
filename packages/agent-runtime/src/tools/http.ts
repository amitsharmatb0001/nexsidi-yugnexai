import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

export async function execHttpRequest(args: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_ms?: number;
}): Promise<ToolResult> {
  // Only allow localhost URLs — agents must not reach external services
  const parsed = new URL(args.url);
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return {
      status: "error",
      summary: `http_request blocked: only localhost/127.0.0.1 allowed, got '${parsed.hostname}'`,
      next_actions: ["Use the local running service URL e.g. http://localhost:3001/health"],
    };
  }

  const method = (args.method ?? "GET").toUpperCase();
  const timeout = Math.min(args.timeout_ms ?? 10_000, 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(args.url, {
      method,
      headers: { "Content-Type": "application/json", ...(args.headers ?? {}) },
      body: args.body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text().catch(() => "(no body)");
    const body = text.slice(0, 2000);
    const success = res.status >= 200 && res.status < 500;

    return {
      status: success ? "success" : "error",
      summary: `${method} ${args.url} → ${res.status} ${res.statusText}`,
      output: body,
      next_actions: success
        ? []
        : res.status === 404
          ? ["Route not registered — check routes/index.ts mounts the router", "Verify the URL path matches the route definition"]
          : res.status === 401
            ? ["401 is expected on authenticated endpoints without a token — this is correct behavior"]
            : [`HTTP ${res.status} — read the response body for the error`],
    };
  } catch (err) {
    clearTimeout(timer);
    const isConnRefused = String(err).includes("ECONNREFUSED") || String(err).includes("fetch failed");
    return {
      status: "error",
      summary: `http_request failed: ${String(err)}`,
      next_actions: isConnRefused
        ? ["Server not running — start it first with run_command: 'node dist/index.js' or 'npx ts-node src/index.ts'"]
        : ["Check the URL is correct", "Verify the server started successfully"],
    };
  }
}

export const HTTP_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "http_request",
    description: "Make an HTTP request to a localhost service to verify it is running and returning correct responses. Only localhost URLs are allowed.",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method" },
        url: { type: "string", description: "Full URL, must be localhost e.g. http://localhost:3001/health" },
        headers: { type: "object", description: "Optional request headers" },
        body: { type: "string", description: "Optional JSON body string for POST/PUT/PATCH" },
        timeout_ms: { type: "number", description: "Request timeout in ms (default 10000)" },
      },
      required: ["method", "url"],
    },
  },
};
