// Direct debug test of streamReply — run with: bun test-planner.mjs
import { readFileSync } from "fs";

// Load .env
const envFile = readFileSync(".env", "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

// Patch fetch to log NIM calls
const originalFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes("nvidia")) {
    console.log("[DEBUG] NIM fetch to:", url);
    console.log("[DEBUG] Request body preview:", String(opts?.body ?? "").slice(0, 300));
  }
  const res = await originalFetch(url, opts);
  if (String(url).includes("nvidia")) {
    console.log("[DEBUG] NIM response status:", res.status, "ok:", res.ok);
  }
  return res;
};

const { streamReply } = await import("./agents/planner/src/index.ts");

const state = {
  userId: "00000000-0000-0000-0000-000000000000",
  sessionId: "test-direct-" + Date.now(),
  messages: [
    {
      role: "user",
      content: "Build a website for NexTech IT services",
      ts: Date.now(),
    },
  ],
  phase: "planning",
  projectId: null,
  buildPlan: null,
  proposedPlan: null,
};

const apiKey = process.env.NIM_API_KEY || "";
console.log("[DEBUG] API key present:", !!apiKey, "length:", apiKey.length);
console.log("[DEBUG] Starting streamReply...");

let chunkCount = 0;
try {
  const gen = streamReply(state, apiKey);
  console.log("[DEBUG] Generator created");

  for await (const chunk of gen) {
    chunkCount++;
    console.log("[DEBUG] CHUNK", chunkCount, ":", JSON.stringify(chunk).slice(0, 300));
    if (chunkCount >= 5) {
      console.log("[DEBUG] Stopping after 5 chunks");
      break;
    }
  }
  console.log("[DEBUG] Generator exhausted naturally");
} catch (err) {
  console.error("[DEBUG] ERROR:", err);
}
console.log("[DEBUG] Done. Total chunks:", chunkCount);
