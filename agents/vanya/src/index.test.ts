import { test, expect } from "bun:test";
import { run, validateDesignBrief, formatDesignBriefForPrompt, FALLBACK_BRIEF, VANYA_SYSTEM_PROMPT, type DesignBrief } from "./index.ts";
import type { ProjectSpec } from "../../saanvi/src/index.ts";

// Vanya did not exist before this file (P3.W3.1, full agentic upgrade,
// 2026-07-24) — confirmed via repo-wide grep during this session's
// forensic audit ("Vanya has no code at all"). This is the design-identity
// step: takes a locked spec, produces a concrete design brief (palette,
// typography, layout, mood), so Aanya has something specific to implement
// instead of improvising from a one-paragraph requirements description.

const TEST_SPEC: ProjectSpec = {
  projectId: "proj123",
  name: "NexTech",
  description: "A B2B software company site",
  appType: "web",
  features: [],
  auth: { provider: "custom", features: ["sign-in", "sign-up"] },
  apiEndpoints: [],
  dbTables: [],
  successCriteria: [],
  lockedAt: new Date().toISOString(),
  specHash: "deadbeef",
};

const VALID_BRIEF: DesignBrief = {
  mood: "Confident and technical",
  palette: [
    { name: "ink", hex: "#101418" },
    { name: "paper", hex: "#F5F3EE" },
    { name: "accent", hex: "#3A6EA5" },
  ],
  typography: { display: "Fraunces", body: "IBM Plex Sans" },
  layoutConcept: "Dense grid with generous padding.",
};

test("a well-formed first response does not trigger a second call at all", async () => {
  let callCount = 0;
  const stubChat = async () => {
    callCount++;
    return { content: JSON.stringify(VALID_BRIEF), modelUsed: "qwen2.5-coder:7b-instruct-q4_K_M" as const };
  };
  const brief = await run(TEST_SPEC, { chat: stubChat });
  expect(callCount).toBe(1);
  expect(brief.mood).toBe("Confident and technical");
});

test("a single empty response is retried once and succeeds on the second attempt", async () => {
  let callCount = 0;
  const stubChat = async () => {
    callCount++;
    return { content: callCount === 1 ? "" : JSON.stringify(VALID_BRIEF), modelUsed: "qwen2.5-coder:7b-instruct-q4_K_M" as const };
  };
  const brief = await run(TEST_SPEC, { chat: stubChat });
  expect(callCount).toBe(2);
  expect(brief.palette).toHaveLength(3);
});

// Deliberately DIFFERENT from Saanvi's contract: a locked spec is a hard
// blocking requirement (two failures -> throw), but design is an
// enrichment that must not block generation entirely — two failures fall
// back to a real, specific, non-generic brief rather than crashing the
// whole pipeline over a design-brief LLM call.
test("two consecutive empty/unparseable responses fall back to FALLBACK_BRIEF instead of throwing", async () => {
  const stubChat = async () => ({ content: "", modelUsed: "qwen2.5-coder:7b-instruct-q4_K_M" as const });
  const brief = await run(TEST_SPEC, { chat: stubChat });
  expect(brief).toEqual(FALLBACK_BRIEF);
});

test("a malformed JSON response (wrong shape) falls back to FALLBACK_BRIEF rather than propagating a broken brief", async () => {
  const stubChat = async () => ({ content: JSON.stringify({ mood: "ok" }), modelUsed: "qwen2.5-coder:7b-instruct-q4_K_M" as const });
  const brief = await run(TEST_SPEC, { chat: stubChat });
  expect(brief).toEqual(FALLBACK_BRIEF);
});

test("validateDesignBrief accepts a well-formed brief", () => {
  expect(validateDesignBrief(VALID_BRIEF)).toBe(true);
});

test("validateDesignBrief rejects a brief with fewer than 3 palette entries", () => {
  expect(validateDesignBrief({ ...VALID_BRIEF, palette: [{ name: "ink", hex: "#000000" }] })).toBe(false);
});

test("validateDesignBrief rejects a palette entry with an invalid hex value", () => {
  expect(validateDesignBrief({ ...VALID_BRIEF, palette: [...VALID_BRIEF.palette.slice(0, 2), { name: "bad", hex: "not-a-color" }] })).toBe(false);
});

test("validateDesignBrief rejects a brief missing typography", () => {
  const { typography, ...rest } = VALID_BRIEF;
  expect(validateDesignBrief(rest)).toBe(false);
});

test("validateDesignBrief rejects a brief with an empty layoutConcept", () => {
  expect(validateDesignBrief({ ...VALID_BRIEF, layoutConcept: "" })).toBe(false);
});

test("validateDesignBrief rejects null/non-object input", () => {
  expect(validateDesignBrief(null)).toBe(false);
  expect(validateDesignBrief("a string")).toBe(false);
  expect(validateDesignBrief(undefined)).toBe(false);
});

test("FALLBACK_BRIEF itself is a valid brief (never ships something that would fail its own validator)", () => {
  expect(validateDesignBrief(FALLBACK_BRIEF)).toBe(true);
});

test("formatDesignBriefForPrompt includes every palette entry, both typefaces, and the layout concept", () => {
  const formatted = formatDesignBriefForPrompt(VALID_BRIEF);
  expect(formatted).toContain("ink: #101418");
  expect(formatted).toContain("accent: #3A6EA5");
  expect(formatted).toContain("Fraunces");
  expect(formatted).toContain("IBM Plex Sans");
  expect(formatted).toContain("Dense grid with generous padding.");
});

test("VANYA_SYSTEM_PROMPT explicitly warns against the well-known AI-generated defaults", () => {
  expect(VANYA_SYSTEM_PROMPT).toContain("Purple-to-blue gradient");
  expect(VANYA_SYSTEM_PROMPT).toMatch(/Inter or Space Grotesk/i);
});
