import { test, expect } from "bun:test";
import { extractFirstUrl } from "./index.ts";

// Phase 5 (full agentic upgrade): Saanvi (requirements) is a one-shot
// agentChat caller, not a tool-calling agent loop — the new fetch_url tool
// wired into loop.ts/gemini-loop.ts (research.ts) never reaches her. When a
// user says "build me a site like https://example.com" or "here's our
// current site: https://...", that URL was previously just inert text in
// the prompt. extractFirstUrl is the pure detection step; the caller (see
// runSaanvi) fetches it and injects the real content the same way
// getAttachmentsContext already injects uploaded file content.

test("extractFirstUrl finds a bare https URL in free text", () => {
  expect(extractFirstUrl("build me a site like https://example.com please")).toBe("https://example.com");
});

test("extractFirstUrl finds a URL with a path and query string", () => {
  expect(extractFirstUrl("reference: https://example.com/about?tab=team")).toBe("https://example.com/about?tab=team");
});

test("extractFirstUrl returns null when there is no URL", () => {
  expect(extractFirstUrl("build me a task manager app")).toBeNull();
});

test("extractFirstUrl strips trailing punctuation that isn't part of the URL", () => {
  expect(extractFirstUrl("check out https://example.com/about, it's great.")).toBe("https://example.com/about");
});

test("extractFirstUrl returns only the FIRST URL when multiple are present", () => {
  expect(extractFirstUrl("like https://a.com not https://b.com")).toBe("https://a.com");
});

test("extractFirstUrl ignores a bare domain with no protocol (avoids false positives on e.g. 'nextech.com' as a company name)", () => {
  expect(extractFirstUrl("our company is called nextech.com")).toBeNull();
});
