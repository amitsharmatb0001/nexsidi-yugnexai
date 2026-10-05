import { test, expect, afterEach } from "bun:test";
import { reviewAccountFromEnv, reviewAccountSection } from "./review-account.ts";
import { buildEvidenceCollectorTask, buildRealityCheckerTask } from "./tier3-review.ts";
import { buildLiveEvalTask } from "./live-eval.ts";

// 2026-10-05 (Amit): the review agents get a ready test account with sample data, so they can walk the whole user
// flow with real records (open, create, edit, delete, export) — and a flow that fails is caught before delivery.
const prevEmail = process.env.TIER3_REVIEW_EMAIL;
const prevPassword = process.env.TIER3_REVIEW_PASSWORD;
afterEach(() => {
  if (prevEmail === undefined) delete process.env.TIER3_REVIEW_EMAIL; else process.env.TIER3_REVIEW_EMAIL = prevEmail;
  if (prevPassword === undefined) delete process.env.TIER3_REVIEW_PASSWORD; else process.env.TIER3_REVIEW_PASSWORD = prevPassword;
});

const account = { email: "verify+review1@example.com", password: "Pw-for-tests-1aA!" };

test("reviewAccountFromEnv reads the account the stage put in the environment, and is null without it", () => {
  delete process.env.TIER3_REVIEW_EMAIL;
  delete process.env.TIER3_REVIEW_PASSWORD;
  expect(reviewAccountFromEnv()).toBeNull();
  process.env.TIER3_REVIEW_EMAIL = account.email;
  expect(reviewAccountFromEnv()).toBeNull(); // both are needed
  process.env.TIER3_REVIEW_PASSWORD = account.password;
  expect(reviewAccountFromEnv()).toEqual(account);
});

test("reviewAccountSection gives the details and asks for the full user flow", () => {
  const s = reviewAccountSection(account, { clients: 2, invoices: 2 });
  expect(s).toContain(account.email);
  expect(s).toContain(account.password);
  expect(s).toMatch(/sample/i);
  expect(s).toContain("clients");
  expect(s).toMatch(/create/i);
  expect(s).toMatch(/delete|remove/i);
  expect(s).toMatch(/new address|sign.?up/i);
  expect(reviewAccountSection(null)).toBe("");
});

test("all three review tasks include the account when one is given, and none when not", () => {
  expect(buildEvidenceCollectorTask("p", "http://a", "http://b", "shots", [], account)).toContain(account.email);
  expect(buildRealityCheckerTask("p", "http://a", "http://b", "shots", [], account)).toContain(account.email);
  expect(buildLiveEvalTask("p", "http://a", "shots", account)).toContain(account.email);
  expect(buildEvidenceCollectorTask("p", "http://a", "http://b", "shots", [], null)).not.toContain("TEST ACCOUNT");
  expect(buildLiveEvalTask("p", "http://a", "shots", null)).not.toContain("TEST ACCOUNT");
});
