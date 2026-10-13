import { describe, expect, test } from "bun:test";
import { POST_AUTH_PATH, fromScratchEnabled } from "./entry";

describe("where a signed-in user lands", () => {
  test("sign-in and sign-up both land on Express Build", () => {
    expect(POST_AUTH_PATH).toBe("/dashboard/express-build");
  });
});

describe("new app from scratch", () => {
  test("is hidden unless explicitly switched on", () => {
    expect(fromScratchEnabled({})).toBe(false);
    expect(fromScratchEnabled({ NEXT_PUBLIC_FROM_SCRATCH: "" })).toBe(false);
    expect(fromScratchEnabled({ NEXT_PUBLIC_FROM_SCRATCH: "0" })).toBe(false);
    expect(fromScratchEnabled({ NEXT_PUBLIC_FROM_SCRATCH: "true" })).toBe(false);
  });
  test("can be switched back on with one setting", () => {
    expect(fromScratchEnabled({ NEXT_PUBLIC_FROM_SCRATCH: "1" })).toBe(true);
  });
});
