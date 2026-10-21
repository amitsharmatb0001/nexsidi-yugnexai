// Runs the security pattern database over a project's generated code and package files (patent claim 8), and turns the result
// into leads for the security reviewer. No model is used and nothing is fixed here: it only finds and points.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  scanSource, scanDependencies, SEED_PATTERNS, SEED_ADVISORIES,
  type SecurityPattern, type Advisory, type PatternHit, type DependencyHit,
} from "../../../packages/agent-runtime/src/security/pattern-scan.ts";
import { analyzeTaint, type TaintFinding } from "../../../packages/agent-runtime/src/security/taint.ts";

export interface SecurityScanResult {
  patternHits: PatternHit[];
  dependencyHits: DependencyHit[];
  /** Untrusted request data followed to a dangerous call (taint analysis). */
  taintFindings: TaintFinding[];
  patternsUsed: number;
  advisoriesUsed: number;
  /** Where the patterns came from. */
  source: "database" | "built-in";
}

export interface SecurityScanDeps {
  load?: () => Promise<{ patterns: SecurityPattern[]; advisories: Advisory[]; source: "database" | "built-in" }>;
}

/** The database entries, with the built-in ones filling any key the database lacks; the built-in lists alone if the database cannot be reached. */
export async function loadPatternDatabase(): Promise<{ patterns: SecurityPattern[]; advisories: Advisory[]; source: "database" | "built-in" }> {
  try {
    const db = await import("@nexsidi/db");
    const [patterns, advisories] = await Promise.all([db.loadSecurityPatterns(), db.loadSecurityAdvisories()]);
    if (patterns.length === 0 && advisories.length === 0) throw new Error("empty");
    const byKey = new Map(SEED_PATTERNS.map((p) => [p.key, p]));
    for (const p of patterns) byKey.set(p.key, p);
    const seen = new Set(advisories.map((a) => `${a.id}|${a.package}|${a.range}`));
    return {
      patterns: [...byKey.values()],
      advisories: [...advisories, ...SEED_ADVISORIES.filter((a) => !seen.has(`${a.id}|${a.package}|${a.range}`))],
      source: "database",
    };
  } catch {
    return { patterns: SEED_PATTERNS, advisories: SEED_ADVISORIES, source: "built-in" };
  }
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", ".nexsidi", "vendor"]);

function walk(dir: string, rel = ""): string[] {
  let names: string[];
  try {
    names = readdirSync(join(dir, rel));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const path = rel ? `${rel}/${n}` : n;
    if (SKIP_DIRS.has(n)) return [];
    try {
      return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
    } catch {
      return [];
    }
  });
}

function installedVersions(dir: string, packageFile: string, names: string[]): Record<string, string> {
  const base = packageFile.includes("/") ? packageFile.slice(0, packageFile.lastIndexOf("/")) : "";
  const out: Record<string, string> = {};
  for (const n of names) {
    const f = join(dir, base, "node_modules", n, "package.json");
    if (!existsSync(f)) continue;
    try {
      const v = JSON.parse(readFileSync(f, "utf8")).version;
      if (typeof v === "string") out[n] = v;
    } catch {
      // unreadable: the written range is used
    }
  }
  return out;
}

export async function scanBuildDirForSecurity(buildDir: string, deps: SecurityScanDeps = {}): Promise<SecurityScanResult> {
  const { patterns, advisories, source } = await (deps.load ?? loadPatternDatabase)();
  const patternHits: PatternHit[] = [];
  const dependencyHits: DependencyHit[] = [];
  const taintFindings: TaintFinding[] = [];
  for (const rel of walk(buildDir)) {
    const full = join(buildDir, rel);
    if (rel.endsWith("package.json")) {
      try {
        const text = readFileSync(full, "utf8");
        const parsed = JSON.parse(text) as { dependencies?: object; devDependencies?: object };
        const names = [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})];
        dependencyHits.push(...scanDependencies(rel, text, advisories, installedVersions(buildDir, rel, names)));
      } catch {
        // not valid JSON: nothing to report
      }
    } else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) {
      try {
        const text = readFileSync(full, "utf8");
        patternHits.push(...scanSource(rel, text, patterns));
        // Server code only: that is where request data meets a database, a shell, the disk or the network.
        if (/^(?:backend\/|frontend\/app\/api\/)/.test(rel)) taintFindings.push(...analyzeTaint(rel, text));
      } catch {
        // unreadable file: skipped
      }
    }
  }
  return { patternHits, dependencyHits, taintFindings, patternsUsed: patterns.length, advisoriesUsed: advisories.length, source };
}

const ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

/** Leads for the reviewer, worst first and capped. "" when nothing was found. */
export function formatScanForReviewer(r: SecurityScanResult, limit = 25): string {
  type Lead = { rank: number; line: string };
  const leads: Lead[] = [
    ...r.patternHits.map((h): Lead => ({ rank: ORDER[h.severity], line: `- [${h.severity}] ${h.file}:${h.line} ${h.key} (${h.cwe}, ${h.category.split(" ")[0]}): ${h.evidence}` })),
    // A traced path from the request to a dangerous call is the strongest lead, so it sorts ahead of a pattern of the same severity.
    ...r.taintFindings.map((f): Lead => ({ rank: ORDER[f.severity] - 0.5, line: `- [${f.severity}] ${f.file}:${f.sink.line} ${f.kind} (${f.cwe}): ${f.message}` })),
    ...r.dependencyHits.map((h): Lead => ({ rank: ORDER[h.severity], line: `- [${h.severity}] ${h.file}: ${h.package}@${h.version} is affected by ${h.advisoryId} (${h.summary}); fixed in ${h.fixedIn}` })),
  ].sort((a, b) => a.rank - b.rank);
  if (leads.length === 0) return "";
  const shown = leads.slice(0, limit).map((l) => l.line);
  const more = leads.length > limit ? `\n(${leads.length - limit} more not shown)` : "";
  return `AUTOMATED PATTERN SCAN (security pattern database: ${r.patternsUsed} code patterns, ${r.advisoriesUsed} package advisories). These are leads, not verdicts: confirm each one in the code before reporting it, and drop any that is not a real flaw.\n${shown.join("\n")}${more}`;
}
