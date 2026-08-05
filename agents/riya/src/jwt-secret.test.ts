import { test, expect } from "bun:test";
import { generateJwtSecret, buildAgentTask } from "./index.ts";

// 2026-07-26 (agent-autonomy-assessment follow-on, live proof): complex1's
// deployed stack ended up with THREE independently-decided JWT_SECRET
// values — Aanya's generation-time scaffold defaulted to
// "default_dev_secret", Riya's deploy-time frontend .env.local write
// defaulted to the SAME string independently, and the live Riya AGENT
// (an LLM writing docker-compose.yml) invented its own THIRD value,
// "dev_secret_key_greenway_estates_2025", for the backend container env —
// confirmed via `docker-compose.yml`. No single source of truth existed,
// so frontend and backend could end up trusting different secrets. Riya's
// deterministic orchestrator code must now generate ONE real secret and be
// the sole source every other write reads from.

test("generateJwtSecret produces a cryptographically random 64-char hex string, never a fixed value", () => {
  const a = generateJwtSecret();
  const b = generateJwtSecret();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b); // two calls must never collide/repeat a fallback constant
  expect(a).not.toContain("default");
  expect(a).not.toContain("dev_secret");
});

test("buildAgentTask instructs the LLM to use the EXACT generated secret, not invent its own", () => {
  const secret = "a".repeat(64);
  const task = buildAgentTask("proj1", "/tmp/proj1", 3200, 3300, 5435, secret);
  expect(task).toContain(`JWT_SECRET = ${secret}`);
  expect(task).not.toContain("default_dev_secret");
});
