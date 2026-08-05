import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parseFindings, buildEvidenceCollectorTask, buildRealityCheckerTask, countAppPages, computeTier3MaxIterations } from "./tier3-review.ts";

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

test("computeTier3MaxIterations never drops below the shared default for a small/simple app", () => {
  expect(computeTier3MaxIterations(1)).toBeGreaterThanOrEqual(40);
  expect(computeTier3MaxIterations(0)).toBeGreaterThanOrEqual(40);
});
