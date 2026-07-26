import { test, expect } from "bun:test";
import { run, findMissingLockedPages, synthesizeTaskForPage, type LockedPage } from "./index.ts";
import type { ProjectSpec } from "../../saanvi/src/index.ts";
import { FALLBACK_BRIEF, type DesignBrief } from "../../vanya/src/index.ts";

// 2026-07-24 (P3.W3.1): run() now also calls Vanya for a design brief.
// Every test below stubs it (defaulting to FALLBACK_BRIEF) so these stay
// true unit tests with zero live network calls — without this, a test that
// only stubs `chat` would still trigger a REAL, unmocked Vanya LLM call.
const stubRunVanya = async (): Promise<DesignBrief> => FALLBACK_BRIEF;

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
  auth: { provider: "custom", features: ["sign-in", "sign-up"] },
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

  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya });

  expect(callCount).toBe(2);
  expect(plan.appName).toBe("Test App");
});

test("two consecutive empty responses still throw", async () => {
  const stubChat = async () => ({ content: "", modelUsed: "mistralai/mistral-nemotron" as const });

  await expect(run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya })).rejects.toThrow();
});

// 2026-07-24 (P3.W3.1): design identity previously had no path into
// BuildPlan at all (Aanya relied solely on spec.description). This proves
// Vanya's brief actually reaches the plan Aanya receives.
test("Vanya's design brief flows through into BuildPlan.designBrief", async () => {
  const stubChat = async () => ({ content: VALID_PLAN_JSON, modelUsed: "mistralai/mistral-nemotron" as const });
  const customBrief: DesignBrief = {
    mood: "Playful and bold",
    palette: [{ name: "ink", hex: "#111111" }, { name: "paper", hex: "#FFFFFF" }, { name: "accent", hex: "#FF6600" }],
    typography: { display: "Fraunces", body: "Inter" },
    layoutConcept: "Asymmetric grid",
  };

  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: async () => customBrief });

  expect(plan.designBrief).toEqual(customBrief);
});

// 2026-07-24 (P3.W3.2, full agentic upgrade): "Vision/Mission pages lost at
// intake" (this session's original forensic audit) — annotation mode's
// lockedPages list is supposed to be authoritative (Arjun ANNOTATES, never
// invents pages), but nothing verified the LLM's aanyaTasks output actually
// covered every locked page. These tests cover the deterministic
// reconciliation that closes that gap.

const LOCKED_PAGES: LockedPage[] = [
  { name: "Home", path: "/", description: "Landing page", nextjsFile: "app/page.tsx" },
  { name: "Vision", path: "/vision", description: "Company vision", nextjsFile: "app/vision/page.tsx" },
  { name: "Mission", path: "/mission", description: "Company mission", nextjsFile: "app/mission/page.tsx" },
];

test("findMissingLockedPages returns an empty array when every locked page has a matching aanyaTask output file", () => {
  const aanyaTasks = LOCKED_PAGES.map((p) => ({ description: p.name, outputFiles: [p.nextjsFile] }));
  expect(findMissingLockedPages(LOCKED_PAGES, aanyaTasks)).toEqual([]);
});

test("findMissingLockedPages catches pages dropped entirely from aanyaTasks (the exact 'Vision/Mission lost' failure mode)", () => {
  // Only Home made it into aanyaTasks — Vision and Mission were dropped
  // during the LLM's own condensation, exactly as the original forensic
  // audit found live.
  const aanyaTasks = [{ description: "Home", outputFiles: ["app/page.tsx"] }];
  const missing = findMissingLockedPages(LOCKED_PAGES, aanyaTasks);
  expect(missing.map((p) => p.name)).toEqual(["Vision", "Mission"]);
});

test("findMissingLockedPages treats a wrong output path as missing, not covered — the exact path is what routing depends on", () => {
  const aanyaTasks = [
    { description: "Home", outputFiles: ["app/page.tsx"] },
    // Wrong path for Vision — e.g. the LLM wrote "app/our-vision/page.tsx" instead of "app/vision/page.tsx"
    { description: "Vision", outputFiles: ["app/our-vision/page.tsx"] },
    { description: "Mission", outputFiles: ["app/mission/page.tsx"] },
  ];
  const missing = findMissingLockedPages(LOCKED_PAGES, aanyaTasks);
  expect(missing.map((p) => p.name)).toEqual(["Vision"]);
});

test("synthesizeTaskForPage produces a task whose outputFiles is exactly the locked page's nextjsFile", () => {
  const task = synthesizeTaskForPage(LOCKED_PAGES[1]!); // Vision
  expect(task.outputFiles).toEqual(["app/vision/page.tsx"]);
  expect(task.description).toContain("Vision");
  expect(task.description).toContain("Company vision");
});

test("run() in annotation mode self-heals dropped locked pages — aanyaTasks includes every locked page even when the LLM's raw output omits some", async () => {
  // The LLM's raw response only builds Home — Vision/Mission are silently
  // dropped, reproducing the original bug.
  const incompletePlanJson = JSON.stringify({
    sharedTypes: "",
    apiContract: { endpoints: [] },
    dbSchema: { tables: [] },
    shubhamTasks: [],
    aanyaTasks: [{ description: "Home page", outputFiles: ["app/page.tsx"] }],
    pranavTasks: [],
    independenceVerified: true,
  });
  const stubChat = async () => ({ content: incompletePlanJson, modelUsed: "mistralai/mistral-nemotron" as const });

  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya }, LOCKED_PAGES, "none");

  const coveredFiles = new Set(plan.aanyaTasks.flatMap((t) => t.outputFiles));
  expect(coveredFiles.has("app/page.tsx")).toBe(true);
  expect(coveredFiles.has("app/vision/page.tsx")).toBe(true);
  expect(coveredFiles.has("app/mission/page.tsx")).toBe(true);
});

test("run() does NOT run reconciliation in free-form mode (no lockedPages provided) — nothing to reconcile against", async () => {
  const stubChat = async () => ({ content: VALID_PLAN_JSON, modelUsed: "mistralai/mistral-nemotron" as const });
  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya }); // no lockedPages arg
  expect(plan.aanyaTasks).toEqual([]); // untouched — no synthesized tasks appended
});
