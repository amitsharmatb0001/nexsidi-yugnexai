// The context object for the handoff that carries generated code (patent claims 1 and 3).
//
// Before this the handoff held only the sorted list of file names. It now also holds the code map (packages/context-chain
// code-map.ts): per-file hashes, syntax-structure digests, imports/exports/symbols, the dependency graph and import
// cycles, the rules from the plan, and the error records found in the code itself. Recording and checking both build it
// with the same function, from the files on disk, so they agree unless a file really changed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCodeMap, type CodeMap } from "../../packages/context-chain/src/code-map.ts";
import { buildTraceGraph, type TraceGraph, type TraceInput } from "../../packages/context-chain/src/traceability.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The rules the code has to follow, as plain sentences, read from the plan. Anything missing or malformed is skipped. */
export function rulesFromPlan(plan: unknown): string[] {
  if (!isObj(plan)) return [];
  const rules: string[] = [];
  if (Array.isArray(plan.features)) {
    for (const f of plan.features) if (isObj(f) && typeof f.name === "string") rules.push(`Feature required: ${f.name}`);
  }
  const endpoints = isObj(plan.apiContract) && Array.isArray(plan.apiContract.endpoints) ? plan.apiContract.endpoints : [];
  for (const e of endpoints) {
    if (isObj(e) && typeof e.method === "string" && typeof e.path === "string") {
      rules.push(`Endpoint ${e.method} ${e.path} must exist and must ${e.auth ? "require" : "not require"} sign-in`);
    }
  }
  const tables = isObj(plan.dbSchema) && Array.isArray(plan.dbSchema.tables) ? plan.dbSchema.tables : [];
  for (const t of tables) {
    if (isObj(t) && typeof t.name === "string" && Array.isArray(t.columns)) {
      const cols = t.columns.map((c) => (isObj(c) && typeof c.name === "string" ? c.name : null)).filter((c): c is string => c !== null);
      rules.push(`Table ${t.name} must have columns: ${cols.join(", ")}`);
    }
  }
  return rules;
}

// Which files the map describes. Source code and SQL only: build tools rewrite files such as tsconfig.json, package.json and
// next-env.d.ts on their own, and counting those would make a healthy project look changed between record and check and
// roll it back. The file LIST in the handoff still names every file.
const MAPPED = /\.(ts|tsx|js|jsx|mjs|cjs|sql|css)$/;
const TOOL_MANAGED = /(^|\/)next-env\.d\.ts$/;
export const isMappedFile = (path: string): boolean => MAPPED.test(path) && !TOOL_MANAGED.test(path);

/** The plan's features and its three task lists, in the shape the traceability graph takes. Malformed parts are skipped. */
export function traceInputFromPlan(plan: unknown): TraceInput {
  const out: TraceInput = { features: [], tasks: [] };
  if (!isObj(plan)) return out;
  if (Array.isArray(plan.features)) {
    for (const f of plan.features) if (isObj(f) && typeof f.name === "string") out.features.push({ name: f.name, description: typeof f.description === "string" ? f.description : "" });
  }
  for (const [key, agent] of [["shubhamTasks", "shubham"], ["aanyaTasks", "aanya"], ["pranavTasks", "pranav"]] as const) {
    const list = plan[key];
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (isObj(t) && typeof t.description === "string") out.tasks.push({ agent, description: t.description, outputFiles: Array.isArray(t.outputFiles) ? t.outputFiles.filter((f): f is string => typeof f === "string") : [] });
    }
  }
  return out;
}

/** `manifest` is the filtered, sorted file list (filterSourceManifest). The result is what gets hashed and chained. */
export function buildHandoffContext(
  buildDir: string,
  manifest: { filesWritten: string[] },
  plan: unknown,
): { filesWritten: string[]; codeMap: CodeMap; traceability: TraceGraph } {
  const codeMap = buildCodeMap(buildDir, manifest.filesWritten.filter(isMappedFile), { rules: rulesFromPlan(plan) });
  return { filesWritten: manifest.filesWritten, codeMap, traceability: buildTraceGraph(traceInputFromPlan(plan), codeMap) };
}

/** The code map from the newest handoff file in a project's folder that has one, or null. */
export function latestCodeMap(buildDir: string): CodeMap | null {
  const dir = join(buildDir, ".nexsidi", "handoffs");
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort().reverse();
  for (const n of names) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, n), "utf8")) as { codeMap?: CodeMap };
      if (parsed.codeMap && parsed.codeMap.version === 1) return parsed.codeMap;
    } catch {
      // an unreadable handoff file is skipped, not fatal
    }
  }
  return null;
}
