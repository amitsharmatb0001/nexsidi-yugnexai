import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-09-29 (project a034f90ba50e): every redeploy resumed Riya's previous
// deploy conversation (47 → 61 → 75 → 89 messages over one build) — old port
// numbers, old container states and old errors for a different build, costing
// ~30k input tokens a call. Each deploy is a new job against the code on disk;
// the durable facts (ports, JWT secret) are in the task message, not history.
test("Riya's deploy agent starts fresh instead of resuming the previous deploy's conversation", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf-8").replace(/\r\n/g, "\n");
  const start = source.indexOf('runAgentEscalated({\n    agentName: "riya"');
  expect(start).toBeGreaterThan(-1);
  const call = source.slice(start);
  const config = call.slice(0, call.indexOf("});"));
  expect(config).toContain("freshStart: true");
});
