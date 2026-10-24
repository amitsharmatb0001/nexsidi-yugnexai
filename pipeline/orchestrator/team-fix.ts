// Fix rounds as a team (2026-10-24, docs/plan/2026-10-24-final-plan.md section 3). Brewline's frontend fix round took
// 23–31 model calls one after another for 5 findings across 5 files. Findings are grouped by the file they name; up to 3
// helpers fix their own files at the same time (flash, own files only, type check only — see teamRunOverrides), then the
// lead (pro) handles findings without a file and anything a helper could not finish, checks the helpers' fixes, and
// runs the full build and checks once. Few findings, one file, or NEXSIDI_BUILDER_TEAMS=off: the single fix run.
import { builderTeamsOn } from "../activities/build-phases.ts";
import type { BuildPlan } from "../../agents/arjun/src/index.ts";
import type { Escalation } from "../../packages/agent-runtime/src/tools/escalate.ts";

export type TeamFixRole = { role?: "helper" | "integrate"; ownFiles?: string[]; helperIndex?: number };
type FixResult = { success: boolean; escalations?: Escalation[]; filesWritten?: string[]; errors?: string[] };
export type ScopedFix<R extends FixResult = FixResult> = (plan: BuildPlan, findings: string[], team?: TeamFixRole) => Promise<R>;

const MAX_HELPERS = 3;
const MIN_FINDINGS = 3;

/** The source file a finding names, relative to the builder's own folder (null when it names none). */
export function fileOfFinding(finding: string, owner: "aanya" | "shubham" | "pranav"): string | null {
  const root = owner === "aanya" ? "frontend" : owner === "shubham" ? "backend" : "db";
  const m = finding.match(new RegExp(`(?:^|[\\s\`'"(])${root}/([\\w.\\-/[\\]()@]+\\.(?:tsx?|jsx?|css|sql|json))`, "i"));
  return m ? m[1]! : null;
}

/** Returns what the builder's own fix returns (the lead's result), with escalations, files and errors of every step merged. */
export async function runFixAsTeam<R extends FixResult>(
  owner: "aanya" | "shubham" | "pranav",
  plan: BuildPlan,
  findings: string[],
  fix: ScopedFix<R>,
): Promise<R> {
  if (!builderTeamsOn() || owner === "pranav" || findings.length < MIN_FINDINGS) return fix(plan, findings);
  const byFile = new Map<string, string[]>();
  const unfiled: string[] = [];
  for (const f of findings) {
    const file = fileOfFinding(f, owner);
    if (file) byFile.set(file, [...(byFile.get(file) ?? []), f]);
    else unfiled.push(f);
  }
  if (byFile.size < 2) return fix(plan, findings);

  // Files are atomic: all findings about one file go to the same helper. Balanced by number of findings.
  const groups: Array<{ files: string[]; findings: string[] }> = Array.from({ length: Math.min(MAX_HELPERS, byFile.size) }, () => ({ files: [], findings: [] }));
  for (const [file, fs] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const lightest = groups.reduce((best, g) => (g.findings.length < best.findings.length ? g : best), groups[0]!);
    lightest.files.push(file);
    lightest.findings.push(...fs);
  }
  console.log(`[team-fix] ${owner}: ${findings.length} findings — ${groups.length} helpers fix their own files at the same time, then the lead checks the whole`);
  const helperResults = await Promise.all(
    groups.map((g, i) => fix(plan, g.findings, { role: "helper", helperIndex: i, ownFiles: g.files }).then((r) => ({ g, r }))),
  );
  const fixed = helperResults.filter((h) => h.r.success).flatMap((h) => h.g.findings);
  const open = helperResults.filter((h) => !h.r.success).flatMap((h) => h.g.findings);
  const leadFindings = [
    ...unfiled,
    ...open,
    ...fixed.map((f) => `ALREADY FIXED BY A HELPER — check the fix is right and the build passes; change nothing else: ${f}`),
  ];
  const lead = await fix(plan, leadFindings, { role: "integrate" });
  return {
    ...lead,
    escalations: [...helperResults.flatMap((h) => h.r.escalations ?? []), ...(lead.escalations ?? [])],
    filesWritten: [...new Set([...helperResults.flatMap((h) => h.r.filesWritten ?? []), ...(lead.filesWritten ?? [])])],
    ...(lead.errors ? { errors: [...helperResults.filter((h) => !h.r.success).flatMap((h) => h.r.errors ?? []), ...lead.errors] } : {}),
  };
}
