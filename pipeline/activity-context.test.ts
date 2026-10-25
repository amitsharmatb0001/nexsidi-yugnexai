import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { withActivityContext, AGENT_OF_ACTIVITY } from "./activity-context.ts";
import { currentCallContext } from "../packages/llm-client/src/call-ledger.ts";

// 2026-10-25 (Amit: cost and time of each agent, each round): calls made outside an agent loop (the plan, the research, the Chief AI
// check, the design brief) had no project or agent on them. Every activity now runs inside its project's context, and the planning
// activities say which agent they are, so each call in the ledger belongs to someone.

test("every activity runs inside its project's context, and a planning activity names its agent", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const activities = withActivityContext({
    runArjun: async (projectId: string) => { seen.push({ ...currentCallContext() }); return projectId; },
    runQAFixLoopActivity: async (projectId: string) => { seen.push({ ...currentCallContext() }); return projectId; },
    escalateTilotma: async (projectId: string, reason: string) => { seen.push({ ...currentCallContext() }); return reason; },
    noArgs: async () => { seen.push({ ...currentCallContext() }); return 1; },
  });
  expect(await activities.runArjun("p1")).toBe("p1");
  await activities.runQAFixLoopActivity("p2");
  await activities.escalateTilotma("p3", "why");
  await activities.noArgs();
  expect(seen[0]).toMatchObject({ projectId: "p1", agent: "arjun" });
  expect(seen[1]).toMatchObject({ projectId: "p2" });
  expect(seen[1]!.agent).toBeUndefined(); // the loops name their own agents
  expect(seen[2]).toMatchObject({ projectId: "p3" });
  expect(seen[3]!.projectId).toBeUndefined();
  expect(AGENT_OF_ACTIVITY.runSaanvi).toBe("saanvi");
  expect(AGENT_OF_ACTIVITY.runPranav).toBe("pranav");
});

test("errors and results pass through unchanged", async () => {
  const a = withActivityContext({ boom: async (_p: string) => { throw new Error("x"); }, ok: async (_p: string) => ({ n: 1 }) });
  await expect(a.boom("p")).rejects.toThrow("x");
  expect(await a.ok("p")).toEqual({ n: 1 });
});

test("the worker registers the wrapped activities, and the Chief AI check names itself", () => {
  const worker = readFileSync(new URL("./worker.ts", import.meta.url), "utf-8");
  expect(worker).toContain("withActivityContext(activities)");
  const chief = readFileSync(new URL("./orchestrator/chief-check.ts", import.meta.url), "utf-8");
  expect(chief).toContain('agent: "chief-ai"');
});
