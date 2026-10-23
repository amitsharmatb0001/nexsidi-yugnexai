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
  // 2026-10-23: with no account only the test-data rule is given (no account details).
  expect(reviewAccountSection(null)).not.toContain("TEST ACCOUNT");
  expect(reviewAccountSection(null)).toContain("@example.com");
});

test("all three review tasks include the account when one is given, and none when not", () => {
  expect(buildEvidenceCollectorTask("p", "http://a", "http://b", "shots", [], account)).toContain(account.email);
  expect(buildRealityCheckerTask("p", "http://a", "http://b", "shots", [], account)).toContain(account.email);
  expect(buildLiveEvalTask("p", "http://a", "shots", account)).toContain(account.email);
  expect(buildEvidenceCollectorTask("p", "http://a", "http://b", "shots", [], null)).not.toContain("TEST ACCOUNT");
  expect(buildLiveEvalTask("p", "http://a", "shots", null)).not.toContain("TEST ACCOUNT");
});

// 2026-10-05: the evidence collector ran on the NIM text model — its screenshots were saved and never shown to it,
// and today that model timed out until the review fell back and looped. Every live-review agent now runs on a
// model that is sent the pictures.
test("every live-review agent runs on a model that is shown the screenshots", async () => {
  const { readFileSync } = await import("node:fs");
  const { modelCanSeeImages } = await import("../../../packages/agent-runtime/src/enforce/images-seen.ts");
  const { REALITY_CHECKER_MODEL } = await import("./tier3-review.ts");
  expect(modelCanSeeImages(REALITY_CHECKER_MODEL)).toBe(true);
  const src = readFileSync(new URL("./tier3-review.ts", import.meta.url), "utf-8");
  const collector = src.slice(src.indexOf('agentName: "tilotma-evidence-collector"'), src.indexOf('agentName: "tilotma-evidence-collector"') + 600);
  expect(collector).toContain("model: REALITY_CHECKER_MODEL");
});

// 2026-10-23 (Trailhead rerun): the live evaluator signed up as newuser9988@outdoorcamp.test and sent the contact form as
// alex@trailtest.com; the leftovers failed the deploy's cleanliness check. Every review now carries one rule for any
// address it types into the app, with or without a ready account.
test("every live review is told to use @example.com for anything it types into the app", async () => {
  const { reviewAccountSection, TEST_DATA_RULE } = await import("./review-account.ts");
  expect(TEST_DATA_RULE).toContain("@example.com");
  expect(reviewAccountSection(null)).toContain(TEST_DATA_RULE);
  expect(reviewAccountSection({ email: "verify+r@example.com", password: "p" })).toContain(TEST_DATA_RULE);
});
