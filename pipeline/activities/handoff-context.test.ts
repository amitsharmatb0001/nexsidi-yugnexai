import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rulesFromPlan, buildHandoffContext, latestCodeMap, isMappedFile, traceInputFromPlan } from "./handoff-context.ts";

// Patent claims 1 and 3: the context object handed to the next agent carries the code map and the rules to follow.

const plan = {
  features: [{ name: "Contact form", description: "d", userStories: [] }],
  apiContract: { endpoints: [{ method: "POST", path: "/api/contact", auth: false }, { method: "GET", path: "/api/me", auth: true }] },
  dbSchema: { tables: [{ name: "messages", columns: [{ name: "id" }, { name: "body" }], indexes: [] }] },
};

test("rules are read from the plan: each feature, each endpoint with its auth requirement, each table with its columns", () => {
  const rules = rulesFromPlan(plan);
  expect(rules).toContain("Feature required: Contact form");
  expect(rules).toContain("Endpoint POST /api/contact must exist and must not require sign-in");
  expect(rules).toContain("Endpoint GET /api/me must exist and must require sign-in");
  expect(rules).toContain("Table messages must have columns: id, body");
});

test("a plan with nothing usable gives no rules instead of throwing", () => {
  expect(rulesFromPlan(undefined)).toEqual([]);
  expect(rulesFromPlan({})).toEqual([]);
  expect(rulesFromPlan({ features: "x", apiContract: null })).toEqual([]);
});

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hctx-"));
  mkdirSync(join(dir, "backend/src"), { recursive: true });
  writeFileSync(join(dir, "backend/src/index.ts"), `export const a = 1;\n`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the handoff context keeps the sorted file list and adds the code map with the plan's rules", () => {
  const ctx = buildHandoffContext(dir, { filesWritten: ["backend/src/index.ts"] }, plan);
  expect(ctx.filesWritten).toEqual(["backend/src/index.ts"]);
  expect(ctx.codeMap.files.map((f) => f.path)).toEqual(["backend/src/index.ts"]);
  expect(ctx.codeMap.rules.length).toBe(4);
});

test("recording and checking build the identical context, so the hash matches until something really changes", () => {
  const a = buildHandoffContext(dir, { filesWritten: ["backend/src/index.ts"] }, plan);
  const b = buildHandoffContext(dir, { filesWritten: ["backend/src/index.ts"] }, plan);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  writeFileSync(join(dir, "backend/src/index.ts"), `export const a = 2;\n`);
  const c = buildHandoffContext(dir, { filesWritten: ["backend/src/index.ts"] }, plan);
  expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
});

test("latestCodeMap reads the code map back from the newest handoff file in the folder", () => {
  const hd = join(dir, ".nexsidi", "handoffs");
  mkdirSync(hd, { recursive: true });
  const ctx = buildHandoffContext(dir, { filesWritten: ["backend/src/index.ts"] }, plan);
  writeFileSync(join(hd, "0001-arjun-shubham.json"), JSON.stringify({ not: "a map" }));
  writeFileSync(join(hd, "0002-qa-gan-deploy.json"), JSON.stringify(ctx));
  const m = latestCodeMap(dir);
  expect(m?.files[0]?.path).toBe("backend/src/index.ts");
  expect(latestCodeMap(join(dir, "nowhere"))).toBeNull();
});

test("the map covers source code and SQL, not files that build tools rewrite on their own", () => {
  expect(["backend/src/a.ts", "frontend/app/page.tsx", "db/migrations/0001.sql", "frontend/app/globals.css"].every(isMappedFile)).toBe(true);
  expect(["frontend/tsconfig.json", "backend/package.json", "frontend/next-env.d.ts", "public/logo.png"].some(isMappedFile)).toBe(false);
});

test("the plan's features and its three task lists become the traceability input; malformed parts are skipped", () => {
  const input = traceInputFromPlan({
    features: [{ name: "Contact form", description: "d" }, { nope: 1 }],
    shubhamTasks: [{ description: "routes", outputFiles: ["src/routes/contact.ts", 5] }],
    aanyaTasks: [{ description: "page", outputFiles: [] }, "bad"],
    pranavTasks: "bad",
  });
  expect(input.features).toEqual([{ name: "Contact form", description: "d" }]);
  expect(input.tasks).toEqual([{ agent: "shubham", description: "routes", outputFiles: ["src/routes/contact.ts"] }, { agent: "aanya", description: "page", outputFiles: [] }]);
  expect(traceInputFromPlan(null)).toEqual({ features: [], tasks: [] });
});

test("the handoff context includes the traceability graph built from the plan and the code map", () => {
  const withTasks = { ...plan, shubhamTasks: [{ description: "Contact form endpoint", outputFiles: ["src/index.ts"] }] };
  const ctx = buildHandoffContext(dir, { filesWritten: ["backend/src/index.ts"] }, withTasks);
  expect(ctx.traceability.requirements.map((r) => r.name)).toEqual(["Contact form"]);
  expect(ctx.traceability.edges.some((e) => e.kind === "task-file" && e.to === "backend/src/index.ts")).toBe(true);
});
