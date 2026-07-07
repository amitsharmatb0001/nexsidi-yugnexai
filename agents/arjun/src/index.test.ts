import { test, expect } from "bun:test";
import { run } from "./index.ts";
import type { ProjectSpec } from "../../saanvi/src/index.ts";

// Full-system audit A7: same fix as Saanvi (agents/saanvi/src/index.test.ts)
// — one empty/unparseable NIM response used to crash the whole pipeline.
// run() takes an injectable `chat` dependency so this is unit-testable
// without a live LLM call.

const MINIMAL_SPEC: ProjectSpec = {
  projectId: "proj123",
  name: "Test App",
  description: "d",
  appType: "web",
  features: [],
  auth: { provider: "clerk", features: ["sign-in", "sign-up"] },
  apiEndpoints: [],
  dbTables: [],
  successCriteria: [],
  lockedAt: new Date().toISOString(),
  specHash: "hash",
};

const VALID_PLAN_JSON = JSON.stringify({
  sharedTypes: "export interface X {}",
  apiContract: { endpoints: [] },
  dbSchema: { tables: [] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
});

test("a single empty response is retried once and succeeds on the second attempt", async () => {
  let callCount = 0;
  const stubChat = async () => {
    callCount++;
    return { content: callCount === 1 ? "" : VALID_PLAN_JSON, modelUsed: "mistralai/mistral-nemotron" as const };
  };

  const plan = await run(MINIMAL_SPEC, { chat: stubChat });

  expect(callCount).toBe(2);
  expect(plan.appName).toBe("Test App");
});

test("two consecutive empty responses still throw", async () => {
  const stubChat = async () => ({ content: "", modelUsed: "mistralai/mistral-nemotron" as const });

  await expect(run(MINIMAL_SPEC, { chat: stubChat })).rejects.toThrow();
});
