import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// 2026-09-28: real false CRITICAL (project a034f90ba50e, Plantly). The live
// review claimed dashboard/page.tsx "imports 'SelectField' from
// '@/components/nexui/select', but '@/components/nexui/select' exports
// 'Select'" — select.tsx exports both. CRITICAL findings skip debate (Stage 5)
// and the live stage (Stage 6) has no debate at all, so the claim went
// straight to the frontend fixer, which rewrote a working dashboard.
//
// Only one narrow, mechanically checkable claim is handled: "file imports X
// from module M" where M's real source exports X. Such a finding is dropped.
// Anything else — including every claim this can't resolve — is kept, so a
// real bug is never filtered out here.

export interface EvidenceFinding {
  file: string;
  issue?: string;
  detail?: string;
}

const IMPORT_CLAIM = /imports?\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?\s+from\s+[`'"]([^`'"]+)[`'"]/i;
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.js"];

function resolveModule(projectDir: string, findingFile: string, spec: string): string | null {
  const appRoot = findingFile.split("/")[0] ?? "";
  let base: string;
  if (spec.startsWith("@/")) base = join(projectDir, appRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = join(projectDir, dirname(findingFile), spec);
  else return null; // a package import — not checkable here
  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith("/") && /\.(tsx?|jsx?)$/.test(candidate)) return candidate;
  }
  return null;
}

function exportsSymbol(source: string, symbol: string): boolean {
  const s = symbol.replace(/\$/g, "\\$");
  const declared = new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${s}\\b`);
  const listed = new RegExp(`export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`);
  return declared.test(source) || listed.test(source);
}

export function dropCodeContradictedFindings<F extends EvidenceFinding>(
  findings: F[],
  projectDir: string,
): { kept: F[]; dropped: Array<{ finding: F; reason: string }> } {
  const kept: F[] = [];
  const dropped: Array<{ finding: F; reason: string }> = [];
  for (const finding of findings) {
    const text = `${finding.issue ?? ""} ${finding.detail ?? ""}`;
    const claim = text.match(IMPORT_CLAIM);
    const modulePath = claim ? resolveModule(projectDir, finding.file, claim[2]!) : null;
    if (claim && modulePath && exportsSymbol(readFileSync(modulePath, "utf-8"), claim[1]!)) {
      dropped.push({ finding, reason: `${claim[2]} exports ${claim[1]}` });
    } else {
      kept.push(finding);
    }
  }
  return { kept, dropped };
}
