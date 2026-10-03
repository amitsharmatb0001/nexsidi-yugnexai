import { afterEach, expect, test } from "bun:test";
import {
  buildDeliverySummary,
  designFindings,
  reviewDbUrlForBuild,
  INTERNAL_AGENT_NAMES,
  isQuotaExhaustionError,
  deployWithQuotaRetry,
  deployErrorsToFindings,
  normalizeForStuckComparison,
  runStage6,
  shouldSkipExpensiveReview,
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
  backendOutputDir: "E:/tmp/nexsidi-builds/test-proj/backend",
  frontendOutputDir: "E:/tmp/nexsidi-builds/test-proj/frontend",
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

// ── normalizeForStuckComparison (2026-08-18, live: gatherly1) ──────────────
// Real bug: stuck-detection compared RAW error/finding text, which routinely
// embeds a freshly-random UUID each attempt (a newly-created test row's real
// id). The signature never matched even when the underlying problem was
// structurally identical every time, so the pipeline kept treating a
// deterministic, unfixable-by-redeploy failure as "new progress" — burning
// through every retry layer (this file's own two loops, and the workflow's
// outer auto-retry, which reads this activity's own `stuck` flag) before
// finally, correctly escalating.

test("normalizeForStuckComparison replaces a UUID with a stable placeholder", () => {
  const text = "seller: create /api/v1/seller/store returned success but the row did not persist to the database (id=8866159a-4eed-4039-aaf0-64648c3b318c)";
  const normalized = normalizeForStuckComparison(text);
  expect(normalized).not.toContain("8866159a-4eed-4039-aaf0-64648c3b318c");
  expect(normalized).toContain("<id>");
});

test("normalizeForStuckComparison makes two findings that differ ONLY by UUID compare equal", () => {
  const first = "orders: create returned success but did not persist (id=8866159a-4eed-4039-aaf0-64648c3b318c)";
  const second = "orders: create returned success but did not persist (id=f9d7e378-9d35-4177-aa03-48c7d052601a)";
  expect(normalizeForStuckComparison(first)).toBe(normalizeForStuckComparison(second));
});

test("normalizeForStuckComparison leaves text with no UUID unchanged", () => {
  const text = "docker compose up failed: port 3200 already in use";
  expect(normalizeForStuckComparison(text)).toBe(text);
});

test("normalizeForStuckComparison strips multiple UUIDs in the same string", () => {
  const text = "conflict between id=8866159a-4eed-4039-aaf0-64648c3b318c and id=f9d7e378-9d35-4177-aa03-48c7d052601a";
  const normalized = normalizeForStuckComparison(text);
  expect(normalized).toBe("conflict between id=<id> and id=<id>");
});

test("runStage6's deploy-attempt loop detects a UUID-varying-but-structurally-identical error as stuck", async () => {
  let deployCalls = 0;
  const deps: Stage6Deps = {
    deployFn: async () => {
      deployCalls++;
      const id = deployCalls === 1 ? "8866159a-4eed-4039-aaf0-64648c3b318c" : "f9d7e378-9d35-4177-aa03-48c7d052601a";
      return {
        success: false,
        appUrl: "",
        backendUrl: "",
        githubRepo: null,
        errors: [`CRUD verification: seller: create returned success but did not persist (id=${id})`],
      };
    },
  };

  const result = await runStage6("test-proj", STAGE4_RESULT, deps);

  expect(deployCalls).toBe(2);
  expect(result.success).toBe(false);
  expect(result.stuck).toBe(true);
});

test("runStage6's live-retest fix loop detects UUID-varying-but-structurally-identical findings as stuck, not endless fix rounds", async () => {
  let retestCalls = 0;
  const fixCalls: number[] = [];
  const makeFinding = (id: string) => [{ file: "backend/src/controllers/seller.controller.ts", issue: `did not persist to the database (id=${id})` }];
  const deps: Stage6Deps = {
    deployFn: async () => ({ success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] }),
    liveRetestFn: async () => {
      retestCalls++;
      const id = retestCalls === 1 ? "8866159a-4eed-4039-aaf0-64648c3b318c" : "f9d7e378-9d35-4177-aa03-48c7d052601a";
      return { pass: false, findings: makeFinding(id) };
    },
    fixShubham: async () => { fixCalls.push(1); return { success: true }; },
  };
  const plan = { projectId: "test-proj" } as never;

  const result = await runStage6("test-proj", STAGE4_RESULT, deps, plan);

  // Exactly ONE fix round should run — the second retest's UUID-only-
  // different finding must be recognized as the same underlying problem and
  // stop the loop, not trigger a second (futile) fix-and-redeploy round.
  expect(fixCalls.length).toBe(1);
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

// ── shouldSkipExpensiveReview (2026-08-31) ──────────────────────────────────
// Real live evidence this reordering closes (project 05b590e98102): spec-
// compliance and stack-conformance are pure file/string comparisons — no
// browser, no LLM call — but used to run AFTER two full Tilotma browser
// passes (up to ~67 iterations each) and a live-eval pass had already
// completed. Moving them first means a failure here skips those expensive
// stages entirely instead of discovering the same failure after paying for
// them.
test("shouldSkipExpensiveReview is false when both compliance checks pass — the expensive stages run", () => {
  expect(shouldSkipExpensiveReview(true, true)).toBe(false);
});

test("shouldSkipExpensiveReview is true when spec-compliance alone fails", () => {
  expect(shouldSkipExpensiveReview(false, true)).toBe(true);
});

test("shouldSkipExpensiveReview is true when stack-conformance alone fails", () => {
  expect(shouldSkipExpensiveReview(true, false)).toBe(true);
});

test("shouldSkipExpensiveReview is true when both fail", () => {
  expect(shouldSkipExpensiveReview(false, false)).toBe(true);
});


// 2026-09-29: real bug (project a034f90ba50e). The live design review failed
// (5.95 against a 7.0 pass mark) but its critique was never added to the
// findings, so no fixer ever saw it — each fix round got the reality checker's
// notes instead and changed nothing. A failed design review is now a finding
// routed to the frontend, carrying the reviewer's own critique.
const FAILED_EVAL = {
  pass: false,
  score: 5.95,
  scores: { designQuality: 6, originality: 5, craft: 7, functionality: 7 },
  summary: [
    "Evidence collected:",
    "- Landing screenshot: landing.png",
    "",
    "Scores:",
    "DESIGN_QUALITY: 6",
    "ORIGINALITY: 5",
    "CRAFT: 7",
    "FUNCTIONALITY: 7",
    "REASONING: DESIGN_QUALITY: centered hero with three generic feature cards and no imagery. ORIGINALITY: unmodified template patterns.",
  ].join("\n"),
};

test("designFindings turns a failed live design review into one site-wide finding with the reviewer's critique", () => {
  const findings = designFindings(FAILED_EVAL);
  expect(findings).toHaveLength(1);
  expect(findings[0].file).toBe("");
  expect(findings[0].issue).toContain("5.95");
  expect(findings[0].issue).toContain("7");
  expect(findings[0].issue).toContain("design 6, originality 5, craft 7, functionality 7");
  expect(findings[0].issue).toContain("centered hero with three generic feature cards and no imagery");
  expect(findings[0].issue).not.toContain("Landing screenshot");
});

test("designFindings adds nothing for a passed design review", () => {
  expect(designFindings({ ...FAILED_EVAL, pass: true, score: 7.4 })).toEqual([]);
});

test("designFindings keeps the whole summary when the reviewer wrote no REASONING section", () => {
  const findings = designFindings({ ...FAILED_EVAL, scores: null, summary: "The layout is generic." });
  expect(findings[0].issue).toContain("The layout is generic.");
});

// 2026-09-29: real waste (project a034f90ba50e). Aanya's design fix rewrote
// app/page.tsx and both auth pages and passed next build, then spent its last
// steps clicking through the app and hit its 40-step cap without task_complete
// — success:false. "Every fix failed outright" then skipped the redeploy as if
// the code were unchanged; the workflow's auto-retry redeployed those same
// files a whole activity later. A failed fix that DID write files changed the
// code, so it is redeployed and retested.
test("runStage6 still redeploys when a fix reports success:false but wrote files", async () => {
  let deployCalls = 0;
  let retestCalls = 0;
  const deps: Stage6Deps = {
    deployFn: async () => {
      deployCalls++;
      return { success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] };
    },
    liveRetestFn: async () => {
      retestCalls++;
      return retestCalls === 1
        ? { pass: false, findings: [{ file: "", issue: "Live design review failed: 5.95/10" }] }
        : { pass: true, findings: [] };
    },
    fixAanya: async () => ({ success: false, filesWritten: ["app/page.tsx"] }),
  };
  const plan = { projectId: "test-proj" } as never;

  const result = await runStage6("test-proj", STAGE4_RESULT, deps, plan);

  expect(deployCalls).toBe(2);
  expect(retestCalls).toBe(2);
  expect(result.success).toBe(true);
});

// 2026-09-29 (project a034f90ba50e): the live review never got TIER3_DB_URL
// (db.ts says Stage 6 sets it; nothing did), so every review reported
// "db_query unavailable" and could not verify that data landed.
test("reviewDbUrlForBuild reads the build's compose file next to the frontend dir", () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const build = mkdtempSync(join(tmpdir(), "review-db-"));
  mkdirSync(join(build, "frontend"));
  writeFileSync(join(build, "docker-compose.yml"), 'services:\n  postgres:\n    image: postgres:16-alpine\n    ports:\n      - "127.0.0.1:5435:5432"\n  backend:\n    environment:\n      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/plantly\n');
  expect(reviewDbUrlForBuild(join(build, "frontend"))).toBe("postgresql://postgres:postgres@127.0.0.1:5435/plantly");
  expect(reviewDbUrlForBuild(join(tmpdir(), "no-such-build", "frontend"))).toBeNull();
});

test("the live retest hands the review TIER3_DB_URL and restores it afterwards", () => {
  const source = require("node:fs").readFileSync(new URL("./stage6-deployment.ts", import.meta.url), "utf-8");
  // the checks moved into liveRetestChecks (runRealLiveRetest wraps it to collect "not checked")
  const fn = source.slice(source.indexOf("async function liveRetestChecks"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  expect(body).toContain("process.env.TIER3_DB_URL = ");
  expect(body).toContain("delete process.env.TIER3_DB_URL");
});

// 2026-10-03 (Ledgerly benchmark run 4): the deploy's own checks found a real
// app bug — every invoice save returned 500 because the backend used
// ON CONFLICT on a unique constraint the migrations never created. Stage 6
// only re-ran the identical deploy, got the identical error, and stopped as
// stuck; no builder ever saw it. Real app errors found at deploy now go to
// the owning builder's fix run, and the deploy runs again after the fix.
const SERVER_ERROR = 'CRUD verification: invoices: POST /api/v1/invoices returned 500: {"success":false,"error":"Internal Server Error"}';

test("deployErrorsToFindings sends server errors to the backend builder and missing tables to the database builder", () => {
  const r = deployErrorsToFindings([
    SERVER_ERROR,
    "Live authenticated round-trip failed: create /api/v1/clients returned 503: down",
    "Backend log (errors): error: there is no unique or exclusion constraint matching the ON CONFLICT specification",
    "Deployed database has no tables (migrations did not apply) — app cannot persist data",
    "CRUD verification: invoices: POST /api/v1/invoices returned 400: {\"error\":\"items: Expected array\"}",
    "docker compose up failed: port conflict",
  ]);
  expect(r.shubham.length).toBe(3);
  expect(r.shubham[0]).toContain("returned 500");
  expect(r.shubham[0]).toContain("../db/migrations");
  expect(r.pranav.length).toBe(1);
  expect(r.aanya).toEqual([]);
});

test("a real app error at deploy goes to the backend builder, then the app is deployed again", async () => {
  let deployCalls = 0;
  const fixed: string[][] = [];
  const deps: Stage6Deps = {
    deployFn: async () => {
      deployCalls++;
      return deployCalls === 1
        ? { success: false, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [SERVER_ERROR] }
        : { success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] };
    },
    liveRetestFn: async () => ({ pass: true, findings: [] }),
    fixShubham: async (_plan, findings) => {
      fixed.push(findings);
      return { success: true, filesWritten: ["src/services/sequenceGenerator.ts"] };
    },
  };
  const result = await runStage6("test-proj", STAGE4_RESULT, deps, { projectId: "test-proj" } as never);
  expect(fixed.length).toBe(1);
  expect(fixed[0]![0]).toContain("POST /api/v1/invoices returned 500");
  expect(deployCalls).toBe(2);
  expect(result.success).toBe(true);
});

test("when the fix for a deploy error changes nothing, the deploy is not repeated", async () => {
  let deployCalls = 0;
  const deps: Stage6Deps = {
    deployFn: async () => {
      deployCalls++;
      return { success: false, appUrl: "", backendUrl: "", githubRepo: null, errors: [SERVER_ERROR] };
    },
    liveRetestFn: async () => ({ pass: true, findings: [] }),
    fixShubham: async () => ({ success: false }),
  };
  const result = await runStage6("test-proj", STAGE4_RESULT, deps, { projectId: "test-proj" } as never);
  expect(deployCalls).toBe(1);
  expect(result.success).toBe(false);
});

test("deploy errors that are not app bugs are still retried plainly, without a fix run", async () => {
  let deployCalls = 0;
  let fixCalled = false;
  const deps: Stage6Deps = {
    deployFn: async () => {
      deployCalls++;
      return { success: false, appUrl: "", backendUrl: "", githubRepo: null, errors: [`docker compose up failed: port conflict ${deployCalls}`] };
    },
    liveRetestFn: async () => ({ pass: true, findings: [] }),
    fixShubham: async () => { fixCalled = true; return { success: true, filesWritten: ["x"] }; },
  };
  await runStage6("test-proj", STAGE4_RESULT, deps, { projectId: "test-proj" } as never);
  expect(fixCalled).toBe(false);
  expect(deployCalls).toBe(2);
});

// 2026-10-03 (evidence-only plan, T5/T6) — Ledgerly run 4 replayed: the live
// spec check said the spec's colours were missing; the site showed them. The
// frontend builder checks, disputes it with what it saw, Tilotma checks it
// herself and rules it not true — the finding is dropped and the review
// passes, with no code changed to satisfy a false finding.
test("a live finding the builder disputes and Tilotma rules not true is dropped, and delivery passes", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { recordDispute } = await import("../../../packages/agent-runtime/src/tools/dispute.ts");
  const prev = process.env.BUILD_DIR;
  const dir = mkdtempSync(join(tmpdir(), "stage6-dispute-"));
  process.env.BUILD_DIR = dir;
  try {
    const colour = { file: "frontend/app/theme-overrides.css", issue: "[spec-compliance] Spec explicitly specifies color #059669 but it does not appear anywhere in the live site's rendered theme (found: none)" };
    let aanyaWrote = false;
    let settled = 0;
    const deps: Stage6Deps = {
      deployFn: async () => ({ success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] }),
      liveRetestFn: async () => ({ pass: false, findings: [colour], specCompliance: { pass: false, violations: [colour.issue] } }),
      fixAanya: async (_p, findings) => {
        recordDispute("test-proj", "aanya", { finding: findings[0]!, checked: "read app/layout.tsx; read --nx-color-primary on the live page", observed: "--nx-color-primary: #059669" });
        return { success: true, filesWritten: [] };
      },
      settleDisputes: async (_pid, disputes) => {
        settled += disputes.length;
        return disputes.map((d) => ({ dispute: d, verdict: "not_true" as const, evidence: "live page --nx-color-primary: #059669" }));
      },
    };
    const result = await runStage6("test-proj", STAGE4_RESULT, deps, { projectId: "test-proj" } as never);
    expect(settled).toBe(1);
    expect(aanyaWrote).toBe(false);
    expect(result.success).toBe(true);
  } finally {
    process.env.BUILD_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// 2026-10-03 (evidence-only plan, T3): a required check that could not run is
// "not checked" — the delivery is not verified, so it is never "delivered",
// and nothing is sent to a builder for it.
test("a delivery with a check that could not run is not verified, and nothing is routed to a builder", async () => {
  let fixCalled = false;
  const deps: Stage6Deps = {
    deployFn: async () => ({ success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] }),
    liveRetestFn: async () => ({ pass: true, findings: [], notChecked: ["spec check: could not read the live theme"] }),
    fixAanya: async () => { fixCalled = true; return { success: true }; },
    fixShubham: async () => { fixCalled = true; return { success: true }; },
  };
  const result = await runStage6("test-proj", STAGE4_RESULT, deps, { projectId: "test-proj" } as never);
  expect(fixCalled).toBe(false);
  expect(result.success).toBe(false);
  expect(result.stuck).toBeFalsy();
  expect(result.deliverySummary.status).toBe("not_verified");
  expect(result.deliverySummary.notChecked).toEqual(["spec check: could not read the live theme"]);
});

// 2026-10-04 (Ledgerly run 4, overnight): the fix loop saw the same finding
// twice and stopped as stuck, but Stage 6 returned stuck=false — the workflow
// read that as progress and re-ran the whole stage, again and again. A loop
// that is stuck, or a round where nothing could change, now says so.
test("a stuck live fix loop reports stuck, so the workflow asks a human instead of re-running the stage", async () => {
  const deps: Stage6Deps = {
    deployFn: async () => ({ success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] }),
    liveRetestFn: async () => ({ pass: false, findings: [{ file: "frontend/app", issue: "[auth-smoke] same finding every time" }] }),
    fixAanya: async () => ({ success: true, filesWritten: ["app/x.tsx"] }),
  };
  const result = await runStage6("test-proj", STAGE4_RESULT, deps, { projectId: "test-proj" } as never);
  expect(result.success).toBe(false);
  expect(result.stuck).toBe(true);
});

test("a live fix round that changed nothing reports stuck", async () => {
  const deps: Stage6Deps = {
    deployFn: async () => ({ success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] }),
    liveRetestFn: async () => ({ pass: false, findings: [{ file: "frontend/app", issue: "[auth-smoke] x" }] }),
    fixAanya: async () => ({ success: false }),
  };
  const result = await runStage6("test-proj", STAGE4_RESULT, deps, { projectId: "test-proj" } as never);
  expect(result.stuck).toBe(true);
});
