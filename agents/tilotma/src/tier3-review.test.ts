import { test, expect } from "bun:test";
import { parseFindings, buildEvidenceCollectorTask, buildRealityCheckerTask } from "./tier3-review.ts";

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
