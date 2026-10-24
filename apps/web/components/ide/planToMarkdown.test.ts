import { test, expect } from "bun:test";
import { planToMarkdown, planMarkdownFilename, DESIGN_SOURCE_NOTE } from "./planToMarkdown.ts";
import type { BuildPlan } from "./PlanPreview.tsx";

// Real feature request, verbatim: "add a copy buutn in the plan window & a
// downod buuton for md file or pdf". planToMarkdown is the shared source
// both the Copy button and the .md Download option read from — pinned here
// so its output can't silently drift from what PlanPreview.tsx renders.

const FULL_PLAN: BuildPlan = {
  appName: "Clario AI",
  appDescription: "Customer support automation.",
  designBrief: {
    mood: "Calm and trustworthy.",
    palette: [{ name: "accent", hex: "#2B5C58" }],
    typography: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans" },
    layoutConcept: "Spacious 12-column grid.",
  },
  features: [{ name: "Contact Inquiry System", description: "Lead-gen form.", userStories: ["As a visitor, I can submit a form."] }],
  apiContract: {
    baseUrl: "http://localhost:3001",
    endpoints: [{ method: "POST", path: "/api/v1/contact", description: "Submit inquiry", auth: false }],
  },
  dbSchema: {
    tables: [{ name: "contact_inquiries", fields: [{ name: "id", type: "uuid", primaryKey: true, nullable: false }] }],
  },
  aanyaTasks: [{ description: "Build the Home page", outputFiles: ["app/page.tsx"] }],
};

test("includes the app name as a top-level heading and the description", () => {
  const md = planToMarkdown(FULL_PLAN);
  expect(md).toContain("# Clario AI");
  expect(md).toContain("Customer support automation.");
});

test("numbers sections in the same order PlanPreview.tsx renders them", () => {
  const md = planToMarkdown(FULL_PLAN);
  const order = ["Design Direction", "Features", "API Contract", "Database Schema", "Build Plan"].map((t) => md.indexOf(t));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(md).toContain("01. Design Direction");
  expect(md).toContain("05. Build Plan");
});

test("renders the design palette as a real table, hex values included", () => {
  const md = planToMarkdown(FULL_PLAN);
  expect(md).toContain("| accent | `#2B5C58` |");
});

test("renders API endpoints with method, path, and Public/Required — matching the on-screen labels exactly", () => {
  const md = planToMarkdown(FULL_PLAN);
  expect(md).toContain("| POST | `/api/v1/contact` | Submit inquiry | Public |");
});

test("marks a primary key field with the same key marker used on screen", () => {
  const md = planToMarkdown(FULL_PLAN);
  expect(md).toContain("🔑 id");
});

test("skips a section entirely when the plan has nothing for it — no empty '## Features' heading", () => {
  const noFeatures: BuildPlan = { appName: "X", appDescription: "" };
  const md = planToMarkdown(noFeatures);
  expect(md).not.toContain("Features");
  expect(md).not.toContain("API Contract");
});

test("planMarkdownFilename slugifies the app name into a safe filename", () => {
  expect(planMarkdownFilename({ appName: "Clario AI", appDescription: "" })).toBe("clario-ai.md");
});

test("planMarkdownFilename falls back to a generic name when appName is empty", () => {
  expect(planMarkdownFilename({ appName: "   ", appDescription: "" })).toBe("project-plan.md");
});

// 2026-10-24 (Brewline): the approval page showed a silent generic fallback as if it were the designed brief. Where the
// design came from is now stated whenever it did not come from the design step.
test("says when the design was taken from the spec text or is the fixed fallback", () => {
  const base = { appName: "Brewline", appDescription: "", designBrief: { mood: "warm", palette: [{ name: "oat cream", hex: "#FAF6F0" }] } };
  expect(planToMarkdown({ ...base, designBrief: { ...base.designBrief, source: "spec" } } as never)).toContain(DESIGN_SOURCE_NOTE.spec);
  expect(planToMarkdown({ ...base, designBrief: { ...base.designBrief, source: "fallback" } } as never)).toContain(DESIGN_SOURCE_NOTE.fallback);
  expect(planToMarkdown({ ...base, designBrief: { ...base.designBrief, source: "designer" } } as never)).not.toContain(DESIGN_SOURCE_NOTE.fallback);
});
