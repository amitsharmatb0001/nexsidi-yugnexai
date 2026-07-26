// Stage 5 — Adversarial QA: Navya (logic), Karan (security), Deepika
// (performance) run in parallel against Stage 4's generated output. Karan's
// score is zero-tolerance (any finding blocks); Navya/Deepika are the
// severity-weighted ≥85 convention — two deliberately different scoring
// systems (see agents/qa/karan/src/index.ts header comment). If any of the
// three fails, this stage fault-isolates the failure to the ONE responsible
// agent (Shubham/Aanya/Pranav) via Stage 4's `identifyFaultAgent` rather than
// a blind full-regenerate. If all three pass, Tilotma's Tier 3 evidence-based
// visual review (agents/tilotma/src/tier3-review.ts) runs as the final gate.
//
// ── Structure: dynamic import for the real entry point, injectable deps for
// tests (same pattern as pipeline/orchestrator/run.ts's
// runPipelineWithStages/runPipeline split) ─────────────────────────────────
// `runStage5WithAgents` is pure sequencing/scoring/routing logic over
// injected agent-call functions — this is what stage5-adversarial-qa.test.ts
// exercises with deterministic stubs, no live LLM calls. `runStage5` is the
// real entry point: it dynamically imports Navya/Karan/Deepika's real run()
// and Tilotma's real runTier3Review so that importing this file (e.g. from a
// test) never transitively triggers a live LLM call at module-eval time.
//
// `identifyFaultAgent`/`Finding`/`Stage4Result` are imported from Stage 4,
// NOT redefined here — Stage 4 is the canonical source for all three (a
// previous review flagged an earlier duplicate definition).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { identifyFaultAgent, type Finding, type Stage4Result } from "./stage4-multi-agent-dev.ts";
import {
  scoreSecurityFindings,
  type QAResult as KaranResult,
  type SecurityFinding,
} from "../../../agents/qa/karan/src/index.ts";
import type { Finding as NavyaFinding, QAResult as NavyaResult } from "../../../agents/qa/navya/src/index.ts";
import type { Finding as DeepikaFinding, QAResult as DeepikaResult } from "../../../agents/qa/deepika/src/index.ts";
import type { Tier3ReviewResult } from "../../../agents/tilotma/src/tier3-review.ts";

export interface Stage5Result {
  pass: boolean;
  findings: Finding[];
  faultAgent?: string;
}

// Injectable seam for testing — runStage5() below wraps this with the real
// Navya/Karan/Deepika/Tier3 calls. Each function takes (projectId,
// stage4Result) rather than the agents' raw (projectId, iteration, code)
// signature so the deterministic orchestration logic in
// runStage5WithAgents never has to know how "code" gets built (that's a
// real-entry-point-only concern — see collectCode below) — matching how
// stage6-deployment.ts's Stage6Deps hides Riya's real invocation details
// behind a simple deployFn(projectId, deployTarget) seam.
export interface Stage5Agents {
  runNavya: (projectId: string, stage4Result: Stage4Result) => Promise<NavyaResult>;
  runKaran: (projectId: string, stage4Result: Stage4Result) => Promise<KaranResult>;
  runDeepika: (projectId: string, stage4Result: Stage4Result) => Promise<DeepikaResult>;
  runTier3Review: (projectId: string, stage4Result: Stage4Result) => Promise<Tier3ReviewResult>;
}

// ── Finding-shape reconciliation ────────────────────────────────────────────
// Stage 4's `Finding` (the shape identifyFaultAgent consumes) is
// `{ file: string; issue: string }`. None of the three QA agents produce that
// shape natively, but all three now carry an OPTIONAL `file` (best-effort
// from the model) alongside their own severity/description fields — Task 14
// added `file?` to Navya/Deepika's Finding to match Karan's SecurityFinding,
// so a Navya/Deepika-only failure can now fault-isolate to the actual
// responsible agent instead of always falling through to identifyFaultAgent's
// "shubham" default (still the fallback when the model doesn't supply a
// file path).
//
// 2026-07-24 (P2): `issue` is the ONE text field that survives all the way
// to the generator's fix prompt (via formatFinding in
// stage5-qa-fix-loop.ts) — a `line` on the QA finding does nothing for
// convergence unless it's embedded here. Format is `file:line` (matching
// the conventional grep/stack-trace location format any generator model has
// seen a million times), prefixed only when `line` is present — a finding
// without one still shows just the file, never a misleading ":undefined".
// Exported for direct testing (same convention as collectCode below).
export function locationPrefix(file: string | undefined, line: number | undefined): string {
  if (!file) return "";
  return line !== undefined ? `${file}:${line} — ` : `${file} — `;
}

export function karanFindingToFinding(f: SecurityFinding): Finding {
  return { file: f.file ?? "", issue: `${locationPrefix(f.file, f.line)}[security/${f.severity}] ${f.description}` };
}

export function navyaFindingToFinding(f: NavyaFinding): Finding {
  return { file: f.file ?? "", issue: `${locationPrefix(f.file, f.line)}[logic/${f.severity}] ${f.category}: ${f.detail}` };
}

export function deepikaFindingToFinding(f: DeepikaFinding): Finding {
  return { file: f.file ?? "", issue: `${locationPrefix(f.file, f.line)}[performance/${f.severity}] ${f.category}: ${f.detail}` };
}

/**
 * Runs Stage 5: Navya + Karan + Deepika in parallel, zero-tolerance security
 * scoring for Karan, severity-weighted ≥85 scoring (already computed on
 * `.passed`) for Navya/Deepika. Any failure short-circuits straight to fault
 * isolation — Tier 3 never runs against output that hasn't cleared static
 * adversarial QA. All three passing hands off to Tilotma's Tier 3 review —
 * UNLESS `includeTier3` is false.
 *
 * 2026-07-11: real bug found live — traced the full call graph and confirmed
 * Tier 3 (Tilotma screenshotting the live app) was running as part of the
 * PRE-DEPLOYMENT gate (stage5-qa-fix-loop.ts calls runStage5 before Riya/
 * Stage 6 ever deploys anything). Tier 3 needs a reachable app; nothing
 * deploys one until Stage 6, which never runs because Stage 5 can't pass
 * without Tier 3 passing first — a structural deadlock, not a flaky
 * environment issue. Stage 6's runRealLiveRetest already correctly re-runs
 * this AFTER a real deploy, pointed at the real URL — that's the only place
 * Tier 3 belongs. `includeTier3` defaults to true for backward compat with
 * that live-retest path; the pre-deployment gate explicitly passes false.
 */
export async function runStage5WithAgents(
  projectId: string,
  stage4Result: Stage4Result,
  agents: Stage5Agents,
  includeTier3 = true,
): Promise<Stage5Result> {
  const [navyaResult, karanResult, deepikaResult] = await Promise.all([
    agents.runNavya(projectId, stage4Result),
    agents.runKaran(projectId, stage4Result),
    agents.runDeepika(projectId, stage4Result),
  ]);

  try {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
    const projectBuildDir = join(buildDir, projectId);
    mkdirSync(projectBuildDir, { recursive: true });
    const submissionsPath = join(projectBuildDir, "qa-submissions.json");
    const submissions = [
      { agentName: "navya", findings: navyaResult.findings },
      { agentName: "karan", findings: karanResult.findings },
      { agentName: "deepika", findings: deepikaResult.findings },
    ];
    writeFileSync(submissionsPath, JSON.stringify(submissions, null, 2), "utf-8");
  } catch (err) {
    console.error(`[stage5] Failed to save QA submissions: ${String(err)}`);
  }

  // Karan: severity-weighted ≥85 per CLAUDE.md System A (2026-07-09 —
  // scoreSecurityFindings was zero-tolerance before that, a deviation from
  // the spec; see its own comment for the convergence evidence). Navya/
  // Deepika: use their OWN already-computed `passed` field (same ≥85
  // formula) directly — do not invent a second scorer for a convention
  // that already exists on their result.
  const security = scoreSecurityFindings(karanResult.findings);
  const allPass = security.pass && navyaResult.passed && deepikaResult.passed;

  if (!allPass) {
    const findings: Finding[] = [
      ...karanResult.findings.map(karanFindingToFinding),
      ...navyaResult.findings.map(navyaFindingToFinding),
      ...deepikaResult.findings.map(deepikaFindingToFinding),
    ];
    return { pass: false, findings, faultAgent: identifyFaultAgent(findings) };
  }

  if (!includeTier3) {
    return { pass: true, findings: [] };
  }

  const tier3 = await agents.runTier3Review(projectId, stage4Result);
  return {
    pass: tier3.pass,
    findings: tier3.findings.map((issue): Finding => ({ file: "", issue })),
  };
}

// Text/code file extensions worth feeding to the QA agents as "code". Binary
// asset extensions (images, fonts, archives, lockfiles' noisy JSON blobs,
// etc.) are skipped — cheap heuristic, not exhaustive.
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".sql", ".prisma", ".json", ".yaml", ".yml",
  ".css", ".scss", ".html", ".md",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);
const MAX_CODE_CHARS = 200_000; // bound the QA prompt payload

export interface LabeledDir {
  label: string; // "backend" | "frontend" — must match identifyFaultAgent's prefix check
  path: string;
}

// Real-entry-point-only helper: walks Stage 4's output directories and
// concatenates readable source files into one "code" blob for Navya/Karan/
// Deepika's `run(projectId, iteration, code)` signature.
//
// A4 (full-system audit): each dir is now labeled ("backend"/"frontend")
// and every file's relative path is prefixed with that label before being
// shown to the QA agents. Previously relPath was relative to EACH agent's
// own output dir with no prefix at all (e.g. "src/controllers/notes.ts"),
// so identifyFaultAgent's startsWith("backend/") check could never match —
// fault isolation always fell through to its "shubham" default regardless
// of which agent actually caused the finding. Confirmed via stress-test
// run 10: Karan's real finding.file was literally "src/controllers/notes.ts"
// (no prefix) — proof the model faithfully echoes whatever path format the
// "// FILE:" header shows it, so prefixing the header is the actual fix,
// not a cosmetic change.
export function collectCode(dirs: LabeledDir[]): string {
  const chunks: string[] = [];
  for (const { label, path } of dirs) {
    walkDir(path, path, label, chunks);
  }
  const joined = chunks.join("\n\n");
  return joined.length > MAX_CODE_CHARS ? joined.slice(0, MAX_CODE_CHARS) : joined;
}

function walkDir(root: string, dir: string, label: string, chunks: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory doesn't exist (yet) or unreadable — skip, don't throw
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: import("node:fs").Stats;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(root, full, label, chunks);
    } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(entry))) {
      try {
        const content = readFileSync(full, "utf-8");
        const relPath = full.slice(root.length + 1).replace(/\\/g, "/");
        chunks.push(`// FILE: ${label}/${relPath}\n${content}`);
      } catch {
        // unreadable file — skip rather than fail the whole QA pass
      }
    }
  }
}

/**
 * Real entry point — wires the actual Navya/Karan/Deepika/Tier3 calls.
 *
 * 2026-07-11: switched from run()'s one-shot text-dump (collectCode) to
 * runExploring()'s tool-calling loop (qa-loop.ts) — root-caused live
 * (stress-fix2-1783753726) that a one-shot call over the ENTIRE dumped
 * codebase produced a finding that didn't match the actual code (Navya
 * cited a `queryWhere` mutation that never happened). runExploring() makes
 * the agent read_file the specific file before it's allowed to cite it —
 * see finding-evidence.ts.
 *
 * `includeTier3` defaults to false: this function is called as the
 * PRE-DEPLOYMENT gate (stage5-qa-fix-loop.ts, up to 5x per run) where
 * nothing has deployed the app yet — Tier 3 would always fail there, a
 * structural deadlock (see runStage5WithAgents' comment). Stage 6's
 * runRealLiveRetest explicitly passes true, since IT runs after a real
 * deploy and points Tier 3 at the actual live URL.
 */
export async function runStage5(projectId: string, stage4Result: Stage4Result, includeTier3 = false): Promise<Stage5Result> {
  const [{ runExploring: runNavyaReal }, karanModule, { runExploring: runDeepikaReal }, { runTier3Review: runTier3ReviewReal }] =
    await Promise.all([
      import("../../../agents/qa/navya/src/index.ts"),
      import("../../../agents/qa/karan/src/index.ts"),
      import("../../../agents/qa/deepika/src/index.ts"),
      import("../../../agents/tilotma/src/tier3-review.ts"),
    ]);
  const runKaranReal = karanModule.runExploring;

  const labeledDirs = (s4: Stage4Result): LabeledDir[] => [
    { label: "backend", path: s4.backendOutputDir },
    { label: "frontend", path: s4.frontendOutputDir },
  ];

  const agents: Stage5Agents = {
    runNavya: (pid, s4) => runNavyaReal(pid, labeledDirs(s4)),
    runKaran: (pid, s4) => runKaranReal(pid, labeledDirs(s4)),
    runDeepika: (pid, s4) => runDeepikaReal(pid, labeledDirs(s4)),
    runTier3Review: (pid, s4) => runTier3ReviewReal(pid, s4.frontendOutputDir),
  };

  return runStage5WithAgents(projectId, stage4Result, agents, includeTier3);
}
