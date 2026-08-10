import { test, expect } from "bun:test";
import { execScreenshot } from "./screenshot.ts";
import { createEvidenceLedger } from "../enforce/evidence.ts";

// These exercise the security guards, which run BEFORE any browser worker is
// spawned — so they don't require Node/Playwright/a running app.

test("execScreenshot blocks non-localhost URLs (same policy as http_request)", async () => {
  const result = await execScreenshot({ url: "https://example.com", outputPath: "shot.png" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("localhost");
});

// 2026-08-10: real gap found live (user request) — a generator can call
// `screenshot` and never actually judge the image (fonts, padding, layout),
// and nothing mechanically distinguishes that from genuine visual review —
// same class of gap Shubham's requiredEvidenceKinds(["http_check"]) already
// closed for "claims done with zero live verification." Mirrors that exact
// pattern for the visual-QA case: a blocked call (guard clause, never
// reaches the browser) must NOT record evidence — these guard-clause paths
// are the ones actually unit-testable without a real Playwright browser
// (see this file's own header comment); the success-path recording is
// verified live, matching this file's established convention for
// browser-dependent code.
test("execScreenshot does NOT record visual_check evidence when blocked by the localhost guard", async () => {
  const ledger = createEvidenceLedger();
  await execScreenshot({ url: "https://example.com", outputPath: "shot.png" }, ledger);
  expect(ledger.hasEvidenceOfKind("visual_check")).toBe(false);
});

test("execScreenshot does NOT record visual_check evidence when blocked by the path-traversal guard", async () => {
  const ledger = createEvidenceLedger();
  await execScreenshot({ url: "http://localhost:3200", outputPath: "../../etc/shot.png" }, ledger);
  expect(ledger.hasEvidenceOfKind("visual_check")).toBe(false);
});

test("execScreenshot rejects a path traversal attempt in outputPath", async () => {
  const result = await execScreenshot({ url: "http://localhost:3200", outputPath: "../../etc/shot.png" });
  expect(result.status).toBe("error");
});

test("execScreenshot rejects a sibling-directory path that shares a string prefix but is not actually inside cwd", async () => {
  const cwdName = process.cwd().split(/[\\/]/).filter(Boolean).pop()!;
  const result = await execScreenshot({ url: "http://localhost:3200", outputPath: `../${cwdName}-evil/x.png` });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("escapes the working directory");
});
