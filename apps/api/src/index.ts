import { app } from "./app.ts";
import { createBunWebSocket } from "hono/bun";

const { websocket } = createBunWebSocket();

const PORT = Number(process.env.PORT ?? 8080);

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
  idleTimeout: 0,  // SSE streams can be long-running (LLM responses take 30-60s)
};

console.log(`[api] listening on port ${PORT}`);
