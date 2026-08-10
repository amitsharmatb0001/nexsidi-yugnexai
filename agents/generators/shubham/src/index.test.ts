import { test, expect } from "bun:test";
import { buildFixTask, renderTaskManifest, SHUBHAM_AGENT_SYSTEM_PROMPT, countTestableResources } from "./index.ts";
import type { BuildPlan } from "../../../arjun/src/index.ts";

// A6 (full-system audit, Phase C): Stage 5 QA findings previously went
// nowhere — the pipeline stopped at Stage 5 with real findings and no
// mechanism to act on them (documented gap in run.ts's own comment above
// stage5's call site). buildFixTask is the pure, testable core of the fix
// prompt handed to runFix() — run() itself calls a live LLM and isn't
// unit-testable, same split as every other agent in this codebase.
//
// 2026-07-26 (agent-autonomy-assessment F1/F2): buildFixTask used to say
// "Fix ONLY these specific issues — do not refactor working code that
// wasn't flagged" and received no plan/schema/contract at all. Live proof
// this was the actual root cause: across 6 real QA rounds on a booking
// system, Shubham patched 3 different real sub-bugs in the SAME function
// one at a time (missing availability check -> added it; race on approve
// -> added FOR UPDATE; duplicate insert -> added a per-user advisory lock)
// without ever generalizing to a correct locking design, because the
// prompt forbade exactly that and it was never shown the DB schema that
// would have revealed the missing UNIQUE constraint. Tests below assert
// the corrected contract: root-cause reasoning permitted, full plan context
// included.

const FIX_TEST_PLAN: BuildPlan = {
  projectId: "fixtest",
  appName: "Greenway Estates Portal",
  appDescription: "A property management platform for landlords, tenants, and staff.",
  designBrief: {} as any,
  features: [],
  sharedTypes: "export interface Application { id: string; }",
  apiContract: { baseUrl: "http://localhost:3001", endpoints: [] },
  dbSchema: { tables: [{ name: "applications", columns: [{ name: "user_id", drizzleType: "uuid()", constraints: [] }], indexes: [] }] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
  buildPlanHash: "deadbeef",
};

// 2026-08-10: real gap found live (user request) — Shubham's self-check
// mechanical gate was "requiredEvidenceKinds: ['http_check']", satisfied by
// testing ONE endpoint. Every other resource's CRUD chain went unverified
// until QA or a live deploy round-trip caught it later (or didn't — see the
// path-param bug just found in Riya's verifier, silently inert all
// session). countTestableResources counts distinct resources (grouped by
// first path segment after /api/v1/, excluding auth) that have a real
// create endpoint — the same grouping convention as Riya's
// verifyAllResourceCrud, kept as a separate local function rather than an
// import from agents/riya (Shubham generates code Riya later deploys/
// verifies — importing from riya into shubham would be a backwards
// dependency direction).
test("countTestableResources counts distinct resources with a create endpoint, ignoring auth and read-only resources", () => {
  const plan: BuildPlan = {
    ...FIX_TEST_PLAN,
    apiContract: {
      baseUrl: "http://localhost:3001",
      endpoints: [
        { method: "POST", path: "/api/v1/auth/register", description: "", auth: false, requestType: "null", responseType: "null", errorCodes: [] },
        { method: "POST", path: "/api/v1/classes", description: "", auth: true, requestType: "{ name: string }", responseType: "null", errorCodes: [] },
        { method: "GET", path: "/api/v1/classes/:id", description: "", auth: true, requestType: "null", responseType: "null", errorCodes: [] },
        { method: "POST", path: "/api/v1/sessions", description: "", auth: true, requestType: "{ class_id: string }", responseType: "null", errorCodes: [] },
        { method: "GET", path: "/api/v1/reports", description: "", auth: true, requestType: "null", responseType: "null", errorCodes: [] },
      ],
    },
  };
  expect(countTestableResources(plan)).toBe(2); // classes, sessions — NOT auth, NOT the read-only reports resource
});

test("countTestableResources returns 0 for a project with no resources needing CRUD testing", () => {
  expect(countTestableResources(FIX_TEST_PLAN)).toBe(0);
});

test("buildFixTask numbers each finding", () => {
  const task = buildFixTask(
    [
      "[security/CRITICAL] backend/src/db/pool.ts: hardcoded fallback credentials",
      "[logic/HIGH] backend/src/controllers/tasks.ts: TOCTOU race in updateTask",
    ],
    FIX_TEST_PLAN,
  );
  expect(task).toContain("1. [security/CRITICAL] backend/src/db/pool.ts: hardcoded fallback credentials");
  expect(task).toContain("2. [logic/HIGH] backend/src/controllers/tasks.ts: TOCTOU race in updateTask");
});

test("buildFixTask instructs root-cause diagnosis, not blind point-fixing — the exact instruction that caused the whack-a-mole pattern is gone", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task).not.toContain("Fix ONLY these specific issues");
  expect(task).not.toContain("do not refactor working code that wasn't flagged");
  expect(task.toLowerCase()).toContain("root cause");
});

test("buildFixTask permits generalizing a fix to the same class of issue elsewhere in the agent's own files", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task.toLowerCase()).toContain("same class of issue elsewhere");
});

test("buildFixTask includes the full system context (spec/contract/schema), not just the bug report", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task).toContain("Greenway Estates Portal");
  expect(task).toContain("applications");
  expect(task).toContain("user_id");
});

test("buildFixTask instructs verification before task_complete", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task.toLowerCase()).toContain("verif");
  expect(task).toContain("task_complete");
});

// 2026-07-26 (agent-autonomy-assessment F1, follow-on live proof): the
// system prompt ITSELF instructed `process.env.JWT_SECRET || "default_dev_secret"`
// on every single generation — QA then had to catch and fix this exact
// finding on every build, and Shubham oscillated between hardcoded and
// random fallbacks trying to satisfy successive QA rounds because the base
// instruction told it to fall back at all. Fail-closed is the only correct
// behavior: throw at startup if JWT_SECRET is missing, no fallback of any
// kind (not hardcoded, not random).
test("SHUBHAM_AGENT_SYSTEM_PROMPT does not instruct a JWT secret fallback of any kind", () => {
  expect(SHUBHAM_AGENT_SYSTEM_PROMPT).not.toContain("default_dev_secret");
  expect(SHUBHAM_AGENT_SYSTEM_PROMPT).not.toContain('JWT_SECRET || "');
  expect(SHUBHAM_AGENT_SYSTEM_PROMPT.toLowerCase()).toContain("fail-closed");
});

// F4: complex1 shipped TWO competing schemas (db/migrations/0000_initial.sql,
// written by Pranav — the one docker-compose.yml actually mounts — AND
// backend/init.sql, written by Shubham on its own initiative, never
// detected). Nothing in the prompt told Shubham the DB schema isn't its
// file to write.
test("SHUBHAM_AGENT_SYSTEM_PROMPT forbids writing SQL schema/migration files — Pranav owns the schema exclusively", () => {
  expect(SHUBHAM_AGENT_SYSTEM_PROMPT.toLowerCase()).toContain("do not write");
  expect(SHUBHAM_AGENT_SYSTEM_PROMPT.toLowerCase()).toContain("pranav");
});

// P5.W5.1 (full agentic upgrade plan — plan-then-execute): Arjun's BuildPlan
// already produces an exhaustive shubhamTasks manifest ("outputFiles must
// list every file the agent must produce. Be exhaustive.") but buildAgentTask
// never rendered it — Shubham had zero visibility into the exact file list
// Arjun already decomposed, unlike Aanya (whose buildAgentTask already
// renders aanyaTasks as "PLANNED FRONTEND FILES AND PAGES"). Without the
// manifest, the agent has no way to know it's "done writing" other than
// feeling around with tsc after every file — the measured cause of the
// 30-60x per-session tsc/build re-verification tax. renderTaskManifest is
// the pure, testable core of the fix (mirrors Aanya's inline taskDetails map).
test("renderTaskManifest lists every task's description and output files", () => {
  const manifest = renderTaskManifest([
    { description: "Express entry, app setup, JWT middleware", outputFiles: ["src/index.ts", "src/middleware/auth.ts"] },
    { description: "Tasks resource — CRUD endpoints", outputFiles: ["src/routes/tasks.routes.ts", "src/controllers/tasks.ts"] },
  ]);
  expect(manifest).toContain("Task 1: Express entry, app setup, JWT middleware");
  expect(manifest).toContain("- src/index.ts");
  expect(manifest).toContain("- src/middleware/auth.ts");
  expect(manifest).toContain("Task 2: Tasks resource — CRUD endpoints");
  expect(manifest).toContain("- src/routes/tasks.routes.ts");
});

test("renderTaskManifest returns an empty string for an empty/missing task list — never a dangling header", () => {
  expect(renderTaskManifest([])).toBe("");
});
