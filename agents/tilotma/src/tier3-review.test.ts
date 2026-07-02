import { test, expect } from "bun:test";
import { parseFindings } from "./tier3-review.ts";

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
