import { test, expect } from "bun:test";
import { buildAgentPrompt } from "./index.ts";

test("preview mode prompt instructs mock data, no real API calls", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("mock");
  expect(prompt).not.toContain("Bearer token from useAuth().getToken()");
});

test("integrate mode prompt instructs real API wiring", () => {
  const prompt = buildAgentPrompt("integrate");
  expect(prompt).toContain("Bearer token from useAuth().getToken()");
});
