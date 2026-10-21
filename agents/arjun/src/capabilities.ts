// Assigning tasks to the agent whose capabilities fit them (patent claim 1(a)).
//
// The planner groups tasks under the three generator agents. That grouping comes from a model and is sometimes wrong
// (a migration listed under the backend agent, a page under the database agent), and a task built by an agent that lacks
// the skill is the kind of mistake that surfaces late. Each agent has a capability profile: the skills it has and the
// folders its work lives in. A task is checked against the profiles, and moved only on strong evidence:
//   - by its output files: every file it writes sits in another agent's folder and none in its own agent's; or
//   - for a task that names no files: its words match another agent's skills at least twice and its own agent's not at all.
// Everything else stays where the planner put it. Each decision is recorded with its reason.
import type { GeneratorTask } from "./index.ts";

export type GeneratorAgent = "shubham" | "aanya" | "pranav";

export interface AgentProfile {
  agent: GeneratorAgent;
  skills: string[];
  /** Folders (relative to the project) this agent's output lives in. */
  domains: string[];
}

export const AGENT_PROFILES: AgentProfile[] = [
  { agent: "shubham", skills: ["backend", "api", "endpoint", "route", "controller", "middleware", "express", "server", "auth", "validation", "service"], domains: ["backend/"] },
  { agent: "aanya", skills: ["frontend", "page", "component", "ui", "form", "layout", "css", "style", "screen", "navigation", "react", "nextjs"], domains: ["frontend/"] },
  { agent: "pranav", skills: ["database", "schema", "migration", "table", "sql", "index", "postgres", "constraint", "foreign key", "seed"], domains: ["db/"] },
];

export type TaskGroups = Record<GeneratorAgent, GeneratorTask[]>;

export interface TaskAssignment {
  description: string;
  from: GeneratorAgent;
  to: GeneratorAgent;
  moved: boolean;
  reason: string;
  skills: string[];
}

const AGENTS: GeneratorAgent[] = ["shubham", "aanya", "pranav"];
const norm = (p: string) => p.split("\\").join("/").replace(/^\.?\//, "");

function domainOf(file: string): GeneratorAgent | null {
  const f = norm(file);
  for (const p of AGENT_PROFILES) if (p.domains.some((d) => f.startsWith(d))) return p.agent;
  if (f.endsWith(".sql")) return "pranav";
  return null;
}

const profileOf = (agent: GeneratorAgent) => AGENT_PROFILES.find((p) => p.agent === agent)!;

function keywordHits(description: string, agent: GeneratorAgent): string[] {
  const text = description.toLowerCase();
  return profileOf(agent).skills.filter((s) => new RegExp(`\\b${s}s?\\b`).test(text));
}

/** The skills a task needs, from the folders of its files and the words of its description. */
export function requiredSkills(task: GeneratorTask): string[] {
  const out = new Set<string>();
  const area = (a: GeneratorAgent) => (a === "shubham" ? "backend" : a === "aanya" ? "frontend" : "database");
  for (const file of task.outputFiles) {
    const d = domainOf(file);
    if (d) out.add(area(d));
  }
  for (const agent of AGENTS) {
    const hits = keywordHits(task.description, agent);
    if (hits.length > 0) {
      out.add(area(agent));
      for (const s of hits) out.add(s);
    }
  }
  return [...out];
}

function commonDir(files: string[]): string {
  const parts = files.map((f) => norm(f).split("/").slice(0, -1));
  const first = parts[0] ?? [];
  const shared: string[] = [];
  for (let i = 0; i < first.length; i++) {
    if (parts.every((p) => p[i] === first[i])) shared.push(first[i]!);
    else break;
  }
  return shared.join("/") || "(root)";
}

function decide(task: GeneratorTask, from: GeneratorAgent): { to: GeneratorAgent; reason: string } {
  const files = task.outputFiles.map(domainOf);
  const known = files.filter((d): d is GeneratorAgent => d !== null);
  if (known.length > 0) {
    const own = known.filter((d) => d === from).length;
    const other = AGENTS.filter((a) => a !== from).map((a) => ({ agent: a, n: known.filter((d) => d === a).length })).sort((x, y) => y.n - x.n)[0]!;
    if (own === 0 && other.n === known.length) {
      return { to: other.agent, reason: `every output file (${commonDir(task.outputFiles)}) sits in ${other.agent}'s folder and none in ${from}'s` };
    }
    return { to: from, reason: own > 0 ? "some of its files are in its own agent's folder" : "its files do not point clearly at one agent" };
  }
  // No file with a known folder: judge by words, and only when they are clear.
  const own = keywordHits(task.description, from).length;
  const scored = AGENTS.filter((a) => a !== from).map((a) => ({ agent: a, hits: keywordHits(task.description, a) })).sort((x, y) => y.hits.length - x.hits.length)[0]!;
  if (own === 0 && scored.hits.length >= 2) return { to: scored.agent, reason: `its description matches ${scored.agent}'s skills (${scored.hits.join(", ")}) and none of ${from}'s` };
  return { to: from, reason: "no clear evidence for a different agent" };
}

/** Checks every task against the capability profiles and moves those that clearly belong elsewhere. */
export function assignBySkill(groups: TaskGroups): { groups: TaskGroups; assignments: TaskAssignment[] } {
  const next: TaskGroups = { shubham: [], aanya: [], pranav: [] };
  const arrivals: TaskGroups = { shubham: [], aanya: [], pranav: [] };
  const assignments: TaskAssignment[] = [];
  for (const from of AGENTS) {
    for (const task of groups[from]) {
      const { to, reason } = decide(task, from);
      assignments.push({ description: task.description, from, to, moved: to !== from, reason, skills: requiredSkills(task) });
      (to === from ? next[from] : arrivals[to]).push(task);
    }
  }
  for (const a of AGENTS) next[a].push(...arrivals[a]);
  return { groups: next, assignments };
}
