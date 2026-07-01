import type { FeatureFlags } from "./types.ts";

export function resolveFlags(): FeatureFlags {
  return {
    requireOtp: process.env.NEXSIDI_REQUIRE_OTP === "true",
    requirePayment: process.env.NEXSIDI_REQUIRE_PAYMENT === "true",
    deployTarget: process.env.NEXSIDI_DEPLOY_TARGET === "gcp" ? "gcp" : "local",
  };
}
