import { test, expect } from "bun:test";
import { isPipelineBookkeeping } from "./pipeline-files.ts";

// 2026-10-13 (Shopbill run 9): the source's review cache (its scores and per-file hashes) was copied into the new app.
test("the review cache is pipeline bookkeeping, at the top level only", () => {
  expect(isPipelineBookkeeping("review-pass-cache.json")).toBe(true);
  expect(isPipelineBookkeeping("backend/review-pass-cache.json")).toBe(false);
});

test("existing bookkeeping is still recognised", () => {
  expect(isPipelineBookkeeping("history-tilotma-reality-checker.json")).toBe(true);
  expect(isPipelineBookkeeping("qa-submissions.json")).toBe(true);
  expect(isPipelineBookkeeping("backend/src/app.ts")).toBe(false);
});
