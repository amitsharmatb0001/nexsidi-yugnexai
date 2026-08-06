import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runStage5WithAgents,
  collectCode,
  locationPrefix,
  karanFindingToFinding,
  navyaFindingToFinding,
  deepikaFindingToFinding,
  qaDispatchStaggerMs,
  type Stage5Agents,
} from "./stage5-adversarial-qa.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { QAResult as KaranResult } from "../../../agents/qa/karan/src/index.ts";
import type { QAResult as NavyaResult } from "../../../agents/qa/navya/src/index.ts";
import type { QAResult as DeepikaResult } from "../../../agents/qa/deepika/src/index.ts";
import type { Tier3ReviewResult } from "../../../agents/tilotma/src/tier3-review.ts";
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";

const source = readFileSync(new URL("./stage5-adversarial-qa.ts", import.meta.url), "utf-8");

// 2026-08-06: real bug found live (project bae438767bed) — runStage5's real
// labeledDirs() only ever passed "backend" and "frontend" to Navya/Karan/
// Deepika, never "db" — so a "missing index" finding could NEVER be
// verified against Pranav's actual migrations, only guessed at from the
// controller's query pattern. Deepika kept re-flagging the identical
// finding as unresolved after Pranav had already fixed it 8 separate times,
// because she structurally could not see the file where the fix lived.
// identifyFaultAgent (stage4-multi-agent-dev.ts) already had
// file.startsWith("db/") -> "pranav" routing — a half-wired feature whose
// only source never actually produced a db/-prefixed finding. Source-string
// check (mirrors the established pattern for this file's real wiring, which
// dynamically imports live agents and isn't unit-testable directly).
test("runStage5's real labeledDirs includes a 'db' label pointing at Pranav's real output directory", () => {
  expect(source).toContain('{ label: "db", path: getPranavOutputDir(projectId) }');
  expect(source).toContain('import { getOutputDir as getPranavOutputDir }');
});

// Real Navya/Karan/Deepika run() calls and Tilotma's Tier 3 review hit live
// LLMs and aren't unit-testable — per this plan's stated testing philosophy,
// only the deterministic scoring/routing logic in runStage5WithAgents is
// covered here, via injected stub agent results (Stage5Agents).

const STAGE4_RESULT: Stage4Result = {
  backendOutputDir: "E:/tmp/nexsidi-builds/test-proj/backend",
  frontendOutputDir: "E:/tmp/nexsidi-builds/test-proj/frontend",
  filesWritten: ["backend/src/index.ts", "frontend/app/page.tsx"],
};

const CLEAN_NAVYA: NavyaResult = { agent: "navya", score: 100, passed: true, findings: [] };
const CLEAN_KARAN: KaranResult = { agent: "karan", score: 100, passed: true, findings: [] };
const CLEAN_DEEPIKA: DeepikaResult = { agent: "deepika", score: 100, passed: true, findings: [] };

function makeAgents(overrides: Partial<Stage5Agents> = {}): Stage5Agents {
  return {
    runNavya: async () => CLEAN_NAVYA,
    runKaran: async () => CLEAN_KARAN,
    runDeepika: async () => CLEAN_DEEPIKA,
    runTier3Review: async (): Promise<Tier3ReviewResult> => ({ pass: true, findings: [] }),
    ...overrides,
  };
}

// ── 0. Dispatch staggering (avoids bursting the shared Gemini token bucket) ──
test("qaDispatchStaggerMs defaults to 4000ms when unset", () => {
  delete process.env.QA_DISPATCH_STAGGER_MS;
  expect(qaDispatchStaggerMs()).toBe(4000);
});

test("qaDispatchStaggerMs honors a QA_DISPATCH_STAGGER_MS override, including 0", () => {
  process.env.QA_DISPATCH_STAGGER_MS = "1500";
  expect(qaDispatchStaggerMs()).toBe(1500);
  process.env.QA_DISPATCH_STAGGER_MS = "0";
  expect(qaDispatchStaggerMs()).toBe(0);
  delete process.env.QA_DISPATCH_STAGGER_MS;
});

test("runStage5WithAgents staggers Navya/Karan/Deepika dispatch by staggerMs instead of firing them in the same instant", async () => {
  const startedAt: Record<string, number> = {};
  const agents = makeAgents({
    runNavya: async () => { startedAt.navya = Date.now(); return CLEAN_NAVYA; },
    runKaran: async () => { startedAt.karan = Date.now(); return CLEAN_KARAN; },
    runDeepika: async () => { startedAt.deepika = Date.now(); return CLEAN_DEEPIKA; },
  });

  await runStage5WithAgents("test-proj", STAGE4_RESULT, agents, undefined, undefined, 30);

  expect(startedAt.karan! - startedAt.navya!).toBeGreaterThanOrEqual(25);
  expect(startedAt.deepika! - startedAt.karan!).toBeGreaterThanOrEqual(25);
});

test("runStage5WithAgents dispatches all three immediately when staggerMs is omitted (default 0)", async () => {
  const startedAt: Record<string, number> = {};
  const agents = makeAgents({
    runNavya: async () => { startedAt.navya = Date.now(); return CLEAN_NAVYA; },
    runKaran: async () => { startedAt.karan = Date.now(); return CLEAN_KARAN; },
    runDeepika: async () => { startedAt.deepika = Date.now(); return CLEAN_DEEPIKA; },
  });

  await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(startedAt.karan! - startedAt.navya!).toBeLessThan(20);
  expect(startedAt.deepika! - startedAt.karan!).toBeLessThan(20);
});

// ── 1. All three pass -> Tier 3 gets called ─────────────────────────────────
test("runStage5WithAgents calls Tier 3 review only when Navya, Karan, and Deepika all pass", async () => {
  let tier3Called = false;
  const agents = makeAgents({
    runTier3Review: async (): Promise<Tier3ReviewResult> => {
      tier3Called = true;
      return { pass: true, findings: [] };
    },
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(tier3Called).toBe(true);
  expect(result.pass).toBe(true);
  expect(result.findings).toEqual([]);
});

// 2026-07-26 (agent-autonomy-assessment F5): plan (spec/API contract/DB
// schema) now flows into every QA agent as systemContext — see
// qa-loop.test.ts for the live evidence QA needed this to stop re-flagging
// the same false positives every round and to be able to check findings
// against actual intent.
const TEST_PLAN: BuildPlan = {
  projectId: "test-proj",
  appName: "Greenway Estates Portal",
  appDescription: "A property management platform.",
  designBrief: {} as any,
  sharedTypes: "",
  apiContract: { baseUrl: "http://localhost:3001", endpoints: [] },
  dbSchema: { tables: [] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
  buildPlanHash: "deadbeef",
};

test("runStage5WithAgents forwards a rendered systemContext from plan to every QA agent", async () => {
  const captured: Record<string, string | undefined> = {};
  const agents = makeAgents({
    runNavya: async (_pid, _s4, ctx) => { captured.navya = ctx; return CLEAN_NAVYA; },
    runKaran: async (_pid, _s4, ctx) => { captured.karan = ctx; return CLEAN_KARAN; },
    runDeepika: async (_pid, _s4, ctx) => { captured.deepika = ctx; return CLEAN_DEEPIKA; },
  });

  await runStage5WithAgents("test-proj", STAGE4_RESULT, agents, false, TEST_PLAN);

  expect(captured.navya).toContain("Greenway Estates Portal");
  expect(captured.karan).toContain("Greenway Estates Portal");
  expect(captured.deepika).toContain("Greenway Estates Portal");
});

test("runStage5WithAgents works with no plan (systemContext undefined) — backward compatible", async () => {
  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, makeAgents(), false);
  expect(result.pass).toBe(true);
});

// 2026-07-11: real bug found live — traced the full call graph and confirmed
// Stage 5's Tier 3 review (Tilotma screenshotting the live app) was being run
// as the PRE-DEPLOYMENT gate (stage5-qa-fix-loop.ts -> runStage5, called
// before Riya/Stage 6 ever deploys anything). Tier 3 needs a live, reachable
// app — nothing deploys one until Stage 6, which never runs because Stage 5
// can't pass without Tier 3 passing first. A structural deadlock: Stage 5
// could NEVER pass, no matter how many QA-fix-loop rounds ran. Stage 6's
// runRealLiveRetest already correctly re-runs Stage 5 AFTER a real deploy —
// that's the one place Tier 3 belongs. includeTier3=false makes Tier 3
// skippable so the pre-deployment gate only checks Navya/Karan/Deepika.
test("runStage5WithAgents skips Tier 3 review entirely when includeTier3 is false", async () => {
  let tier3Called = false;
  const agents = makeAgents({
    runTier3Review: async (): Promise<Tier3ReviewResult> => {
      tier3Called = true;
      return { pass: true, findings: [] };
    },
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents, false);

  expect(tier3Called).toBe(false);
  expect(result.pass).toBe(true);
  expect(result.findings).toEqual([]);
});

test("runStage5WithAgents still fails on static QA even with includeTier3 false", async () => {
  const agents = makeAgents({
    runKaran: async () => ({
      agent: "karan",
      score: 0,
      passed: false,
      findings: [{ severity: "CRITICAL" as const, description: "SQL injection in tasks controller" }],
    }),
  });
  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents, false);
  expect(result.pass).toBe(false);
});

test("runStage5WithAgents defaults to including Tier 3 when the parameter is omitted (backward compatible)", async () => {
  let tier3Called = false;
  const agents = makeAgents({
    runTier3Review: async (): Promise<Tier3ReviewResult> => {
      tier3Called = true;
      return { pass: true, findings: [] };
    },
  });
  await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);
  expect(tier3Called).toBe(true);
});

test("runStage5WithAgents surfaces Tier 3's own findings and pass/fail verdict", async () => {
  const agents = makeAgents({
    runTier3Review: async (): Promise<Tier3ReviewResult> => ({
      pass: false,
      findings: ["landing page uses unmodified shadcn defaults with a purple gradient over a white card"],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.pass).toBe(false);
  expect(result.findings).toEqual([
    { file: "", issue: "landing page uses unmodified shadcn defaults with a purple gradient over a white card" },
  ]);
});

// ── 2. Karan below 85 -> fails regardless of Navya/Deepika scores ──────────
// 2026-07-09: was "any finding blocks" (zero-tolerance) — that was an
// implementation deviation from CLAUDE.md System A's severity-weighted ≥85,
// which explicitly includes Karan. A CRITICAL (100−20=80) still fails on
// its own; a lone LOW (99) no longer vetoes the run.
test("runStage5WithAgents fails when Karan scores below 85, even with perfect Navya/Deepika scores", async () => {
  let tier3Called = false;
  const agents = makeAgents({
    runKaran: async (): Promise<KaranResult> => ({
      agent: "karan",
      score: 80,
      passed: false,
      findings: [{ severity: "CRITICAL", description: "SQL injection via string-interpolated user input", file: "backend/src/routes/tasks.routes.ts" }],
    }),
    runTier3Review: async (): Promise<Tier3ReviewResult> => {
      tier3Called = true;
      return { pass: true, findings: [] };
    },
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.pass).toBe(false);
  expect(tier3Called).toBe(false); // short-circuits before Tier 3
});

test("runStage5WithAgents passes Karan's gate when findings are minor (severity-weighted 99 ≥ 85)", async () => {
  const agents = makeAgents({
    runKaran: async (): Promise<KaranResult> => ({
      agent: "karan",
      score: 99,
      passed: true,
      findings: [{ severity: "LOW", description: "verbose error message leaks stack trace", file: "backend/src/routes/tasks.routes.ts" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  // Karan's gate passes; overall pass depends on the other agents' defaults
  // in makeAgents (clean), so the run passes.
  expect(result.pass).toBe(true);
});

// ── 3. Navya or Deepika below 85 -> fails even if Karan is clean ───────────
test("runStage5WithAgents fails when Navya is below 85, even with a clean Karan", async () => {
  const agents = makeAgents({
    runNavya: async (): Promise<NavyaResult> => ({
      agent: "navya",
      score: 60,
      passed: false,
      findings: [{ severity: "CRITICAL", category: "null-ref", detail: "unchecked req.body.title access" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.pass).toBe(false);
});

test("runStage5WithAgents fails when Deepika is below 85, even with a clean Karan", async () => {
  const agents = makeAgents({
    runDeepika: async (): Promise<DeepikaResult> => ({
      agent: "deepika",
      score: 40,
      passed: false,
      findings: [{ severity: "HIGH", category: "n-plus-one", detail: "tasks list issues one query per row" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.pass).toBe(false);
});

// ── 4. Failure routes to the correct fault agent based on finding file paths ─
test("a Karan finding on a backend/ path routes faultAgent to shubham", async () => {
  const agents = makeAgents({
    runKaran: async (): Promise<KaranResult> => ({
      agent: "karan",
      score: 0,
      passed: false,
      findings: [{ severity: "CRITICAL", description: "SQL injection", file: "backend/src/routes/tasks.routes.ts" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.faultAgent).toBe("shubham");
});

test("a Karan finding on a frontend/ path routes faultAgent to aanya", async () => {
  const agents = makeAgents({
    runKaran: async (): Promise<KaranResult> => ({
      agent: "karan",
      score: 0,
      passed: false,
      // CRITICAL so Karan's ≥85 gate still fails (100−20=80) and the
      // fault-routing path under test is actually exercised.
      findings: [{ severity: "CRITICAL", description: "XSS via dangerouslySetInnerHTML", file: "frontend/app/dashboard/page.tsx" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.faultAgent).toBe("aanya");
});

test("a Karan finding on a db/ path routes faultAgent to pranav", async () => {
  const agents = makeAgents({
    runKaran: async (): Promise<KaranResult> => ({
      agent: "karan",
      score: 0,
      passed: false,
      // CRITICAL so Karan's ≥85 gate still fails and fault-routing is exercised.
      findings: [{ severity: "CRITICAL", description: "unparameterized dynamic SQL in migration runner", file: "db/migrations/0001_tasks.sql" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.faultAgent).toBe("pranav");
});

test("a Navya/Deepika-only failure falls back to the shubham default when the model omits a file path", async () => {
  const agents = makeAgents({
    runNavya: async (): Promise<NavyaResult> => ({
      agent: "navya",
      score: 50,
      passed: false,
      findings: [{ severity: "CRITICAL", category: "race-condition", detail: "double-submit on task creation" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.faultAgent).toBe("shubham");
});

// Task 14: Navya/Deepika's Finding gained an optional `file` field so their
// findings can fault-isolate to the actually-responsible agent instead of
// always falling through to identifyFaultAgent's "shubham" default.
test("a Navya finding with a frontend/ file path routes faultAgent to aanya", async () => {
  const agents = makeAgents({
    runNavya: async (): Promise<NavyaResult> => ({
      agent: "navya",
      score: 50,
      passed: false,
      findings: [{ severity: "CRITICAL", category: "null-ref", detail: "unchecked user.name access", file: "frontend/app/dashboard/page.tsx" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.faultAgent).toBe("aanya");
});

// Uses a db/ path (routes to "pranav") rather than backend/ ("shubham") on
// purpose — "shubham" is identifyFaultAgent's own default fallback, so a
// backend/ case here couldn't distinguish "file threading actually worked"
// from "file was silently ignored and it fell through to the default."
test("a Deepika finding with a db/ file path routes faultAgent to pranav, proving file threading (not just the default) drives routing", async () => {
  const agents = makeAgents({
    runDeepika: async (): Promise<DeepikaResult> => ({
      agent: "deepika",
      score: 50,
      passed: false,
      findings: [{ severity: "HIGH", category: "missing-index", detail: "full table scan on tasks query", file: "db/migrations/0001_tasks.sql" }],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.faultAgent).toBe("pranav");
});

// Findings are combined from all three agents (mapped into Stage 4's Finding
// shape) when any of them fails — not just the failing one(s).
test("combined findings include mapped entries from all three agents on failure", async () => {
  const agents = makeAgents({
    runKaran: async (): Promise<KaranResult> => ({
      agent: "karan",
      score: 0,
      passed: false,
      findings: [{ severity: "CRITICAL", description: "SQL injection", file: "backend/src/routes/tasks.routes.ts" }],
    }),
    runNavya: async (): Promise<NavyaResult> => ({
      agent: "navya",
      score: 70,
      passed: false,
      findings: [{ severity: "HIGH", category: "logic", detail: "off-by-one in pagination" }],
    }),
    runDeepika: async (): Promise<DeepikaResult> => ({
      agent: "deepika",
      score: 100,
      passed: true,
      findings: [],
    }),
  });

  const result = await runStage5WithAgents("test-proj", STAGE4_RESULT, agents);

  expect(result.pass).toBe(false);
  expect(result.findings).toHaveLength(2);
  // P2 (2026-07-24): issue text now includes the file (and line, when the
  // agent supplied one) as a location prefix — this finding has no line, so
  // it degrades to "file — " per locationPrefix's no-line branch.
  expect(result.findings[0]).toEqual({
    file: "backend/src/routes/tasks.routes.ts",
    issue: "backend/src/routes/tasks.routes.ts — [security/CRITICAL] SQL injection",
  });
  expect(result.findings[1]).toEqual({
    file: "",
    issue: "[logic/HIGH] logic: off-by-one in pagination",
  });
});

// ── A4 (full-system audit): collectCode must prefix file paths so
// identifyFaultAgent's backend/frontend/db prefix matching can ever
// actually match ──────────────────────────────────────────────────────────
// Bug found in stress-test run 10: collectCode's relPath was relative to
// EACH agent's own output dir (e.g. "src/controllers/notes.ts"), never
// prefixed with "backend/"/"frontend/" — identifyFaultAgent's
// startsWith("backend/") check could never match, so fault isolation
// always fell through to its "shubham" default regardless of which agent
// actually caused the finding. Karan's real run-10 finding.file was
// literally "src/controllers/notes.ts" (no prefix) — proof the model
// faithfully echoes whatever path format the "// FILE:" header shows it.
test("collectCode prefixes every file with its agent label, not just the bare relative path", () => {
  const root = mkdtempSync(join(tmpdir(), "nexsidi-collectcode-test-"));
  const backendDir = join(root, "backend");
  const frontendDir = join(root, "frontend");
  mkdirSync(join(backendDir, "src", "controllers"), { recursive: true });
  mkdirSync(join(frontendDir, "app", "dashboard"), { recursive: true });
  writeFileSync(join(backendDir, "src", "controllers", "notes.ts"), "export const x = 1;");
  writeFileSync(join(frontendDir, "app", "dashboard", "page.tsx"), "export default function Page() {}");

  try {
    const code = collectCode([
      { label: "backend", path: backendDir },
      { label: "frontend", path: frontendDir },
    ]);

    expect(code).toContain("// FILE: backend/src/controllers/notes.ts");
    expect(code).toContain("// FILE: frontend/app/dashboard/page.tsx");
    // The exact bug from run 10 — this is what a real finding.file value
    // needs to look like for identifyFaultAgent to route it correctly.
    expect(code).not.toContain("// FILE: src/controllers/notes.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 2026-07-28 (live, complex1): real bug found live — a generated frontend's
// vendored NexUI library (frontend/vendor/nexui + nexui-react) is static
// third-party code, not project code, and dominated collectCode's
// MAX_CODE_CHARS budget the same way it dominated qa-loop.ts's full-coverage
// requirement (200 vendor files vs 30 real generated frontend files on
// complex1 — see qa-loop.test.ts's matching test for the full root cause).
test("collectCode skips a vendored (vendor/) directory", () => {
  const root = mkdtempSync(join(tmpdir(), "nexsidi-collectcode-vendor-test-"));
  const frontendDir = join(root, "frontend");
  mkdirSync(join(frontendDir, "vendor", "nexui", "src"), { recursive: true });
  mkdirSync(join(frontendDir, "app"), { recursive: true });
  writeFileSync(join(frontendDir, "vendor", "nexui", "src", "button.ts"), "export const Button = 1;");
  writeFileSync(join(frontendDir, "app", "page.tsx"), "export default function Page() {}");

  try {
    const code = collectCode([{ label: "frontend", path: frontendDir }]);

    expect(code).not.toContain("vendor");
    expect(code).toContain("// FILE: frontend/app/page.tsx");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 2026-07-24 (P2, full agentic upgrade): `issue` is the ONE text field that
// survives all the way to the generator's fix prompt (via formatFinding in
// stage5-qa-fix-loop.ts) — a `line` on the QA finding does nothing for
// convergence unless it's embedded here. These pin the exact format so a
// future edit can't silently drop it back to file-only.

test("locationPrefix embeds file:line when both are present", () => {
  expect(locationPrefix("backend/src/db.ts", 47)).toBe("backend/src/db.ts:47 — ");
});

test("locationPrefix falls back to file-only when line is absent — never a misleading ':undefined'", () => {
  expect(locationPrefix("backend/src/db.ts", undefined)).toBe("backend/src/db.ts — ");
});

test("locationPrefix is empty when file itself is absent", () => {
  expect(locationPrefix(undefined, 47)).toBe("");
});

test("karanFindingToFinding embeds file:line into the issue text reaching the generator", () => {
  const result = karanFindingToFinding({ severity: "CRITICAL", description: "SQL injection", file: "backend/src/db.ts", line: 47 });
  expect(result.issue).toBe("backend/src/db.ts:47 — [security/CRITICAL] SQL injection");
  expect(result.file).toBe("backend/src/db.ts");
});

test("navyaFindingToFinding embeds file:line into the issue text reaching the generator", () => {
  const result = navyaFindingToFinding({ severity: "HIGH", category: "null-deref", detail: "unchecked optional", file: "backend/src/auth.ts", line: 12 });
  expect(result.issue).toBe("backend/src/auth.ts:12 — [logic/HIGH] null-deref: unchecked optional");
});

test("deepikaFindingToFinding embeds file:line into the issue text reaching the generator", () => {
  const result = deepikaFindingToFinding({ severity: "MEDIUM", category: "n-plus-one", detail: "query in loop", file: "backend/src/orders.ts", line: 88 });
  expect(result.issue).toBe("backend/src/orders.ts:88 — [performance/MEDIUM] n-plus-one: query in loop");
});

test("xFindingToFinding functions degrade gracefully to file-only issue text when line is absent", () => {
  const result = karanFindingToFinding({ severity: "LOW", description: "missing rate limit", file: "backend/src/app.ts" });
  expect(result.issue).toBe("backend/src/app.ts — [security/LOW] missing rate limit");
});
