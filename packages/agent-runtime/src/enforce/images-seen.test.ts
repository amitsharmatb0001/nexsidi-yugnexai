import { expect, test } from "bun:test";
import { imagesSeenRejection, modelCanSeeImages } from "./images-seen.ts";

test("a judge that must look at the page cannot finish before it was shown a picture", () => {
  expect(imagesSeenRejection(true, 0)).toContain("screenshot");
  expect(imagesSeenRejection(true, 1)).toBeNull();
  expect(imagesSeenRejection(true, 3)).toBeNull();
});

test("a run that does not need pictures is never held up", () => {
  expect(imagesSeenRejection(undefined, 0)).toBeNull();
  expect(imagesSeenRejection(false, 0)).toBeNull();
});

// Measured 2026-10-04 (Ledgerly run 4): the design evaluator ran on a NIM text model; its
// screenshots were saved to disk and only the words "Screenshot saved" reached it.
test("only the Gemini and Claude paths send pictures to the model", () => {
  expect(modelCanSeeImages("meta/muse-glimmer-30b")).toBe(false);
  expect(modelCanSeeImages("nvidia/nemotron-3-ultra-550b-a55b")).toBe(false);
  expect(modelCanSeeImages("qwen2.5-coder:7b-instruct-q4_K_M")).toBe(false);
  expect(modelCanSeeImages("gemini-3.8-flash")).toBe(true);
});
