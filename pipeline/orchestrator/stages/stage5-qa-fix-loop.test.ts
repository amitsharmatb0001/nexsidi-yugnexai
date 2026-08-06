import { expect, test } from "bun:test";
import { runQAFixLoopWithDeps, inferInstinctDomain, parseDebateDecision, type QAFixDeps } from "./stage5-qa-fix-loop.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { Stage5Result } from "./stage5-adversarial-qa.ts";

// A6 (full-system audit, Phase C): run.ts's own comment documented the gap
// this closes — "a fault-isolated re-fix-and-retest loop ... is NOT
// implemented here." This is the deterministic orchestration core (matches
// runStage5WithAgents's DI pattern): injected stub stage5/fix functions, no
// live LLM calls. The real entry point (runQAFixLoop) wires the actual
// runStage5 + Shubham/Aanya's runFix.

const STAGE4_RESULT: Stage4Result = {
  backendOutputDir: "E:/tmp/nexsidi-builds/test-proj/backend",
  frontendOutputDir: "E:/tmp/nexsidi-builds/test-proj/frontend",
  filesWritten: ["backend/src/index.ts", "frontend/app/page.tsx"],
};

// 2026-07-26 (agent-autonomy-assessment F2/F5): appName/description/
// apiContract/dbSchema below are now actually forwarded to every fix and
// QA call (buildSystemContext) — this fixture is no longer "unused beyond
// projectId", it exercises the real fan-out. See the "forwards plan" tests
// below.
const PLAN = {
  projectId: "test-proj",
  appName: "Test App",
  appDescription: "A test app.",
  designBrief: {},
  sharedTypes: "",
  apiContract: { baseUrl: "http://localhost:3001", endpoints: [] },
  dbSchema: { tables: [] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
  buildPlanHash: "deadbeef",
} as never;

function passResult(): Stage5Result {
  return { pass: true, findings: [] };
}

function prefixForAgent(agent: string): string {
  if (agent === "aanya") return "frontend";
  if (agent === "pranav") return "db";
  return "backend";
}

function failResult(findingCount: number, faultAgent: string): Stage5Result {
  const prefix = prefixForAgent(faultAgent);
  return {
    pass: false,
    faultAgent,
    findings: Array.from({ length: findingCount }, (_, i) => ({
      file: `${prefix}/file${i}.ts`,
      issue: `issue ${i}`,
    })),
  };
}

test("runQAFixLoopWithDeps forwards plan to runStage5 on both the initial and every retest call", async () => {
  const capturedPlans: unknown[] = [];
  const deps: QAFixDeps = {
    runStage5: async (_pid, _s4, plan) => {
      capturedPlans.push(plan);
      return capturedPlans.length === 1 ? failResult(1, "shubham") : passResult();
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
  };

  await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(capturedPlans.length).toBe(2); // initial QA run + one retest after the fix
  expect(capturedPlans[0]).toBe(PLAN);
  expect(capturedPlans[1]).toBe(PLAN);
});

test("passes on the first QA run -> no fix is ever called, iterations is 1", async () => {
  let fixCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => passResult(),
    fixShubham: async () => {
      fixCalled = true;
      return { success: true };
    },
    fixAanya: async () => {
      fixCalled = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(fixCalled).toBe(false);
  expect(result.pass).toBe(true);
  expect(result.iterations).toBe(1);
});

test("fails once, faultAgent is shubham -> fixShubham is called, then re-passes on retest", async () => {
  let qaCallCount = 0;
  const captured: { findings: string[] } = { findings: [] };
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(3, "shubham") : passResult();
    },
    fixShubham: async (_plan, findings) => {
      captured.findings = findings;
      return { success: true };
    },
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(qaCallCount).toBe(2);
  expect(captured.findings).toEqual(["backend/file0.ts: issue 0", "backend/file1.ts: issue 1", "backend/file2.ts: issue 2"]);
  expect(result.pass).toBe(true);
  expect(result.iterations).toBe(2);
});

test("fails with faultAgent aanya -> fixAanya is called, not fixShubham", async () => {
  let qaCallCount = 0;
  let shubhamCalled = false;
  let aanyaCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(1, "aanya") : passResult();
    },
    fixShubham: async () => {
      shubhamCalled = true;
      return { success: true };
    },
    fixAanya: async () => {
      aanyaCalled = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(aanyaCalled).toBe(true);
  expect(shubhamCalled).toBe(false);
  expect(result.pass).toBe(true);
});

test("faultAgent pranav has no auto-fix path yet -> loop stops immediately, marked stuck, does not call any fix function", async () => {
  let shubhamCalled = false;
  let aanyaCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => failResult(1, "pranav"),
    fixShubham: async () => {
      shubhamCalled = true;
      return { success: true };
    },
    fixAanya: async () => {
      aanyaCalled = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(shubhamCalled).toBe(false);
  expect(aanyaCalled).toBe(false);
  expect(result.pass).toBe(false);
  expect(result.stuck).toBe(true);
  expect(result.iterations).toBe(1);
});

// 2026-07-24 (P3.W3.4, full agentic upgrade): the test above documents the
// OLD behavior (no fixPranav dep provided — still correct, backward
// compatible). These document the NEW behavior once a caller wires
// fixPranav (as the real entry point runQAFixLoop now does).
test("faultAgent pranav WITH fixPranav wired -> fixPranav is called and the loop can converge", async () => {
  let qaCallCount = 0;
  let pranavCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(1, "pranav") : passResult();
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
    fixPranav: async () => {
      pranavCalled = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(pranavCalled).toBe(true);
  expect(result.pass).toBe(true);
  expect(result.stuck).toBe(false);
});

test("mixed shubham+pranav findings WITH fixPranav wired -> both fixers run in the same round", async () => {
  let qaCallCount = 0;
  const called: { shubham: boolean; pranav: boolean } = { shubham: false, pranav: false };
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/routes.ts", issue: "issue A" },
            { file: "db/schema.ts", issue: "issue B" },
          ],
        };
      }
      return passResult();
    },
    fixShubham: async () => {
      called.shubham = true;
      return { success: true };
    },
    fixAanya: async () => ({ success: true }),
    fixPranav: async () => {
      called.pranav = true;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(called.shubham).toBe(true);
  expect(called.pranav).toBe(true);
  expect(result.pass).toBe(true);
});

// 2026-07-26 (agent-autonomy-assessment F3): live proof this matters —
// Shubham fixed 3 DIFFERENT real sub-bugs across 6 rounds in the same
// function without ever closing the actual gap, because the real fix
// (a UNIQUE constraint) was in Pranav's schema, which Shubham cannot edit
// and previously had no structured way to hand off. escalate_finding +
// this routing closes that in the SAME round instead of costing another
// full QA cycle.
test("fixShubham escalating a finding to pranav dispatches fixPranav in the SAME round, even when pranav had no QA findings of its own", async () => {
  let qaCallCount = 0;
  const called: { shubham: boolean; pranav: boolean } = { shubham: false, pranav: false };
  let pranavReceivedFindings: string[] = [];
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(1, "shubham") : passResult();
    },
    fixShubham: async () => {
      called.shubham = true;
      return {
        success: true,
        escalations: [
          { targetAgent: "pranav", finding: "TOCTOU race on applications", reason: "needs UNIQUE(user_id, property_id)" },
        ],
      };
    },
    fixAanya: async () => ({ success: true }),
    fixPranav: async (_plan, findings) => {
      called.pranav = true;
      pranavReceivedFindings = findings;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(called.shubham).toBe(true);
  expect(called.pranav).toBe(true);
  expect(pranavReceivedFindings.some((f) => f.includes("UNIQUE(user_id, property_id)"))).toBe(true);
  expect(result.pass).toBe(true);
});

test("an escalation with no fixPranav wired does not crash the loop — it's just not actionable this round", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(1, "shubham") : passResult();
    },
    fixShubham: async () => ({ success: true, escalations: [{ targetAgent: "pranav", finding: "x", reason: "y" }] }),
    fixAanya: async () => ({ success: true }),
    // fixPranav intentionally omitted
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);
  expect(result.pass).toBe(true); // escalation simply had nowhere to go; the retest still ran and passed
});

test("faultAgent pranav WITH fixPranav wired, but findings never improve -> still detects stuck (fixPranav doesn't bypass stuck-detection)", async () => {
  const deps: QAFixDeps = {
    runStage5: async () => failResult(2, "pranav"),
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
    fixPranav: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(result.stuck).toBe(true);
  expect(result.pass).toBe(false);
});

test("finding count strictly decreasing across fix attempts keeps the loop going, up to the iteration cap", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      // 5 -> 3 -> 1 -> pass: genuine improvement every round, never stuck
      if (qaCallCount === 1) return failResult(5, "shubham");
      if (qaCallCount === 2) return failResult(3, "shubham");
      if (qaCallCount === 3) return failResult(1, "shubham");
      return passResult();
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(qaCallCount).toBe(4);
  expect(result.pass).toBe(true);
  expect(result.stuck).toBe(false);
});

test("2 consecutive fix attempts with no reduction in finding count -> stuck, loop stops without exhausting the max iteration cap", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      // 4 -> 4 -> 4: never improves, should stop after the 2nd no-improvement in a row
      return failResult(4, "shubham");
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(result.pass).toBe(false);
  expect(result.stuck).toBe(true);
  expect(qaCallCount).toBeLessThan(10); // stopped well before any runaway loop
});

test("never exceeds the max fix-iteration cap even if findings keep barely improving each round", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      // Improves by exactly 1 every round forever — would loop indefinitely
      // without a hard cap.
      return failResult(Math.max(1, 20 - qaCallCount), "shubham");
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(result.pass).toBe(false);
  expect(qaCallCount).toBe(6); // exactly 1 initial + MAX_FIX_ITERATIONS(5) retests, never more
});

// Real 2026-07-06 stress-test bug: a live run had findings spanning BOTH
// backend/ and frontend/ files in the same QA pass. The old implementation
// used Stage5Result.faultAgent (identifyFaultAgent's single first-match
// result) to pick ONE agent per round — since the first finding was a
// backend/ file, it fixed Shubham every round and never touched Aanya's
// frontend finding, no matter how many retries ran. The loop must route each
// agent its OWN subset of findings in the same round.
test("findings spanning both backend and frontend in the same round -> BOTH fixShubham and fixAanya are called with their own subset", async () => {
  let qaCallCount = 0;
  let capturedShubham: string[] = [];
  let capturedAanya: string[] = [];
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "missing CSRF protection" },
            { file: "frontend/components/TaskForm.tsx", issue: "missing input sanitization" },
          ],
        };
      }
      return passResult();
    },
    fixShubham: async (_plan, findings) => {
      capturedShubham = findings;
      return { success: true };
    },
    fixAanya: async (_plan, findings) => {
      capturedAanya = findings;
      return { success: true };
    },
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(capturedShubham).toEqual(["backend/src/index.ts: missing CSRF protection"]);
  expect(capturedAanya).toEqual(["frontend/components/TaskForm.tsx: missing input sanitization"]);
  expect(result.pass).toBe(true);
});

test("mixed shubham+pranav findings -> fixShubham runs for its own subset; the loop doesn't stop immediately just because pranav has no fixer", async () => {
  let qaCallCount = 0;
  let shubhamCalled = false;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "missing CSRF protection" },
            { file: "db/migrations/0001.sql", issue: "missing index" },
          ],
        };
      }
      // Shubham's part got fixed; only the unfixable pranav finding remains.
      return { pass: false, findings: [{ file: "db/migrations/0001.sql", issue: "missing index" }] };
    },
    fixShubham: async () => {
      shubhamCalled = true;
      return { success: true };
    },
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(shubhamCalled).toBe(true);
  // Second round: only the pranav finding remains, no fixable agent left -> stop, stuck.
  expect(result.pass).toBe(false);
  expect(result.stuck).toBe(true);
  expect(qaCallCount).toBe(2);
});

// 2026-07-08: Patent Claim 2's instinct memory had a real DB table but
// nothing ever wrote to it. recordInstincts is called BEFORE the fix (so a
// mistake is recorded even if the fix itself doesn't fully resolve it), for
// every agent that has findings this round.
test("recordInstincts is called with each fixable agent's findings, before that agent's fix runs", async () => {
  let qaCallCount = 0;
  const recorded: Array<{ agentName: string; findings: string[] }> = [];
  const callOrder: string[] = [];
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "missing CSRF protection" },
            { file: "frontend/components/TaskForm.tsx", issue: "missing input sanitization" },
          ],
        };
      }
      return passResult();
    },
    fixShubham: async () => {
      callOrder.push("fixShubham");
      return { success: true };
    },
    fixAanya: async () => {
      callOrder.push("fixAanya");
      return { success: true };
    },
    recordInstincts: async (agentName, findings) => {
      callOrder.push(`recordInstincts:${agentName}`);
      recorded.push({ agentName, findings });
    },
  };

  await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(recorded).toEqual(
    expect.arrayContaining([
      { agentName: "shubham", findings: ["backend/src/index.ts: missing CSRF protection"] },
      { agentName: "aanya", findings: ["frontend/components/TaskForm.tsx: missing input sanitization"] },
    ]),
  );
  // 2026-07-26 (autonomy/throughput pass): shubham's and aanya's fix rounds
  // now run concurrently (see "fixShubham and fixAanya run concurrently"
  // below) — real wall-clock savings when both backend and frontend need
  // fixing, the common case observed live on nextech10. This test no
  // longer asserts a single global order across agents (that would just be
  // reasserting sequential execution); it asserts the property that
  // actually matters: EACH agent's own recordInstincts still happens
  // before that SAME agent's fix call.
  const shubhamRecordIdx = callOrder.indexOf("recordInstincts:shubham");
  const shubhamFixIdx = callOrder.indexOf("fixShubham");
  const aanyaRecordIdx = callOrder.indexOf("recordInstincts:aanya");
  const aanyaFixIdx = callOrder.indexOf("fixAanya");
  expect(shubhamRecordIdx).toBeGreaterThanOrEqual(0);
  expect(shubhamRecordIdx).toBeLessThan(shubhamFixIdx);
  expect(aanyaRecordIdx).toBeGreaterThanOrEqual(0);
  expect(aanyaRecordIdx).toBeLessThan(aanyaFixIdx);
});

// 2026-07-26 (autonomy pass): real root cause found live on nextech10 — the
// loop discarded fixShubham/fixAanya/fixPranav's own `{success}` result
// entirely. When a fix agent genuinely fails to complete (exhausts its own
// iteration budget, an unrecoverable model error) rather than completing
// but not fully resolving the issue, the code is UNCHANGED — the next QA
// pass finds the exact same findings, and it takes a full STUCK_THRESHOLD
// worth of wasted QA re-scans (each one 3 full agent passes + peer debate)
// before the loop gives up, with no way to tell "the fix never even ran"
// from "the fix ran but the issue is genuinely hard." nextech10's two
// findings still open after 4 "autonomous" rounds were exactly this.
test("when EVERY implicated fix call reports success:false, the loop stops immediately without wasting a QA rescan", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return failResult(1, "shubham");
    },
    fixShubham: async () => ({ success: false }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  expect(result.stuck).toBe(true);
  expect(result.pass).toBe(false);
  // Only the initial QA pass ran — no wasted rescan once every implicated
  // fix this round is known to have failed outright.
  expect(qaCallCount).toBe(1);
});

test("when only SOME implicated fix calls fail, the loop still re-runs QA — the other agent's fix may have genuinely helped", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "backend issue" },
            { file: "frontend/app/page.tsx", issue: "frontend issue" },
          ],
        };
      }
      // aanya's fix worked; shubham's failed outright, so its finding remains.
      return { pass: false, findings: [{ file: "backend/src/index.ts", issue: "backend issue" }] };
    },
    fixShubham: async () => ({ success: false }),
    fixAanya: async () => ({ success: true }),
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  // A rescan DID happen (mixed outcome, not an immediate all-failed stop).
  expect(qaCallCount).toBe(2);
  expect(result.pass).toBe(false);
});

test("fixShubham and fixAanya run concurrently, not sequentially", async () => {
  let shubhamStarted = false;
  let aanyaStarted = false;
  let shubhamSawAanyaStarted = false;
  let aanyaSawShubhamStarted = false;
  let qaCallCount = 0;

  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      if (qaCallCount === 1) {
        return {
          pass: false,
          findings: [
            { file: "backend/src/index.ts", issue: "x" },
            { file: "frontend/app/page.tsx", issue: "y" },
          ],
        };
      }
      return passResult();
    },
    fixShubham: async () => {
      shubhamStarted = true;
      await new Promise((r) => setTimeout(r, 15));
      shubhamSawAanyaStarted = aanyaStarted;
      return { success: true };
    },
    fixAanya: async () => {
      aanyaStarted = true;
      await new Promise((r) => setTimeout(r, 15));
      aanyaSawShubhamStarted = shubhamStarted;
      return { success: true };
    },
  };

  await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);

  // If sequential, aanya would only start after shubham's fix (and its
  // setTimeout) fully resolved — shubhamSawAanyaStarted would be false.
  // If concurrent, both start before either's delay resolves.
  expect(shubhamSawAanyaStarted).toBe(true);
  expect(aanyaSawShubhamStarted).toBe(true);
});

// 2026-07-12: real bug found live — every instinct ever recorded (105 rows,
// direct DB query) was stored under domain="security" regardless of which QA
// agent actually found it, because the real recordInstincts closure in
// runQAFixLoop hardcoded the literal "security" instead of reading the
// `[logic/...]`/`[security/...]`/`[performance/...]` prefix that
// stage5-adversarial-qa.ts's karanFindingToFinding/navyaFindingToFinding/
// deepikaFindingToFinding already attach to every finding's `issue` string.
// This silently broke queryRecentInstincts("security")'s usefulness — a
// Navya (logic) or Deepika (performance) mistake could never surface back
// into loadKnownMistakesPrefix() because it was never distinguishable from a
// real security finding once written.
test("inferInstinctDomain reads the [logic/...]/[security/...]/[performance/...] prefix stage5-adversarial-qa.ts attaches to every finding", () => {
  expect(inferInstinctDomain("[security/CRITICAL] csrf: no CSRF token on state-changing POST")).toBe("security");
  expect(inferInstinctDomain("[logic/HIGH] null-ref: unchecked req.body.title")).toBe("architecture");
  expect(inferInstinctDomain("[performance/MEDIUM] n+1: extra query on empty page")).toBe("performance");
});

test("inferInstinctDomain falls back to security for an unprefixed/unrecognized finding string", () => {
  expect(inferInstinctDomain("some finding with no recognizable prefix")).toBe("security");
});

test("omitting recordInstincts entirely does not throw — existing callers without memory keep working", async () => {
  let qaCallCount = 0;
  const deps: QAFixDeps = {
    runStage5: async () => {
      qaCallCount++;
      return qaCallCount === 1 ? failResult(1, "shubham") : passResult();
    },
    fixShubham: async () => ({ success: true }),
    fixAanya: async () => ({ success: true }),
    // no recordInstincts
  };

  const result = await runQAFixLoopWithDeps("test-proj", PLAN, STAGE4_RESULT, deps);
  expect(result.pass).toBe(true);
});

// ── parseDebateDecision (pure) ───────────────────────────────────────────────
// 2026-08-04 (live, final838491): real bug found live — Navya precisely
// identified backend/src/routes/index.ts mounting the inquiry router at
// "/inquiry" instead of "/inquiries" (matching neither the contract nor the
// frontend's own fetch calls) — a HIGH severity, fully-evidenced, verifiably
// TRUE finding (confirmed live: it caused an actual 404 on every inquiry
// submission). Peer-debate dismissed it as a false positive and it shipped
// unfixed. Tracing the actual decision-parsing logic surfaced a second, real,
// independent bug in the SAME function: `decisionLine.endsWith("VALID")` was
// meant to reject "DECISION: INVALID" (the comment says so explicitly) but
// "INVALID" itself ends with the substring "VALID" (I-N-VALID), so a model
// responding INVALID would be WRONGLY parsed as isValid=true — the exact
// inverse of the stated intent. Extracted into a pure function so this
// class of parsing bug is caught by a fast unit test, not only discoverable
// by manually walking a live deployed app.
test("parseDebateDecision treats DECISION: VALID as valid", () => {
  expect(parseDebateDecision("Reasoning: looks fine\nDECISION: VALID")).toBe(true);
});

test("parseDebateDecision treats DECISION: FALSE_POSITIVE as not valid", () => {
  expect(parseDebateDecision("Reasoning: just a style nit\nDECISION: FALSE_POSITIVE")).toBe(false);
});

// The exact bug: "INVALID" ends with the substring "VALID" — a naive
// .endsWith("VALID") check treats it as approved, which is backwards.
test("parseDebateDecision treats DECISION: INVALID as NOT valid (not a VALID-suffix match)", () => {
  expect(parseDebateDecision("Reasoning: this claim is incorrect\nDECISION: INVALID")).toBe(false);
});

test("parseDebateDecision defaults to valid (safe direction) when no DECISION line is present", () => {
  expect(parseDebateDecision("The model just rambled with no clear verdict.")).toBe(true);
});
