import { afterEach, expect, test } from "bun:test";
import {
  buildDeliverySummary,
  INTERNAL_AGENT_NAMES,
  isQuotaExhaustionError,
  deployWithQuotaRetry,
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

// ── Quota-exhaustion-aware redeploy retry (2026-08-05, live verify361300) ──
test("isQuotaExhaustionError recognizes the exact gemini-loop circuit-broken message", () => {
  expect(
    isQuotaExhaustionError([
      "Gemini call failed on iteration 6 — every model in the pool is circuit-broken, aborting early instead of grinding to MAX_ITERATIONS on a call that cannot succeed as-is: Error: [llm-client] routeToolsWithFallback(generation) — all pool models exhausted:\ngemini-3.6-flash: circuit breaker OPEN — skipped\ngemini-3.5-flash: 429 RESOURCE_EXHAUSTED",
    ]),
  ).toBe(true);
});

test("isQuotaExhaustionError returns false for a genuine app-level deploy error", () => {
  expect(isQuotaExhaustionError(["docker compose up failed: port 3200 already in use"])).toBe(false);
});

test("isQuotaExhaustionError returns false for an empty errors list", () => {
  expect(isQuotaExhaustionError([])).toBe(false);
});

test("deployWithQuotaRetry retries and waits when the failure is quota-shaped, then returns the eventual success", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await deployWithQuotaRetry(
    async () => {
      calls++;
      if (calls < 3) {
        return { success: false, appUrl: "", backendUrl: "", githubRepo: null, errors: ["all pool models exhausted"] };
      }
      return { success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] };
    },
    async (ms) => { waits.push(ms); },
  );

  expect(calls).toBe(3);
  expect(waits).toEqual([90_000, 90_000]);
  expect(result.success).toBe(true);
});

test("deployWithQuotaRetry does NOT retry a genuine app-level deploy failure", async () => {
  let calls = 0;
  const result = await deployWithQuotaRetry(
    async () => {
      calls++;
      return { success: false, appUrl: "", backendUrl: "", githubRepo: null, errors: ["migration failed: syntax error near DROP"] };
    },
    async () => {},
  );

  expect(calls).toBe(1);
  expect(result.success).toBe(false);
});

test("deployWithQuotaRetry gives up after MAX_QUOTA_RETRIES consecutive quota failures", async () => {
  let calls = 0;
  const result = await deployWithQuotaRetry(
    async () => {
      calls++;
      return { success: false, appUrl: "", backendUrl: "", githubRepo: null, errors: ["circuit-broken"] };
    },
    async () => {},
  );

  // 1 initial attempt + 2 retries = 3 total calls, then gives up.
  expect(calls).toBe(3);
  expect(result.success).toBe(false);
});

test("runStage6 retries a quota-exhausted redeploy instead of abandoning the live retest", async () => {
  let deployCalls = 0;
  let retestCalls = 0;
  const waits: number[] = [];
  const deps: Stage6Deps = {
    deployFn: async () => {
      deployCalls++;
      return { success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] };
    },
    liveRetestFn: async () => {
      retestCalls++;
      if (retestCalls === 1) {
        return { pass: false, findings: [{ file: "backend/src/auth.ts", issue: "missing JWT check" }] };
      }
      return { pass: true, findings: [] };
    },
    fixShubham: async () => ({ success: true }),
    sleepFn: async (ms) => { waits.push(ms); },
  };
  const plan = { projectId: "test-proj" } as never;

  // Simulate the redeploy call (the 2nd deployFn call overall) failing once
  // on quota exhaustion before succeeding, by wrapping deployFn with a
  // counter that fails only the 2nd invocation the first time it's hit.
  let redeployAttempts = 0;
  const originalDeployFn = deps.deployFn;
  deps.deployFn = async (pid, target, maxIterations) => {
    if (maxIterations !== undefined) {
      // This is the redeploy-after-fix call specifically.
      redeployAttempts++;
      if (redeployAttempts === 1) {
        return { success: false, appUrl: "", backendUrl: "", githubRepo: null, errors: ["all pool models exhausted"] };
      }
    }
    return originalDeployFn(pid, target, maxIterations);
  };

  const result = await runStage6("test-proj", STAGE4_RESULT, deps, plan);

  expect(waits).toEqual([90_000]);
  expect(retestCalls).toBe(2);
  expect(result.success).toBe(true);
});

test("runStage6 passes resolveFlags().deployTarget through to the deploy function", async () => {
  process.env.NEXSIDI_DEPLOY_TARGET = "gcp";

  const seenTargets: Array<"local" | "gcp"> = [];
  const deps: Stage6Deps = {
    deployFn: async (_projectId, deployTarget) => {
      seenTargets.push(deployTarget);
      return { success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] };
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
      return { success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] };
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
      backendUrl: "http://localhost:3300",
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
      backendUrl: "http://localhost:3301",
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

// 2026-07-11: real bug found live — Tier 3 only ever knew the frontend URL
// and misfired an API check against it, producing a false "no API route"
// finding on a split frontend/backend project. liveRetestFn now receives
// Riya's actual backendUrl so it can point Tier 3 at the correct origin.
test("runStage6 passes the deployed backendUrl through to liveRetestFn", async () => {
  let seenBackendUrl: string | undefined;
  const deps: Stage6Deps = {
    deployFn: async () => ({
      success: true,
      appUrl: "http://localhost:3200",
      backendUrl: "http://localhost:3300",
      githubRepo: null,
      errors: [],
    }),
    liveRetestFn: async (_pid, _appUrl, backendUrl) => {
      seenBackendUrl = backendUrl;
      return { pass: true, findings: [] };
    },
  };

  await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(seenBackendUrl).toBe("http://localhost:3300");
});

test("runStage6 reports failed delivery when deploy succeeds but the live retest finds problems", async () => {
  const deps: Stage6Deps = {
    deployFn: async () => ({
      success: true,
      appUrl: "http://localhost:3202",
      backendUrl: "http://localhost:3302",
      githubRepo: null,
      errors: [],
    }),
    liveRetestFn: async () => ({ pass: false, findings: [{ issue: "CORS origin mismatch" }] }),
  };

  const result = await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(result.success).toBe(false);
  expect(result.deliverySummary.status).toBe("failed");
});

// 2026-07-26 (autonomy/throughput pass): same root cause found live on
// nextech10, at this second boundary — `await Promise.all(fixPromises)`
// discarded fixShubham/fixAanya's own {success} result, so a fix agent
// that genuinely failed to complete (rather than completing but not fully
// resolving the issue) still triggered a full, expensive redeploy +
// live-retest cycle that could only reproduce the exact same findings.
test("runStage6 skips the wasted redeploy when the only implicated fix reports success:false", async () => {
  let deployCalls = 0;
  let retestCalls = 0;
  const deps: Stage6Deps = {
    deployFn: async () => {
      deployCalls++;
      return {
        success: true,
        appUrl: "http://localhost:3200",
        backendUrl: "http://localhost:3300",
        githubRepo: null,
        errors: [],
      };
    },
    liveRetestFn: async () => {
      retestCalls++;
      return { pass: false, findings: [{ file: "backend/src/auth.ts", issue: "missing JWT check" }] };
    },
    fixShubham: async () => ({ success: false }),
  };
  const plan = { projectId: "test-proj" } as never;

  const result = await runStage6("test-proj", STAGE4_RESULT, deps, plan);

  // 1 initial deploy + 1 initial retest — no redeploy/re-retest wasted on a
  // fix that is known to have failed outright.
  expect(deployCalls).toBe(1);
  expect(retestCalls).toBe(1);
  expect(result.success).toBe(false);
});

// 2026-07-28 (live, complex1): real bug found live — a live-retest finding
// on "backend/init.sql" (a generated project's actual schema-file location)
// used to be routed to shubham via a startsWith("backend/") check, even
// though shubham is instructed to never touch schema files. It recurred
// unfixed across every retest round until the fix-attempt budget ran out.
// splitLiveFindings now routes through the same agentForFile Stage 5 uses.
test("runStage6 routes a backend/init.sql schema finding to Pranav, not Shubham", async () => {
  let shubhamCalled = false;
  let pranavFindingsSeen: string[] = [];
  const deps: Stage6Deps = {
    deployFn: async () => ({
      success: true,
      appUrl: "http://localhost:3200",
      backendUrl: "http://localhost:3300",
      githubRepo: null,
      errors: [],
    }),
    liveRetestFn: async () => ({
      pass: false,
      findings: [{ file: "backend/init.sql", detail: "Missing database index on foreign key" }],
    }),
    fixShubham: async () => {
      shubhamCalled = true;
      return { success: true };
    },
    fixPranav: async (_plan, findings) => {
      pranavFindingsSeen = findings;
      return { success: true };
    },
  };
  const plan = { projectId: "test-proj" } as never;

  await runStage6("test-proj", STAGE4_RESULT, deps, plan);

  expect(shubhamCalled).toBe(false);
  expect(pranavFindingsSeen).toEqual(["backend/init.sql: Missing database index on foreign key"]);
});

// A fix agent may decide the real fix belongs in Pranav's domain
// (escalate_finding) instead of forcing a workaround — the escalation must
// be routed to Pranav in the SAME round, not dropped on the floor.
test("runStage6 routes a Shubham escalation targeting pranav to fixPranav in the same round", async () => {
  const pranavCalls: string[][] = [];
  const deps: Stage6Deps = {
    deployFn: async () => ({
      success: true,
      appUrl: "http://localhost:3200",
      backendUrl: "http://localhost:3300",
      githubRepo: null,
      errors: [],
    }),
    liveRetestFn: async () => ({
      pass: false,
      findings: [{ file: "backend/src/controllers/tasks.ts", issue: "N+1 query" }],
    }),
    fixShubham: async () => ({
      success: true,
      escalations: [{ targetAgent: "pranav", finding: "N+1 query", reason: "needs a composite index" }],
    }),
    fixPranav: async (_plan, findings) => {
      pranavCalls.push(findings);
      return { success: true };
    },
  };
  const plan = { projectId: "test-proj" } as never;

  await runStage6("test-proj", STAGE4_RESULT, deps, plan);

  expect(pranavCalls).toEqual([["N+1 query — needs a composite index"]]);
});

// ── Confidentiality: buildDeliverySummary must never leak internal agent names ──
test("buildDeliverySummary never contains any internal agent name", () => {
  const deployResult: DeployResult = {
    success: true,
    appUrl: "http://localhost:3200",
    backendUrl: "http://localhost:3300",
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
    backendUrl: "http://localhost:3300",
    githubRepo: null,
    errors: [],
  };
  expect(buildDeliverySummary(deployResult, { pass: true, findings: [] }).status).toBe("delivered");
  expect(buildDeliverySummary(deployResult, { pass: false, findings: [] }).status).toBe("failed");
});

// 2026-08-05: spec-compliance is an independent, mandatory gate — a site
// System B rates as well-designed can still fail it (wrong color, missing
// required form field), and delivery must not proceed in that case either.
test("buildDeliverySummary reports failed when specCompliance ran and failed, even if liveEval passed", () => {
  const deployResult: DeployResult = {
    success: true,
    appUrl: "http://localhost:3200",
    backendUrl: "http://localhost:3300",
    githubRepo: null,
    errors: [],
  };
  const summary = buildDeliverySummary(deployResult, {
    pass: true,
    findings: [],
    liveEval: { pass: true, scores: { designQuality: 9, originality: 9, craft: 9, functionality: 9 }, weighted: 9 } as never,
    specCompliance: { pass: false, violations: ["Spec explicitly specifies color #3B82F6 but it does not appear anywhere in the live site's rendered theme"] },
  });
  expect(summary.status).toBe("failed");
});

test("buildDeliverySummary treats an un-run specCompliance (undefined) as not blocking, same as liveEval", () => {
  const deployResult: DeployResult = {
    success: true,
    appUrl: "http://localhost:3200",
    backendUrl: "http://localhost:3300",
    githubRepo: null,
    errors: [],
  };
  const summary = buildDeliverySummary(deployResult, { pass: true, findings: [] });
  expect(summary.status).toBe("delivered");
});
