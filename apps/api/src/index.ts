import { app } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8080);

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`[api] listening on port ${PORT}`);
