import { afterEach, expect, test } from "bun:test";
import {
  buildDeliverySummary,
  INTERNAL_AGENT_NAMES,
  runStage6,
  type Stage6Deps,
} from "./stage6-deployment.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { DeployResult } from "../../../agents/riya/src/index.ts";

// Real docker deployment and a real live-LLM QA re-run aren't unit-testable —
// per this plan's stated testing philosophy, only the deterministic parts of
// Stage 6 are covered here: deployTarget flag plumbing, fail-fast on deploy
// failure, and the confidentiality-safe delivery summary shape. Riya and the
// live-retest step are replaced with injected stubs (Stage6Deps).

const STAGE4_RESULT: Stage4Result = {
  backendOutputDir: "C:/tmp/nexsidi-builds/test-proj/backend",
  frontendOutputDir: "C:/tmp/nexsidi-builds/test-proj/frontend",
  filesWritten: ["backend/src/index.ts", "frontend/app/page.tsx"],
};

afterEach(() => {
  delete process.env.NEXSIDI_DEPLOY_TARGET;
});

test("runStage6 passes resolveFlags().deployTarget through to the deploy function", async () => {
  process.env.NEXSIDI_DEPLOY_TARGET = "gcp";

  const seenTargets: Array<"local" | "gcp"> = [];
  const deps: Stage6Deps = {
    deployFn: async (_projectId, deployTarget) => {
      seenTargets.push(deployTarget);
      return { success: true, appUrl: "http://localhost:3200", githubRepo: null, errors: [] };
    },
    liveRetestFn: async () => ({ pass: true, findings: [] }),
  };

  await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(seenTargets).toEqual(["gcp"]);
});

test("runStage6 defaults to local deployTarget when no env override is set", async () => {
  delete process.env.NEXSIDI_DEPLOY_TARGET;

  const seenTargets: Array<"local" | "gcp"> = [];
  const deps: Stage6Deps = {
    deployFn: async (_projectId, deployTarget) => {
      seenTargets.push(deployTarget);
      return { success: true, appUrl: "http://localhost:3200", githubRepo: null, errors: [] };
    },
    liveRetestFn: async () => ({ pass: true, findings: [] }),
  };

  await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(seenTargets).toEqual(["local"]);
});

test("runStage6 fails fast and skips the live retest when deploy fails", async () => {
  let retestCalled = false;
  const deps: Stage6Deps = {
    deployFn: async () => ({
      success: false,
      appUrl: "http://localhost:3200",
      githubRepo: null,
      errors: ["docker compose up failed: port conflict"],
    }),
    liveRetestFn: async () => {
      retestCalled = true;
      return { pass: true, findings: [] };
    },
  };

  const result = await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(retestCalled).toBe(false);
  expect(result.success).toBe(false);
  expect(result.deliverySummary.status).toBe("failed");
});

test("runStage6 returns success + findings from the live retest when deploy succeeds", async () => {
  const deps: Stage6Deps = {
    deployFn: async () => ({
      success: true,
      appUrl: "http://localhost:3201",
      githubRepo: "https://github.com/nexsidi-builds/nexsidi-test-proj",
      errors: [],
    }),
    liveRetestFn: async () => ({ pass: true, findings: [{ note: "clean" }] }),
  };

  const result = await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(result.success).toBe(true);
  expect(result.appUrl).toBe("http://localhost:3201");
  expect(result.findings).toEqual([{ note: "clean" }]);
  expect(result.deliverySummary).toEqual({
    status: "delivered",
    appUrl: "http://localhost:3201",
    githubRepo: "https://github.com/nexsidi-builds/nexsidi-test-proj",
  });
});

test("runStage6 reports failed delivery when deploy succeeds but the live retest finds problems", async () => {
  const deps: Stage6Deps = {
    deployFn: async () => ({
      success: true,
      appUrl: "http://localhost:3202",
      githubRepo: null,
      errors: [],
    }),
    liveRetestFn: async () => ({ pass: false, findings: [{ issue: "CORS origin mismatch" }] }),
  };

  const result = await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(result.success).toBe(false);
  expect(result.deliverySummary.status).toBe("failed");
});

// ── Confidentiality: buildDeliverySummary must never leak internal agent names ──
test("buildDeliverySummary never contains any internal agent name", () => {
  const deployResult: DeployResult = {
    success: true,
    appUrl: "http://localhost:3200",
    githubRepo: "https://github.com/nexsidi-builds/nexsidi-test-proj",
    errors: [],
  };
  const summary = buildDeliverySummary(deployResult, { pass: true, findings: [] });
  const serialized = JSON.stringify(summary).toLowerCase();

  for (const name of INTERNAL_AGENT_NAMES) {
    expect(serialized).not.toContain(name);
  }
});

test("buildDeliverySummary reports delivered only when both deploy and retest pass", () => {
  const deployResult: DeployResult = {
    success: true,
    appUrl: "http://localhost:3200",
    githubRepo: null,
    errors: [],
  };
  expect(buildDeliverySummary(deployResult, { pass: true, findings: [] }).status).toBe("delivered");
  expect(buildDeliverySummary(deployResult, { pass: false, findings: [] }).status).toBe("failed");
});
