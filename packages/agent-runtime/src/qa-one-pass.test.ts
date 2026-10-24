import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPreloadedCode, buildQaInitialMessage, joinRoundNotes, splitRoundNotes, qaSkillMatchText } from "./qa-loop.ts";

// 2026-10-22 (Trailhead rerun, measured from 1,370 model calls): the three code reviewers cost $16.89 of $36.94 (46%)
// and most of the hours. Each read a 53-file app (~37K tokens) one 8,000-character piece at a time, ~160 calls each, every
// call resending the whole conversation: 8-12 million input tokens per reviewer. The code now goes into the reviewer's
// first message (up to a size budget), every included file counts as read, and the reviewer submits in a few calls.
//
// Amit, same day: after any fix the review must cover the WHOLE app, never only the changed files, because one changed
// function can break every page that imports it. The changed-files-only re-review mode is no longer used.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qa1-"));
  mkdirSync(join(dir, "backend", "src"), { recursive: true });
  mkdirSync(join(dir, "frontend", "app"), { recursive: true });
  writeFileSync(join(dir, "backend", "src", "app.ts"), "export const app = 1;\n");
  writeFileSync(join(dir, "frontend", "app", "page.tsx"), "export default function P() { return null; }\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const dirs = () => [{ label: "backend", path: join(dir, "backend") }, { label: "frontend", path: join(dir, "frontend") }];

test("every file within the budget is included whole, with its labeled path", () => {
  const p = buildPreloadedCode(dirs(), 100_000);
  expect(p.included.sort()).toEqual(["backend/src/app.ts", "frontend/app/page.tsx"]);
  expect(p.omitted).toEqual([]);
  expect(p.text).toContain("=== FILE: backend/src/app.ts ===");
  expect(p.text).toContain("export const app = 1;");
});

test("files past the budget are listed as not included, never cut in half", () => {
  writeFileSync(join(dir, "backend", "src", "big.ts"), "x".repeat(5000));
  const p = buildPreloadedCode(dirs(), 200);
  expect(p.omitted).toContain("backend/src/big.ts");
  expect(p.text).not.toContain("xxxxx");
});

test("the first message says the code is already here and asks for a full review", () => {
  const p = buildPreloadedCode(dirs(), 100_000);
  const msg = buildQaInitialMessage("logic bugs", undefined, undefined, p);
  expect(msg).toContain("The whole codebase is included below");
  expect(msg).toContain("=== FILE: frontend/app/page.tsx ===");
  expect(msg).not.toContain("Call list_files first");
});

test("the reviewer loop preloads the code, counts it as read, and never narrows to changed files", () => {
  const src = readFileSync(new URL("./qa-loop.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export async function runQAAgent"), src.indexOf("export async function extractFindingsFromHistory"));
  expect(fn).toContain("buildPreloadedCode(config.dirs");
  expect(fn).toContain("for (const path of preload.included) readFiles.add(path);");
  expect(fn).toContain("const changedFiles: string[] | undefined = undefined;");
});


// 2026-10-24 (Brewline, measured): Google's cache reuses a request only up to its first changed character. Reviewers got
// 24-28% of their input from the cache. Two causes: the code went in path order, so a change in backend/src/app.ts (the
// first file) changed everything after it — 0.4% of the code block stayed identical after the last fix round; and the
// security and performance scan results, which change every round, came before the code. Now the least recently changed
// files come first (74.8% identical on the same round), the scan results come after the code, and the instructions
// chosen for a reviewer do not depend on the code.
test("the least recently changed files come first, so a fix changes only the end of the code block", () => {
  writeFileSync(join(dir, "backend", "src", "orders.ts"), "export const orders = 1;\n");
  const t = Date.now() / 1000;
  utimesSync(join(dir, "backend", "src", "app.ts"), t, t); // just fixed
  utimesSync(join(dir, "frontend", "app", "page.tsx"), t - 3600, t - 3600);
  utimesSync(join(dir, "backend", "src", "orders.ts"), t - 7200, t - 7200);
  const p = buildPreloadedCode(dirs(), 100_000);
  expect(p.included).toEqual(["backend/src/orders.ts", "frontend/app/page.tsx", "backend/src/app.ts"]);
});

test("this round's scan results go after the code; the plan and rules stay before it", () => {
  const p = buildPreloadedCode(dirs(), 100_000);
  const ctx = joinRoundNotes("APPROVED PLAN: SC1 menu", ["SECURITY LEADS: helmet missing"]);
  const msg = buildQaInitialMessage("security", ctx, undefined, p);
  expect(msg.indexOf("APPROVED PLAN")).toBeLessThan(msg.indexOf("=== FILE:"));
  expect(msg.indexOf("SECURITY LEADS")).toBeGreaterThan(msg.lastIndexOf("=== END:"));
  expect(splitRoundNotes(ctx)).toEqual({ stable: "APPROVED PLAN: SC1 menu", round: "SECURITY LEADS: helmet missing" });
  expect(splitRoundNotes("only the plan")).toEqual({ stable: "only the plan", round: undefined });
  expect(joinRoundNotes("plan", ["", ""])).toBe("plan");
});

test("two rounds that differ only in scan results and one fixed file share everything before that file", () => {
  const t = Date.now() / 1000;
  utimesSync(join(dir, "frontend", "app", "page.tsx"), t - 3600, t - 3600);
  const before = buildQaInitialMessage("security", joinRoundNotes("PLAN", ["LEADS round 1"]), undefined, buildPreloadedCode(dirs(), 100_000));
  writeFileSync(join(dir, "backend", "src", "app.ts"), "export const app = 2;\n");
  const after = buildQaInitialMessage("security", joinRoundNotes("PLAN", ["LEADS round 2"]), undefined, buildPreloadedCode(dirs(), 100_000));
  let same = 0;
  while (same < before.length && before[same] === after[same]) same++;
  expect(same).toBeGreaterThan(before.indexOf("=== END: frontend/app/page.tsx ==="));
});

test("the instructions chosen for a reviewer depend on the plan and its focus, not on the code or this round's results", () => {
  const ctx = joinRoundNotes("PLAN: a coffee shop menu", ["LEADS: GSTIN invoice"]);
  expect(qaSkillMatchText("security", ctx)).toContain("coffee shop");
  expect(qaSkillMatchText("security", ctx)).not.toContain("GSTIN");
  const src = readFileSync(new URL("./qa-loop.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export async function runQAAgent"), src.indexOf("export async function extractFindingsFromHistory"));
  expect(fn).toContain("taskText: qaSkillMatchText(config.reviewFocus, config.systemContext)");
  const stage5 = readFileSync(new URL("../../../pipeline/orchestrator/stages/stage5-adversarial-qa.ts", import.meta.url), "utf-8");
  expect(stage5).toMatch(/joinRoundNotes\(\[systemContext, karanMissed\].*, \[securityLeads\]\)/);
  expect(stage5).toMatch(/joinRoundNotes\(\[systemContext, deepikaMissed\].*, \[performanceLeads\]\)/);
});
