import { test, expect } from "bun:test";
import { run, validateDesignBrief, formatDesignBriefForPrompt, buildVanyaTask, FALLBACK_BRIEF, VANYA_SYSTEM_PROMPT, type DesignBrief, type VanyaDeps } from "./index.ts";
import type { ProjectSpec } from "../../saanvi/src/index.ts";
import type { AgentRunResult } from "@nexsidi/agent-runtime";

// Vanya did not exist before this file (P3.W3.1, full agentic upgrade,
// 2026-07-24) — confirmed via repo-wide grep during this session's
// forensic audit ("Vanya has no code at all"). This is the design-identity
// step: takes a locked spec, produces a concrete design brief (palette,
// typography, layout, mood), so Aanya has something specific to implement
// instead of improvising from a one-paragraph requirements description.
//
// 2026-08-08: rewritten from a raw one-shot agentChat() call (no tools) to
// runAgentEscalated (the real agent loop, with enableWebSearch) — see
// index.ts's header comment for the full "produced one generic brief,
// never researched anything, never got its own skill doctrine" root cause.
// These tests now stub deps.runAgent (an AgentRunResult), not deps.chat.

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

function agentResult(summary: string): AgentRunResult & { escalated: boolean } {
  return { success: true, summary, filesWritten: [], iterations: 3, errors: [], escalated: false };
}

test("a well-formed agent result produces the parsed brief, no fallback", async () => {
  let calls = 0;
  const deps: VanyaDeps = {
    runAgent: async () => { calls++; return agentResult(JSON.stringify(VALID_BRIEF)); },
  };
  const brief = await run(TEST_SPEC, deps);
  expect(calls).toBe(1);
  expect(brief.mood).toBe("Confident and technical");
});

test("a brief wrapped in a markdown fence still parses correctly", async () => {
  const deps: VanyaDeps = {
    runAgent: async () => agentResult(`Here is my brief:\n\`\`\`json\n${JSON.stringify(VALID_BRIEF)}\n\`\`\``),
  };
  const brief = await run(TEST_SPEC, deps);
  expect(brief.palette).toHaveLength(3);
});

// Deliberately DIFFERENT from Saanvi's contract: a locked spec is a hard
// blocking requirement (two failures -> throw), but design is an
// enrichment that must not block generation entirely — any failure mode
// falls back to a real, specific, non-generic brief rather than crashing
// the whole pipeline over a design-brief step.
test("an agent run that throws falls back to FALLBACK_BRIEF instead of propagating", async () => {
  const deps: VanyaDeps = {
    runAgent: async () => { throw new Error("all pool models exhausted"); },
  };
  const brief = await run(TEST_SPEC, deps);
  expect(brief).toEqual(FALLBACK_BRIEF);
});

test("an unparseable summary falls back to FALLBACK_BRIEF instead of throwing", async () => {
  const deps: VanyaDeps = {
    runAgent: async () => agentResult("I looked at some sites but ran out of budget before producing a brief."),
  };
  const brief = await run(TEST_SPEC, deps);
  expect(brief).toEqual(FALLBACK_BRIEF);
});

test("a malformed JSON response (wrong shape) falls back to FALLBACK_BRIEF rather than propagating a broken brief", async () => {
  const deps: VanyaDeps = {
    runAgent: async () => agentResult(JSON.stringify({ mood: "ok" })),
  };
  const brief = await run(TEST_SPEC, deps);
  expect(brief).toEqual(FALLBACK_BRIEF);
});

test("run() passes enableWebSearch and readOnly to the agent config", async () => {
  let captured: any;
  const deps: VanyaDeps = {
    runAgent: async (config: any) => { captured = config; return agentResult(JSON.stringify(VALID_BRIEF)); },
  };
  await run(TEST_SPEC, deps);
  expect(captured.enableWebSearch).toBe(true);
  expect(captured.readOnly).toBe(true);
  expect(captured.agentName).toBe("vanya");
});

test("buildVanyaTask includes the app name, description, and features", () => {
  const task = buildVanyaTask(TEST_SPEC);
  expect(task).toContain("NexTech");
  expect(task).toContain("A B2B software company site");
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

// 2026-08-06 (live, project 88d7b375eaef): real bug found live — given a
// spec whose description said "deep midnight blue (#0B1021) background with
// off-white (#F8F9FA) content", Vanya correctly copied both exact hex
// values into the palette but SWAPPED their roles (labeled the off-white
// color "background", the midnight blue "ink") — producing a light theme
// when a dark one was explicitly specified. Caught live via the design-
// approval gate's reject-and-retry loop; this asserts the prompt fix that
// closes the gap is actually present, not just described in a commit.
test("VANYA_SYSTEM_PROMPT instructs preserving the spec's literal color-to-role pairing when one is given", () => {
  expect(VANYA_SYSTEM_PROMPT).toContain("REQUIREMENT, not a suggestion");
  expect(VANYA_SYSTEM_PROMPT).toContain("SWAPPED their roles");
});

// 2026-08-08: real gap found live, explicit user request (project
// bae438767bed) — this agent had zero research capability and produced one
// uniform look for the whole app. These assert the fixes are present in
// the actual prompt text, not just described in a commit.
test("VANYA_SYSTEM_PROMPT instructs using web_search to research the app's real domain", () => {
  expect(VANYA_SYSTEM_PROMPT).toMatch(/web_search/i);
  expect(VANYA_SYSTEM_PROMPT).toContain("Ground your decisions in something researched");
});

test("VANYA_SYSTEM_PROMPT instructs per-page emphasis variation instead of one uniform look everywhere", () => {
  expect(VANYA_SYSTEM_PROMPT).toMatch(/reads as templated/i);
  expect(VANYA_SYSTEM_PROMPT).toMatch(/emphasis shifts by page/i);
});
