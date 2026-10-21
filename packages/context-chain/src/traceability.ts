// Bidirectional traceability between requirements and code (patent claim 3).
//
// The graph has three layers and no cycles: requirement -> task -> file. A requirement is linked to a task when the task's
// wording (its description and the names of the files it must produce) contains words that are distinctive to that
// requirement's name. A task is linked to a file when the file it was told to produce really exists in the code map.
// Every link carries the reason it was made, so a person can see why a file is tied to a requirement and reject a
// wrong link. Nothing is invented: a requirement no task matches is reported as untraced, and a file no task produced
// is reported as unlinked.
//
// Forward: filesForRequirement. Backward: requirementsForFile. Impact: requirementsAffectedBy also follows the code map's
// dependency graph, so a change to a shared helper reaches the requirements of every file that imports it.
import { createHash } from "node:crypto";
import { dependentsOf, type CodeMap } from "./code-map.ts";

export interface TraceInput {
  features: Array<{ name: string; description?: string }>;
  tasks: Array<{ agent: string; description: string; outputFiles: string[] }>;
}

export interface TraceRequirement {
  id: string;
  name: string;
}
export interface TraceTask {
  id: string;
  agent: string;
  description: string;
}
export interface TraceEdge {
  from: string;
  to: string;
  kind: "requirement-task" | "task-file";
  reason: string;
}
export interface TraceGraph {
  version: 1;
  requirements: TraceRequirement[];
  tasks: TraceTask[];
  edges: TraceEdge[];
  untracedRequirements: string[];
  unlinkedFiles: string[];
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "your", "their", "its", "are", "can", "will", "all", "any", "has", "have",
  "page", "pages", "feature", "features", "company", "overview", "showcase", "portal", "implement", "create", "build", "add", "using", "use",
  "src", "index", "app", "lib", "component", "components", "through", "each", "per", "set", "setup", "support",
  // file extensions are not words about the work
  "tsx", "jsx", "json", "sql", "css", "mjs", "cjs", "html", "yml", "yaml",
]);

/** Lowercase words of three or more letters, filler words removed, simple plurals folded, camelCase and path parts split. */
export function tokenize(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const out: string[] = [];
  for (const raw of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    let w = raw;
    if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is") && w.length > 4) w = w.slice(0, -1);
    if (!STOP.has(w)) out.push(w);
  }
  return out;
}

const reqId = (name: string) => `REQ-${createHash("sha256").update(name.trim().toLowerCase()).digest("hex").slice(0, 6)}`;
const PREFIXES: Record<string, string[]> = {
  shubham: ["backend/", "db/", "", "frontend/"],
  aanya: ["frontend/", "", "backend/", "db/"],
  pranav: ["db/", "backend/", "", "frontend/"],
};
// Where each agent's own files live (for the by-path rule; the by-declared-name lookup also tries the others).
const OWN_FOLDERS: Record<string, string[]> = { shubham: ["backend/"], aanya: ["frontend/"], pranav: ["db/", "backend/"] };
const WEAK_MATCHES_NEEDED = 3;
// Words that name a kind of file, not what it is about; matching on these would tie unrelated files to every task.
const GENERIC_PATH_WORDS = new Set(["index", "types", "type", "layout", "config", "global", "globals", "request", "response", "main", "server", "util", "utils", "helper", "helpers", "middleware", "route", "controller", "model", "schema", "migration", "style", "styles", "css", "test", "tests", "spec", "env", "package", "tsconfig", "next", "drizzle", "express", "error", "errors", "init", "initial", "common", "shared", "base", "default", "constants"]);

export function buildTraceGraph(input: TraceInput, map: CodeMap): TraceGraph {
  const present = new Set(map.files.map((f) => f.path));
  const requirements = input.features
    .map((f) => ({ id: reqId(f.name), name: f.name.trim(), nameTokens: [...new Set(tokenize(f.name))], descTokens: [...new Set(tokenize(f.description ?? ""))] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // A word that appears in several requirement names ("client", "service") says little about any one of them.
  const nameFreq = new Map<string, number>();
  for (const r of requirements) for (const t of r.nameTokens) nameFreq.set(t, (nameFreq.get(t) ?? 0) + 1);

  const counters = new Map<string, number>();
  const tasks = input.tasks.map((t) => {
    const n = (counters.get(t.agent) ?? 0) + 1;
    counters.set(t.agent, n);
    const words = new Set([...tokenize(t.description), ...t.outputFiles.flatMap((f) => tokenize(f))]);
    return { id: `T-${t.agent}-${n}`, agent: t.agent, description: t.description, outputFiles: t.outputFiles, words };
  });

  const edges: TraceEdge[] = [];
  for (const r of requirements) {
    const distinctive = r.nameTokens.filter((t) => (nameFreq.get(t) ?? 0) === 1);
    for (const t of tasks) {
      const strong = distinctive.filter((w) => t.words.has(w));
      if (strong.length > 0) {
        edges.push({ from: r.id, to: t.id, kind: "requirement-task", reason: `task wording matches "${strong.join('", "')}" from the requirement name` });
        continue;
      }
      const weak = r.descTokens.filter((w) => t.words.has(w));
      if (weak.length >= WEAK_MATCHES_NEEDED) {
        edges.push({ from: r.id, to: t.id, kind: "requirement-task", reason: `task wording matches ${weak.length} words of the requirement description (${weak.slice(0, 4).join(", ")})` });
      }
    }
  }

  const linkedFiles = new Set<string>();
  for (const t of tasks) {
    for (const declared of t.outputFiles) {
      const norm = declared.split("\\").join("/").replace(/^\.?\//, "");
      const found = (PREFIXES[t.agent] ?? ["", "backend/", "frontend/", "db/"]).map((p) => p + norm).find((p) => present.has(p));
      if (found) {
        edges.push({ from: t.id, to: found, kind: "task-file", reason: "output file declared by the task exists" });
        linkedFiles.add(found);
      }
    }
  }
  // Second rule: the generators often name files differently from the plan. A file in the folders of the task's agent that no
  // task named is linked to a task when a word in its path (other than generic ones) appears in that task's wording.
  for (const file of [...present].sort()) {
    if (linkedFiles.has(file)) continue;
    const fileWords = [...new Set(tokenize(file))].filter((w) => !GENERIC_PATH_WORDS.has(w));
    if (fileWords.length === 0) continue;
    for (const t of tasks) {
      const folders = OWN_FOLDERS[t.agent] ?? [];
      if (!folders.some((p) => file.startsWith(p))) continue;
      const hit = fileWords.filter((w) => t.words.has(w));
      if (hit.length > 0) {
        edges.push({ from: t.id, to: file, kind: "task-file", reason: `file path matches "${hit.join('", "')}" in the task wording (not the file the plan named)` });
        linkedFiles.add(file);
      }
    }
  }
  edges.sort((a, b) => a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const graph: TraceGraph = {
    version: 1,
    requirements: requirements.map(({ id, name }) => ({ id, name })),
    tasks: tasks.map(({ id, agent, description }) => ({ id, agent, description })),
    edges,
    untracedRequirements: [],
    unlinkedFiles: [...present].filter((p) => !linkedFiles.has(p)).sort(),
  };
  graph.untracedRequirements = graph.requirements.filter((r) => filesForRequirement(graph, r.id).length === 0).map((r) => r.id);
  return graph;
}

/** Forward: the files that implement a requirement. */
export function filesForRequirement(g: TraceGraph, id: string): string[] {
  const taskIds = new Set(g.edges.filter((e) => e.kind === "requirement-task" && e.from === id).map((e) => e.to));
  return [...new Set(g.edges.filter((e) => e.kind === "task-file" && taskIds.has(e.from)).map((e) => e.to))].sort();
}

export interface FileRequirement {
  id: string;
  name: string;
  reasons: string[];
}

/** Backward: the requirements a file serves, with the reason for each link. */
export function requirementsForFile(g: TraceGraph, file: string): FileRequirement[] {
  const taskIds = g.edges.filter((e) => e.kind === "task-file" && e.to === file).map((e) => e.from);
  const out = new Map<string, FileRequirement>();
  for (const e of g.edges) {
    if (e.kind !== "requirement-task" || !taskIds.includes(e.to)) continue;
    const req = g.requirements.find((r) => r.id === e.from)!;
    const entry = out.get(req.id) ?? { id: req.id, name: req.name, reasons: [] };
    entry.reasons.push(e.reason);
    out.set(req.id, entry);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Impact: the requirements touched by a change to `file`, including those of every file that depends on it. */
export function requirementsAffectedBy(g: TraceGraph, map: CodeMap, file: string): FileRequirement[] {
  const merged = new Map<string, FileRequirement>();
  for (const f of [file, ...dependentsOf(map, file)]) {
    for (const r of requirementsForFile(g, f)) {
      const e = merged.get(r.id) ?? { id: r.id, name: r.name, reasons: [] };
      for (const reason of r.reasons) if (!e.reasons.includes(reason)) e.reasons.push(reason);
      merged.set(r.id, e);
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
