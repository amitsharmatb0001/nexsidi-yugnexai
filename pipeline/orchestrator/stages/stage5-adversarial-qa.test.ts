import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStage5WithAgents, collectCode, type Stage5Agents } from "./stage5-adversarial-qa.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";
import type { QAResult as KaranResult } from "../../../agents/qa/karan/src/index.ts";
import type { QAResult as NavyaResult } from "../../../agents/qa/navya/src/index.ts";
import type { QAResult as DeepikaResult } from "../../../agents/qa/deepika/src/index.ts";
import type { Tier3ReviewResult } from "../../../agents/tilotma/src/tier3-review.ts";

// Real Navya/Karan/Deepika run() calls and Tilotma's Tier 3 review hit live
// LLMs and aren't unit-testable — per this plan's stated testing philosophy,
// only the deterministic scoring/routing logic in runStage5WithAgents is
// covered here, via injected stub agent results (Stage5Agents).

const STAGE4_RESULT: Stage4Result = {
  backendOutputDir: "C:/tmp/nexsidi-builds/test-proj/backend",
  frontendOutputDir: "C:/tmp/nexsidi-builds/test-proj/frontend",
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
  expect(result.findings[0]).toEqual({
    file: "backend/src/routes/tasks.routes.ts",
    issue: "[security/CRITICAL] SQL injection",
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
