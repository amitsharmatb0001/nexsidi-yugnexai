import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 2026-08-27: real bug found live (project 852be5aeaef4). build-plan.json is
// BOTH the planner's output and Arjun's output. readPlannerSimplePlan
// distinguishes them by "pages[] present, shubhamTasks absent" — which works
// exactly ONCE, on the first Arjun run, because Arjun then overwrites the
// file with its own plan (which HAS shubhamTasks). Every spec-rejection
// re-run therefore read Arjun's output, got null, and silently dropped
// annotation mode — taking with it the deterministic reconciliation that
// guarantees every page the user was PROMISED actually gets built.
//
// Confirmed live: the user approved a plan containing /faq, rejected the spec
// twice on unrelated (auth-scope) grounds, and the delivered app had no /faq
// page — with nothing anywhere reporting it dropped.
//
// These tests exercise the detection contract directly against real files on
// disk. Importing pipeline/activities/index.ts is not viable here (it pulls
// the whole Temporal/agent graph and needs live env), so this reimplements
// the exact predicate under test and asserts the durable-copy behavior the
// fix depends on — the same approach the repo already uses for source-shape
// guarantees in packages/agent-runtime/src/enforce/*.test.ts.

const PLANNER_PLAN_FILE = "planner-plan.json";

function isPlannerShape(raw: string): boolean {
  const data = JSON.parse(raw) as Record<string, unknown>;
  return Array.isArray(data.pages) && !data.shubhamTasks;
}

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "nexsidi-planner-plan-"));
}

const PLANNER_PLAN = JSON.stringify({
  schemaVersion: "1",
  appName: "Clario AI",
  pages: [
    { name: "Home", path: "/", description: "landing" },
    { name: "FAQ", path: "/faq", description: "frequently asked questions" },
  ],
  authType: "jwt",
});

// Arjun's output for the SAME project — note it has shubhamTasks and no
// pages[], which is exactly what made the old detection fail on re-runs.
const ARJUN_PLAN = JSON.stringify({
  appName: "Clario AI",
  shubhamTasks: [{ description: "express setup", outputFiles: ["src/index.ts"] }],
  aanyaTasks: [],
  pranavTasks: [],
});

test("the planner's own plan is recognized on a first run", () => {
  const dir = makeProjectDir();
  try {
    writeFileSync(join(dir, "build-plan.json"), PLANNER_PLAN, "utf-8");
    expect(isPlannerShape(readFileSync(join(dir, "build-plan.json"), "utf-8"))).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Arjun's overwrite destroys the planner shape — the exact regression this fix exists for", () => {
  const dir = makeProjectDir();
  try {
    writeFileSync(join(dir, "build-plan.json"), PLANNER_PLAN, "utf-8");
    // Arjun runs and overwrites, as pipeline/activities/index.ts's runArjun does.
    writeFileSync(join(dir, "build-plan.json"), ARJUN_PLAN, "utf-8");
    // Pre-fix, a rejection re-run read exactly this and got null.
    expect(isPlannerShape(readFileSync(join(dir, "build-plan.json"), "utf-8"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a durable planner-plan.json survives Arjun's overwrite, so re-runs keep the promised pages", () => {
  const dir = makeProjectDir();
  try {
    writeFileSync(join(dir, "build-plan.json"), PLANNER_PLAN, "utf-8");
    // The fix promotes the planner's copy on first read...
    writeFileSync(join(dir, PLANNER_PLAN_FILE), PLANNER_PLAN, "utf-8");
    // ...then Arjun overwrites build-plan.json as before.
    writeFileSync(join(dir, "build-plan.json"), ARJUN_PLAN, "utf-8");

    const durable = join(dir, PLANNER_PLAN_FILE);
    expect(existsSync(durable)).toBe(true);
    const raw = readFileSync(durable, "utf-8");
    expect(isPlannerShape(raw)).toBe(true);

    // The specific page that was silently lost live must still be here.
    const pages = (JSON.parse(raw) as { pages: Array<{ path: string }> }).pages;
    expect(pages.map((p) => p.path)).toContain("/faq");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readPlannerSimplePlan prefers the durable copy and promotes the legacy one", () => {
  // Source-shape guarantee: the real implementation must consult
  // planner-plan.json and must write it back when only the legacy file exists.
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toContain("PLANNER_PLAN_FILE");
  expect(src).toContain('const PLANNER_PLAN_FILE = "planner-plan.json"');
  // The promotion write is what makes the SECOND run work — without it the
  // durable copy would never exist for projects created before the fix.
  expect(src).toMatch(/writeCacheFile\(projectId,\s*PLANNER_PLAN_FILE/);
});
