import { test, expect } from "bun:test";
import { missedExamplesFor } from "./training-feedback.ts";

// Patent claim 4: what a reviewer has missed in training goes back into its next review.

const row = (over: Record<string, unknown> = {}) => ({ checker: "karan", id: "a1", operator: "remove-auth-check", level: 3, file: "x.ts", description: "The check that the caller is signed in is removed from a route.", before: "if (!req.user) {", after: "", hint: "auth", caught: 0, missed: 2, ...over });

test("the examples a reviewer missed are written into a block for its prompt", async () => {
  const asked: unknown[][] = [];
  const text = await missedExamplesFor("karan", { store: { missedFor: async (...a) => (asked.push(a), [row()]) } });
  expect(text).toContain("missed before");
  expect(text).toContain("remove-auth-check");
  expect(asked[0]).toEqual(["karan", 5, 5]);
});

test("with no examples, or a store that fails, the reviewer's input is unchanged", async () => {
  expect(await missedExamplesFor("karan", { store: { missedFor: async () => [] } })).toBe("");
  expect(await missedExamplesFor("karan", { store: { missedFor: async () => { throw new Error("no database"); } } })).toBe("");
});

test("the block is capped at the limit asked for", async () => {
  const many = Array.from({ length: 9 }, (_, i) => row({ id: `a${i}` }));
  const text = await missedExamplesFor("karan", { limit: 3, store: { missedFor: async () => many } });
  expect(text.split("\n").filter((l) => l.startsWith("- ")).length).toBe(3);
});
