import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadSkillLibrary, selectSkills, skillPromptSection, SKILL_LIBRARY_DIR } from "./skill-library.ts";

// The first skills (2 Oct 2026), written from what real builds got wrong.
// These tests keep the library well-formed and prove the right skills reach
// the right agents for a real brief.

const KNOWN_AGENTS = ["planner", "saanvi", "arjun", "vanya", "aanya", "shubham", "pranav", "navya", "karan", "deepika", "tilotma", "riya"];

const LEDGERLY_BRIEF = "Build Ledgerly — GST invoicing for freelancers in India. I add, edit and delete clients. I create an invoice with line items; GST is 18% of the subtotal; money must be exact to the paisa. Invoice numbers run in order per account. Dashboard: total invoiced this month. Search invoices. Amounts in rupees with Indian digit grouping. My data is private.";

test("every skill is well-formed: folder name, 'use when' description, known agents, keywords", () => {
  const skills = loadSkillLibrary();
  const folders = readdirSync(SKILL_LIBRARY_DIR).sort();
  expect(skills.map((s) => s.name).sort()).toEqual(folders);
  expect(skills.length).toBeGreaterThanOrEqual(20);
  for (const s of skills) {
    expect({ skill: s.name, description: s.description.startsWith("Use when") || s.description.startsWith("Use for") }).toEqual({ skill: s.name, description: true });
    expect({ skill: s.name, unknown: s.agents.filter((a) => !KNOWN_AGENTS.includes(a)) }).toEqual({ skill: s.name, unknown: [] });
    expect({ skill: s.name, enoughKeywords: s.keywords.length >= 3 }).toEqual({ skill: s.name, enoughKeywords: true });
    expect(s.body.length).toBeGreaterThan(200);
  }
});

test("for a GST invoicing brief, the backend and frontend builders get the GST and money skills", () => {
  for (const agent of ["shubham", "aanya"]) {
    const names = selectSkills({ agentName: agent, taskText: LEDGERLY_BRIEF }).map((s) => s.name);
    expect({ agent, gst: names.includes("india-gst-invoicing"), money: names.includes("money-exact") }).toEqual({ agent, gst: true, money: true });
  }
});

test("for any brief, the planning agents get the requirements-coverage skill", () => {
  for (const agent of ["planner", "saanvi", "arjun"]) {
    expect({ agent, has: skillPromptSection(agent, LEDGERLY_BRIEF).includes("## Skill: requirements-coverage") }).toEqual({ agent, has: true });
  }
});

test("a skill section stays a reasonable size", () => {
  expect(skillPromptSection("aanya", LEDGERLY_BRIEF).length).toBeLessThan(24_000);
});

test("the spec, plan and planning agents include their skill section in their prompts", () => {
  const files = {
    saanvi: "../../../agents/saanvi/src/index.ts",
    arjun: "../../../agents/arjun/src/index.ts",
    planner: "../../../agents/planner/src/index.ts",
  };
  for (const [agent, rel] of Object.entries(files)) {
    const source = readFileSync(new URL(rel, import.meta.url), "utf-8");
    expect({ agent, wired: source.includes(`skillPromptSection("${agent}"`) }).toEqual({ agent, wired: true });
  }
});

// 2026-10-02 (Ledgerly benchmark run 2): the brief said "INV-2026-0001,
// INV-2026-0002"; the plan said only "sequential invoices", so the backend
// built INV-0001. Exact formats and examples must be copied, not paraphrased.
test("requirements-coverage tells planners to copy the user's exact formats and examples", () => {
  const skill = loadSkillLibrary().find((s) => s.name === "requirements-coverage")!;
  expect(skill.body).toContain("INV-2026-0001");
  expect(skill.body.toLowerCase()).toContain("word for word");
});

// 2026-10-02 (approved by Amit): every agent does only its own work and
// reports instead of assuming.
test("the core rules every agent gets say: own work only, never assume, report_blocked", () => {
  const core = readFileSync(new URL("../skills/core-reasoning.md", import.meta.url), "utf-8");
  expect(core).toContain("OWN WORK ONLY");
  expect(core).toContain("report_blocked");
  expect(core.toLowerCase()).toContain("never assume");
});

// 2026-10-29 (team plan, stage 1): the tools let every agent read the whole project; the rules must say the same.
test("the core rules let an agent read any folder and change only its own", () => {
  const core = readFileSync(new URL("../skills/core-reasoning.md", import.meta.url), "utf-8");
  expect(core).not.toContain("Never read, edit, run");
  expect(core).toContain("Read any file of the project");
});
