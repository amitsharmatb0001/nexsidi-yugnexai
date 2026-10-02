import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillLibrary, skillsForAgent, selectSkills, renderSkillIndex, loadSkillText, agentBaseName } from "./skill-library.ts";

// A skill library like Claude Code's (approved 2 Oct 2026): every agent sees
// an index of the skills meant for it, the skills matching its task are
// loaded automatically, and load_skill fetches any other one on demand.
// Before this, every agent got one fixed set of rules whatever it built.

function fixtureLibrary(): string {
  const dir = mkdtempSync(join(tmpdir(), "skill-lib-"));
  const skill = (name: string, frontmatter: string, body: string, extra?: Record<string, string>) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
    for (const [file, text] of Object.entries(extra ?? {})) writeFileSync(join(dir, name, file), text);
  };
  skill("india-gst-invoicing", "name: india-gst-invoicing\ndescription: Use when an app issues invoices with Indian GST.\nagents: [aanya, shubham, navya]\nkeywords: [gst, gstin, invoice, cgst, igst]", "# Indian GST invoicing\n\nRules here.", { "examples.md": "# Examples" });
  skill("dashboard-design", "name: dashboard-design\ndescription: Use when building a dashboard page.\nagents: [aanya]\nkeywords: [dashboard, metrics, overview]", "# Dashboards\n\nRules here.");
  skill("express-api", "name: express-api\ndescription: Use when writing the Express backend.\nagents: [shubham]\nkeywords: [express, endpoint, api]", "# Express API\n\nRules here.");
  return dir;
}

test("skills are parsed from their frontmatter", () => {
  const dir = fixtureLibrary();
  try {
    const gst = loadSkillLibrary(dir).find((s) => s.name === "india-gst-invoicing")!;
    expect(gst.description).toBe("Use when an app issues invoices with Indian GST.");
    expect(gst.agents).toEqual(["aanya", "shubham", "navya"]);
    expect(gst.keywords).toEqual(["gst", "gstin", "invoice", "cgst", "igst"]);
    expect(gst.body).toContain("# Indian GST invoicing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an agent only sees the skills meant for it, including its sub-agents", () => {
  const dir = fixtureLibrary();
  try {
    expect(agentBaseName("tilotma-reality-checker")).toBe("tilotma");
    expect(skillsForAgent("aanya", dir).map((s) => s.name).sort()).toEqual(["dashboard-design", "india-gst-invoicing"]);
    expect(skillsForAgent("shubham", dir).map((s) => s.name).sort()).toEqual(["express-api", "india-gst-invoicing"]);
    expect(skillsForAgent("riya", dir)).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("skills are selected by matching the task text, best match first", () => {
  const dir = fixtureLibrary();
  try {
    const task = "Build the dashboard for a GST invoicing app: each invoice shows CGST or IGST.";
    expect(selectSkills({ agentName: "aanya", taskText: task }, dir).map((s) => s.name)).toEqual(["india-gst-invoicing", "dashboard-design"]);
    expect(selectSkills({ agentName: "aanya", taskText: "A recipe sharing site" }, dir)).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selection stays within its size budget", () => {
  const dir = fixtureLibrary();
  try {
    const task = "dashboard gst invoice";
    const one = selectSkills({ agentName: "aanya", taskText: task, maxChars: 60 }, dir);
    expect(one.length).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the index lists each skill with its 'use when' line and how to load it", () => {
  const dir = fixtureLibrary();
  try {
    const index = renderSkillIndex(skillsForAgent("aanya", dir));
    expect(index).toContain("load_skill");
    expect(index).toContain("- dashboard-design — Use when building a dashboard page.");
    expect(renderSkillIndex([])).toBe("");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("load_skill returns a skill or one of its files, and refuses anything else", () => {
  const dir = fixtureLibrary();
  try {
    expect(loadSkillText("dashboard-design", undefined, dir)).toEqual({ status: "success", summary: expect.stringContaining("# Dashboards") });
    expect(loadSkillText("india-gst-invoicing", "examples.md", dir)).toEqual({ status: "success", summary: "# Examples" });
    expect(loadSkillText("no-such-skill", undefined, dir).status).toBe("error");
    expect(loadSkillText("dashboard-design", "../express-api/SKILL.md", dir).status).toBe("error");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("every agent loop passes its task for skill selection and handles load_skill", () => {
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts", "qa-loop.ts"]) {
    const source = require("node:fs").readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect({ file, task: /assembleSystemPrompt\(\{[^)]*taskText: /.test(source) }).toEqual({ file, task: true });
    expect({ file, tool: source.includes('case "load_skill"') }).toEqual({ file, tool: true });
  }
});
