// Skill library — task-specific knowledge loaded on demand, the way Claude
// Code loads skills (approved 2 Oct 2026; decision D37's three levels).
//
//   1. Index: every agent's prompt lists the skills meant for it, one
//      "use when" line each.
//   2. Skill: the full SKILL.md, loaded automatically when the task text
//      matches its keywords (plain code, not left to the model — models skip
//      optional tools), or on request with the load_skill tool.
//   3. References: extra files inside a skill's folder, via load_skill(name, file).
//
// Skills live in packages/agent-runtime/skills/library/<name>/SKILL.md:
//
//   ---
//   name: dashboard-design
//   description: Use when building a dashboard page …
//   agents: [aanya]
//   keywords: [dashboard, metrics, overview]
//   ---
//   <body>
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { ToolResult } from "./tools/file.ts";
import type { NimToolDef } from "@nexsidi/llm-client";

export const SKILL_LIBRARY_DIR = join(import.meta.dir, "..", "skills", "library");

export interface Skill {
  name: string;
  description: string;
  agents: string[];
  keywords: string[];
  body: string;
}

const cache = new Map<string, Skill[]>();

function parseList(value: string): string[] {
  return value.replace(/^\[|\]$/g, "").split(",").map((v) => v.trim()).filter(Boolean);
}

function parseSkill(text: string): Skill | null {
  const match = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (kv) fields[kv[1]!] = kv[2]!.trim();
  }
  if (!fields.name || !fields.description) return null;
  return {
    name: fields.name,
    description: fields.description,
    agents: parseList(fields.agents ?? ""),
    keywords: parseList(fields.keywords ?? "").map((k) => k.toLowerCase()),
    body: match[2]!.trim(),
  };
}

export function loadSkillLibrary(dir: string = SKILL_LIBRARY_DIR): Skill[] {
  const cached = cache.get(dir);
  if (cached) return cached;
  const skills: Skill[] = [];
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir).sort()) {
      const file = join(dir, entry, "SKILL.md");
      if (!statSync(join(dir, entry)).isDirectory() || !existsSync(file)) continue;
      const skill = parseSkill(readFileSync(file, "utf-8"));
      if (skill) skills.push(skill);
    }
  }
  if (dir === SKILL_LIBRARY_DIR) cache.set(dir, skills);
  return skills;
}

/** "tilotma-reality-checker" → "tilotma": sub-agents share their agent's skills. */
export function agentBaseName(agentName: string): string {
  return agentName.split("-")[0]!.toLowerCase();
}

export function skillsForAgent(agentName: string, dir: string = SKILL_LIBRARY_DIR): Skill[] {
  const base = agentBaseName(agentName);
  return loadSkillLibrary(dir).filter((s) => s.agents.includes(base));
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function score(skill: Skill, text: string): number {
  return skill.keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${escapeRegex(k)}`, "i").test(text)).length;
}

export function renderSkillBlock(skill: Skill): string {
  return `## Skill: ${skill.name}\n\n${skill.body}`;
}

/** The skills to load in full for this task: best keyword match first, within a size budget (the best one always). */
export function selectSkills(
  args: { agentName: string; taskText: string; maxSkills?: number; maxChars?: number },
  dir: string = SKILL_LIBRARY_DIR,
): Skill[] {
  const maxSkills = args.maxSkills ?? 4;
  const maxChars = args.maxChars ?? 16_000;
  const ranked = skillsForAgent(args.agentName, dir)
    .map((skill) => ({ skill, hits: score(skill, args.taskText) }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const chosen: Skill[] = [];
  let used = 0;
  for (const { skill } of ranked) {
    const size = renderSkillBlock(skill).length;
    if (chosen.length > 0 && (chosen.length >= maxSkills || used + size > maxChars)) break;
    chosen.push(skill);
    used += size;
  }
  return chosen;
}

export function renderSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return "";
  return [
    "## Skills available to you",
    "Skills matching this task are already included below. Load any other one with load_skill(name) when the work needs it.",
    ...skills.map((s) => `- ${s.name} — ${s.description}`),
  ].join("\n");
}

/** The skill-library part of an agent's system prompt (empty when it has none). */
export function skillPromptSection(agentName: string, taskText: string, dir: string = SKILL_LIBRARY_DIR): string {
  const available = skillsForAgent(agentName, dir);
  if (available.length === 0) return "";
  const selected = selectSkills({ agentName, taskText }, dir);
  return [renderSkillIndex(available), ...selected.map(renderSkillBlock)].join("\n\n");
}

export function loadSkillText(name: string, file?: string, dir: string = SKILL_LIBRARY_DIR): ToolResult {
  const skill = loadSkillLibrary(dir).find((s) => s.name === name);
  if (!skill) return { status: "error", summary: `No skill named "${name}". Use a name from the skills list in your instructions.` };
  if (!file) return { status: "success", summary: skill.body };
  const skillDir = join(dir, name);
  const target = normalize(join(skillDir, file));
  if (!target.startsWith(skillDir + sep) || !existsSync(target)) {
    return { status: "error", summary: `Skill "${name}" has no file "${file}".` };
  }
  return { status: "success", summary: readFileSync(target, "utf-8") };
}

export const LOAD_SKILL_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "load_skill",
    description: "Load the full text of a skill from your skills list (or one of its reference files) when the work needs knowledge it covers.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name exactly as listed" },
        file: { type: "string", description: "Optional reference file inside the skill, e.g. examples.md" },
      },
      required: ["name"],
    },
  },
};
