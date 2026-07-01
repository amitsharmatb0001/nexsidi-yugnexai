import { test, expect } from "bun:test";
import { resolveFlags } from "./flags.ts";

test("resolveFlags defaults to demo-safe values with no env vars set", () => {
  delete process.env.NEXSIDI_REQUIRE_OTP;
  delete process.env.NEXSIDI_REQUIRE_PAYMENT;
  delete process.env.NEXSIDI_DEPLOY_TARGET;
  expect(resolveFlags()).toEqual({ requireOtp: false, requirePayment: false, deployTarget: "local" });
});

test("resolveFlags respects env var overrides", () => {
  process.env.NEXSIDI_REQUIRE_OTP = "true";
  process.env.NEXSIDI_DEPLOY_TARGET = "gcp";
  expect(resolveFlags()).toEqual({ requireOtp: true, requirePayment: false, deployTarget: "gcp" });
  delete process.env.NEXSIDI_REQUIRE_OTP;
  delete process.env.NEXSIDI_DEPLOY_TARGET;
});
