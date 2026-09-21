import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFindings, buildEvidenceCollectorTask, buildRealityCheckerTask, countAppPages, computeTier3MaxIterations, shouldSkipStage2, EVIDENCE_COLLECTOR_PROMPT, REALITY_CHECKER_PROMPT } from "./tier3-review.ts";

// 2026-08-06: real bug found live (project bae438767bed) — both Tier-3
// stages are evidence-only (their prompts only ever instruct "verify and
// report", never "fix"), but write_file/run_command were unconditionally
// available to every agent regardless of role, and the reality-checker used
// them for 4 rounds of self-repair across its entire budget instead of
// reporting the bug it found — producing zero findings for Stage 6 to route.
// readOnly (see loop.ts) closes this; a source check is the cheapest way to
// confirm neither runAgentEscalated call in runTier3Review regresses to
// omitting it, since exercising the real agent loop isn't unit-testable here.
test("both Tier-3 stages run readOnly — neither is a fix pass", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tier3-review.ts"), "utf-8");
  const readOnlyOccurrences = source.match(/readOnly:\s*true/g) ?? [];
  expect(readOnlyOccurrences.length).toBe(2);
});

test("parseFindings extracts a well-formed FINDINGS block", () => {
  const summary = `FINDINGS:
- Dashboard cards misaligned on mobile, see dashboard.png
- Placeholder lorem ipsum text left in sign-up page
VERDICT: NEEDS_WORK`;
  expect(parseFindings(summary)).toEqual([
    "Dashboard cards misaligned on mobile, see dashboard.png",
    "Placeholder lorem ipsum text left in sign-up page",
  ]);
});

test("parseFindings falls back to the whole summary as one finding when unparseable", () => {
  const summary = "The agent got confused and never produced a FINDINGS block.";
  expect(parseFindings(summary)).toEqual([summary]);
});

test("parseFindings returns empty array for an empty summary", () => {
  expect(parseFindings("")).toEqual([]);
});

test("parseFindings falls back to the raw summary when the FINDINGS block has zero '-' lines", () => {
  // Deliberate conservative behavior: a zero-findings block is structurally
  // identical to a garbled/confused response, so the function preserves the
  // raw text rather than assuming the best case and silently returning [].
  const summary = `FINDINGS:
VERDICT: READY`;
  expect(parseFindings(summary)).toEqual([summary]);
});

// 2026-07-11: real bug found live (stress-fix2-1783753726) — Tier 3 tested
// `${appUrl}/api/tasks` against the FRONTEND origin and reported "no API
// route implemented" as a finding, when this project's apps use a SEPARATE
// frontend/backend architecture (frontend never serves API routes). Tier 3
// only ever knew the frontend URL. These tests confirm the backend URL is
// actually present in the task text the agent receives, and that it's told
// which URL is which.
test("buildEvidenceCollectorTask includes both the frontend and backend URLs, clearly labeled", () => {
  const task = buildEvidenceCollectorTask("proj1", "http://localhost:3200", "http://localhost:3300", "tier3-review-screenshots/proj1");
  expect(task).toContain("FRONTEND URL: http://localhost:3200");
  expect(task).toContain("BACKEND API URL: http://localhost:3300");
  expect(task).toContain("BACKEND API URL above, never");
});

test("buildRealityCheckerTask includes both URLs and warns about a false 'missing API route' finding from Stage 1", () => {
  const task = buildRealityCheckerTask(
    "proj1",
    "http://localhost:3200",
    "http://localhost:3300",
    "tier3-review-screenshots/proj1",
    ["no API route implemented at /api/tasks"],
  );
  expect(task).toContain("FRONTEND URL: http://localhost:3200");
  expect(task).toContain("BACKEND API URL: http://localhost:3300");
  expect(task).toContain("almost certainly wrong");
});

// 2026-08-30: real live incident (project 05b590e98102) — both stages' own
// NexSidi/NexUI/@yugnex confidentiality rule had no exclusion for the
// required "YugNex" footer attribution, matching karan.md's already-fixed
// confusion (852be5aeaef4) but in a different, unpatched agent. The reality
// checker's own reasoning literally matched "YugNex" against "@yugnex" by
// substring and ordered Aanya to strip the required watermark. Asserting
// the exclusion text is present in BOTH stage prompts — Stage 1 originates
// the finding, Stage 2 (which re-verifies rather than trusting Stage 1)
// would otherwise re-confirm the same false positive independently.
test("Stage 1's brand-name rule excludes the required YugNex attribution footer", () => {
  expect(EVIDENCE_COLLECTOR_PROMPT).toContain("EXCLUSION");
  expect(EVIDENCE_COLLECTOR_PROMPT).toContain("Developed & Managed by YugNex");
  expect(EVIDENCE_COLLECTOR_PROMPT).toContain("do NOT match it against");
});

test("Stage 2's AUTOMATIC BLOCKING FINDINGS rule excludes the required YugNex attribution footer", () => {
  expect(REALITY_CHECKER_PROMPT).toContain("EXCLUSION");
  expect(REALITY_CHECKER_PROMPT).toContain("Developed & Managed by YugNex");
  expect(REALITY_CHECKER_PROMPT).toContain("BUILD SYSTEM is the");
});

// 2026-07-27 (live, complex1): real gap found live — a flat 40-iteration
// cap (the shared default) let the reality-checker spend its ENTIRE budget
// reading real pages (dashboard, properties, applications, calendar, apply
// flow — 9 files) and taking 2 screenshots, then run out before ever
// calling task_complete to render a verdict. Confirmed via the raw log:
// iteration 40 was mid-screenshot, no verdict ever rendered. Same root
// cause pattern as RC-2 (a fixed budget that doesn't scale with real app
// size), different component (Tier-3's reality-checker, not the QA loop).
let dir: string;
function makePage(relPath: string) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, "export default function Page() { return null; }");
}

test("countAppPages counts every real page.tsx in a Next.js App Router frontend", () => {
  dir = mkdtempSync(join(tmpdir(), "tier3-count-"));
  try {
    makePage("app/page.tsx");
    makePage("app/dashboard/page.tsx");
    makePage("app/dashboard/properties/page.tsx");
    makePage("app/(auth)/sign-in/page.tsx");
    makePage("app/dashboard/layout.tsx"); // NOT a page — must not be counted
    makePage("app/globals.css"); // NOT a page
    expect(countAppPages(dir)).toBe(4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("countAppPages returns 0 for a missing/unreadable directory rather than throwing", () => {
  expect(countAppPages(join(tmpdir(), "does-not-exist-" + Date.now()))).toBe(0);
});

test("computeTier3MaxIterations scales past the shared 40-iteration default for a real multi-page app", () => {
  // complex1 had 9 real pages and hit the 40-iteration cap mid-review.
  expect(computeTier3MaxIterations(9)).toBeGreaterThan(40);
});

// 2026-08-31: floor lowered from the shared 40-iteration default to a
// Tier3-specific 25 — real evidence (a 7-page project using nearly its full
// formula-driven 67 both times reviewed) argued against touching the
// per-page formula itself, but the floor only ever bound pageCount <= 2
// (a 3-page app's own formula, 43, already exceeds 40), so a small/simple
// app is the one case a lower floor is evidence-safe to apply to.
test("computeTier3MaxIterations floors at 25 for a tiny/simple app, well under the old 40", () => {
  expect(computeTier3MaxIterations(1)).toBe(31); // formula (1*6+25=31) exceeds the new floor
  expect(computeTier3MaxIterations(0)).toBe(25); // floor binds
});

// ── shouldSkipStage2 (2026-08-31) ───────────────────────────────────────────
// Optimization: Stage 2 exists to independently re-verify Stage 1's CLAIMS;
// with zero claims there's nothing to re-verify, so a second full
// browser-driven pass is skipped. Deliberately narrow (empty only, not
// "few") — see the live incident this bar is calibrated against below.
test("shouldSkipStage2 is true when Stage 1 found nothing", () => {
  expect(shouldSkipStage2([])).toBe(true);
});

test("shouldSkipStage2 is false when Stage 1 has even one finding — independent re-verification still runs", () => {
  expect(shouldSkipStage2(["minor: heading font size looks small on mobile"])).toBe(false);
});

// 2026-08-31: real live incident (project 05b590e98102) this bar is
// calibrated against — Stage 1 handed Stage 2 a single wrong finding (a
// false confidentiality match on the required YugNex attribution footer),
// and Stage 2's independent re-verification (41 iterations) caught and
// reversed it before it reached the fix loop. A single finding must never
// be treated as "trivial enough to skip" — this asserts the exact
// single-finding case that incident represents is NOT skipped.
test("shouldSkipStage2 does not skip on a single finding, even one that later turns out to be wrong", () => {
  expect(shouldSkipStage2(['"YugNex" visible in footer text'])).toBe(false);
});
