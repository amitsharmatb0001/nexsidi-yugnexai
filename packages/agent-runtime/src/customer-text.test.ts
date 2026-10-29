import { test, expect } from "bun:test";
import { internalTermsIn, toCustomerText } from "./customer-text.ts";

// 2026-10-29 (Amit, stage 2): a question that reaches the customer must read like an ordinary chat message. Agent names,
// the number of agents and how the system is built never appear in anything a customer sees (CLAUDE.md confidentiality).

test("agent names, roles and internal words are found", () => {
  expect(internalTermsIn("Tilotma asked the backend builder; the reviewers ran on Gemini")).toEqual(
    expect.arrayContaining(["Tilotma", "backend builder", "reviewers", "Gemini"]),
  );
});

test("an ordinary question has no internal terms and is not changed", () => {
  const q = "What are your store's opening hours, for each day of the week?";
  expect(internalTermsIn(q)).toEqual([]);
  expect(toCustomerText(q)).toBe(q);
});

test("a question naming an agent or a role is rewritten without them", () => {
  for (const q of [
    "Shubham needs to know the store hours so the pickup slots are right.",
    "The backend builder and the frontend builder need the deposit amount for a damaged item.",
    "The Chief AI could not find the tax rate in the spec; the reviewers will check it.",
    "The agents in the pipeline need your delivery fee (Gemini could not find it).",
  ]) {
    const out = toCustomerText(q);
    expect(internalTermsIn(out)).toEqual([]);
    expect(out.length).toBeGreaterThan(10);
  }
});

test("the rewrite reads as plain English", () => {
  expect(toCustomerText("Shubham needs to know the store hours so the pickup slots are right.")).toBe("We need to know the store hours so the pickup slots are right.");
  expect(toCustomerText("The agents in the pipeline need your delivery fee (Gemini could not find it).")).toBe("We need your delivery fee (we could not find it).");
});

test("words that only contain a name are left alone", () => {
  expect(internalTermsIn("Our development team serves a raj-style thali")).toEqual([]);
});

// 2026-10-29 (stage 2 proof on Brewline 3): "Shubham, the backend builder, needs …" became "We, we, needs …".
test("a name with its role in commas becomes one plain 'we'", () => {
  expect(toCustomerText("Shubham, the backend builder, needs your store's opening and closing times for each day of the week.")).toBe(
    "We need your store's opening and closing times for each day of the week.",
  );
});
