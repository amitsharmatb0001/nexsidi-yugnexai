import { test, expect } from "bun:test";
import { buildToolList } from "./loop.ts";

test("buildToolList excludes web_search and screenshot by default", () => {
  const tools = buildToolList({ agentName: "x", model: "moonshotai/kimi-k2.6", apiKey: "k", systemPrompt: "s", initialMessage: "m", sandboxDir: "/tmp" } as any);
  const names = tools.map(t => t.function.name);
  expect(names).not.toContain("web_search");
  expect(names).not.toContain("screenshot");
});

test("buildToolList includes web_search and screenshot when enabled", () => {
  const tools = buildToolList({ agentName: "x", model: "moonshotai/kimi-k2.6", apiKey: "k", systemPrompt: "s", initialMessage: "m", sandboxDir: "/tmp", enableWebSearch: true, enableScreenshot: true } as any);
  const names = tools.map(t => t.function.name);
  expect(names).toContain("web_search");
  expect(names).toContain("screenshot");
});
