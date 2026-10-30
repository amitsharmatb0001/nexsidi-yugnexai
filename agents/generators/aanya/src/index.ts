// Aanya — Next.js 16.2 frontend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run next build → fix → repeat.
// UI: @yugnex/core (NexSidi's own UI runtime) + vendored components/nexui/*.tsx — NO Tailwind, NO shadcn/ui.

import { resolveGeneratorRunner, isBuilderFixFile, recordClaimEvidence } from "@nexsidi/agent-runtime";
import { AGENT_MODELS, FALLBACK_CHAIN } from "@nexsidi/llm-client";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { execSync, exec } from "child_process";
import { randomBytes } from "crypto";
import { join, resolve } from "path";
import type { BuildPlan } from "../../../arjun/src/index.ts";
import { buildSystemContext } from "../../../arjun/src/index.ts";
import { formatDesignBriefForPrompt } from "../../../vanya/src/index.ts";
import { buildFontOverrideCss, buildThemeOverrideTokens, themeColorMode, usedInHouseFonts } from "./theme.ts";
import { inHouseFontFaceCss, vendorInHouseFonts } from "./fonts.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";
import { loadAndInjectContract } from "../../../../pipeline/orchestrator/stages/contract-extractor.ts";
import { buildDirFor } from "../../../../packages/agent-runtime/src/build-dir.ts";
import { answersBlock } from "../../../../packages/agent-runtime/src/tools/ask.ts";
import { withExtraChecks } from "../../../../packages/agent-runtime/src/enforce/fix-accounting.ts";
import { teamRunOverrides } from "../../../../packages/agent-runtime/src/team-files.ts";

// 2026-10-24: the system's own frontend checks (pipeline/orchestrator/stages/builder-exit-checks.ts), loaded when used.
// 2026-10-25: the approved plan's checklist for this builder (the same items the reviewers judge against), for the build task.
async function checklistTextFor(projectId: string): Promise<string> {
  try {
    const { checklistTaskText } = await import("../../../../pipeline/orchestrator/stages/builder-exit-checks.ts");
    return checklistTaskText(projectId, "frontend");
  } catch {
    return "";
  }
}

async function frontendExitChecksFor(projectId: string, summary?: string): Promise<string[]> {
  const { frontendExitChecks, checklistFindings, mapRuleFindings } = await import("../../../../pipeline/orchestrator/stages/builder-exit-checks.ts");
  // 2026-10-25: the first build (not a fix round) must account for every approved-plan item that concerns the frontend.
  return [...frontendExitChecks(projectId), ...mapRuleFindings(buildDirFor(projectId), "aanya", { remember: true }), ...(summary !== undefined ? checklistFindings(projectId, "frontend", summary) : [])];
}

export function getOutputDir(projectId: string): string {
  return join(buildDirFor(projectId), "frontend");
}

// 2026-10-29 (team plan, stage 1): the whole project is readable (writing stays in the frontend folder).
export function aanyaReadOnlyDirs(outputDir: string): string[] {
  return [resolve(outputDir, "..")];
}

// 2026-07-08: see agents/generators/shubham/src/index.ts's identical helper
// for the full rationale (Patent Claim 2's instinct memory finally wired
// up, read side). Fails safe: memory is an enrichment, not a hard
// dependency.
async function loadKnownMistakesPrefix(projectId?: string): Promise<string> {
  try {
    const { queryRecentInstincts, formatInstinctsForPrompt, REACHABLE_INSTINCT_DOMAINS } = await import("@nexsidi/db");
    // 2026-07-24 (P3.W3.3): was hardcoded to "security" only — missed every
    // performance/architecture instinct QA ever recorded. See
    // queryRecentInstincts's comment for the bug this closes.
    const instincts = await queryRecentInstincts(REACHABLE_INSTINCT_DOMAINS);
    const formatted = formatInstinctsForPrompt(instincts);
    // Patent claim 7: what the stored mistake memory added to this builder's prompt.
    if (projectId) recordClaimEvidence(buildDirFor(projectId), 7, "stored mistake rules added to the frontend builder's prompt", { rules: instincts.length, chars: formatted.length });
    return formatted ? `${formatted}\n\n` : "";
  } catch {
    return "";
  }
}


// 2026-08-10: real gap found live (user request) — making "visual_check" a
// mechanically required evidence kind (completion-gate.ts has no override
// path) for EVERY project would hard-block a genuine single-page app
// forever, since the prompt's own VISUAL QUALITY CHECK step explicitly
// allows skipping for that case. Counts distinct "page.tsx" files across
// aanyaTasks' outputFiles — the real App Router signal for "how many pages
// does this project have," not a guess — so the gate only applies when a
// screenshot review is actually possible to satisfy honestly.
export function countPlannedPages(plan: BuildPlan): number {
  const pageFiles = new Set<string>();
  for (const task of plan.aanyaTasks ?? []) {
    for (const file of task.outputFiles ?? []) {
      if (/page\.tsx$/.test(file)) pageFiles.add(file);
    }
  }
  return pageFiles.size;
}

// ── Main entry ────────────────────────────────────────────────────────────────
// mode "preview": Stage 3 UI-only build shown to the user for design approval
//                 before any backend exists — mock data only, no fetch() calls.
// mode "integrate": wires the already-approved preview UI to the real backend
//                 API — no layout/visual changes, only mock data → real fetch().
// 2026-10-02 (Part C.3): one build phase at a time — see
// pipeline/activities/build-phases.ts. Absent for plans without phases.
export interface GeneratorPhaseRun {
  conversationKey: string;
  header: string;
  scaffold: boolean;
  isLast: boolean;
  maxSteps: number;
  // 2026-10-24: builder teams (pipeline/activities/build-phases.ts) — which team step this run is; see teamRunOverrides.
  role?: "shared" | "helper" | "integrate";
  ownFiles?: string[];
  avoidFiles?: string[];
  helperIndex?: number;
}

export async function run(plan: BuildPlan, mode: "preview" | "integrate", phase?: GeneratorPhaseRun): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId);
  mkdirSync(outputDir, { recursive: true });

  // 1. Vendor in NexSidi UI packages via @yugnex/cli against the registry.
  // NEEDS NETWORK ACCESS (2026-08-16, aanya-nexui-migration review fix):
  // unlike the old cpSync-based local-copy implementation, this shells out to
  // `npx --yes @yugnex/cli@${NEXUI_CLI_VERSION}` (resolves/downloads the CLI
  // package itself from the npm registry) and that CLI in turn does an HTTP
  // fetch per component against NEXUI_REGISTRY_URL. If Aanya's generator ever
  // runs inside a network-restricted container/sandbox, vendoring will fail —
  // confirm real network egress (npm registry + the NexUI registry host) is
  // available in whatever environment actually runs generation before relying
  // on this path (see Task 4 of the migration plan).
  // Phased builds write the starter files only on the first phase, so a
  // later phase never overwrites earlier work.
  if (!phase || phase.scaffold) {
    await vendorNexui(outputDir);

    // 2. Write static scaffold (includes the in-house fonts — see fonts.ts).
    writeStaticScaffold(plan, outputDir);
  }

  // 3. Run real agent loop
  // Primary history: kimi-k2.6 (failed, F7) -> z-ai/glm-5.2 (2026-07-03) ->
  // mistral-medium-3.5-128b (2026-07-04). glm-5.2 demoted after
  // scripts/ping-glm.ts proved its endpoint hangs past the 120s timeout on
  // EVERY request shape including a trivial "say hi" — and the stress-2/3 run
  // logs show mistral-medium-3.5-128b (then the fallback) actually performed
  // all of the generation work anyway. glm-5.2 dropped from the chain
  // entirely, not just demoted: a hanging endpoint costs a full 120s timeout
  // per attempt before failing over, which is strictly worse than going
  // straight to a working model. runAgentEscalated (Task 15): the open-source
  // chain runs first; escalates to Sonnet 5 for a single retry only when the
  // whole chain genuinely fails. See packages/agent-runtime/src/claude-loop.ts.
  const knownMistakesPrefix = await loadKnownMistakesPrefix(plan.projectId);

  const result = await resolveGeneratorRunner()({
    agentName: "aanya",
    model: AGENT_MODELS.aanya, // 2026-09-28: from llm-client's model registry (types.ts)
    // 2026-07-24: qwen3.5-122b-a10b (chosen for being a genuinely different
    // architecture from the primary) returns HTTP 410 Gone as of 2026-07-20
    // — the NIM endpoint was permanently removed (see types.ts's ModelId
    // comment). Using it as a fallback meant a real failure of the primary
    // model fell through to a fallback that would ALWAYS also fail. Swapped
    // for qwen3-next-80b, the documented working replacement.
    fallbackModels: FALLBACK_CHAIN.aanya,
    apiKey,
    systemPrompt: loadAndInjectContract(plan.projectId, knownMistakesPrefix + buildAgentPrompt(mode)),
    initialMessage: (phase ? phase.header + "\n\n" : "") + buildAgentTask(plan, mode) + (!phase || phase.isLast ? "\n\n" + (await checklistTextFor(plan.projectId)) : ""),
    sandboxDir: outputDir,
    readOnlyDirs: aanyaReadOnlyDirs(outputDir),
    enableAsk: true,
    projectId: plan.projectId,
    conversationKey: phase?.conversationKey,
    extendStepsWhileProgressing: Boolean(phase),
    // 2026-07-12: Aanya was kept on the cheap flash model to avoid a
    // rate-limit collision with Shubham's parallel run on pro.
    // 2026-07-25 (Phase 1, full MVP upgrade): reversed. Verified against
    // System B's own weighting (nexsidi-adversarial-qa): designQuality +
    // originality are 0.35 each — 0.70 of the live subjective score — and
    // are exactly the two criteria a flash model reliably fails ("purple
    // gradients over white cards" AI-slop pattern), so keeping Aanya on
    // flash was capping the single most heavily-weighted gate in the
    // pipeline. The original rate-limit worry doesn't actually reproduce
    // under the new tier map: Shubham now runs on "generation" (3.6-flash
    // leading, never pro) while Aanya runs on "design" (3.1-pro-preview
    // leading) — the two parallel generators are on DIFFERENT primary
    // models, so there is no shared-pool collision. QA's own use of
    // gemini-3.1-pro-preview runs AFTER generation completes (see
    // project-build.ts's `await Promise.all(genPromises)` before the QA
    // stage begins), not concurrently with it.
    geminiTier: "design",
    // http tools so Aanya still self-verifies (npm install + next build +
    // typecheck).
    enableHttpTools: true,
    enableWebSearch: true,
    // Phase 5 (full agentic upgrade): read the FULL content of a specific
    // page the user referenced (their existing site, a design reference)
    // instead of guessing at it — web_search alone only gives a
    // synthesized multi-source answer, not one exact page's real content.
    enableWebFetch: true,
    enableScreenshot: true,
    enableBrowser: true,
    // 2026-08-06: real gap found live — "Live UI is Tier 3" (this comment,
    // previously) meant Aanya NEVER checked whether its own nav links
    // actually navigate anywhere, whether a page renders its expected
    // content, or anything beyond "does it compile." Tier 3 (Tilotma) does
    // check this, but only on the fully deployed app, minutes/hours later —
    // not Aanya verifying its own work before handing it off. See CLICK-
    // THROUGH NAVIGATION VERIFICATION below for what this now requires.
    enableDockerTools: true,
    // 2026-10-02: no db_query here. The form-to-database self-check was
    // removed (see STAY IN YOUR FOLDER in the integrate prompt): the
    // database is built at the same time and is not hers to inspect.
    // 2026-08-24 (Workstream 4): not-found.tsx/error.tsx/global-error.tsx/
    // icon.svg are Next.js App Router FILE CONVENTIONS — auto-discovered by
    // exact filename, never imported anywhere, so (unlike Header/Footer
    // above) a missing one does NOT fail `next build` — Next just silently
    // falls back to its own default. That means this specific gap needed a
    // different mechanical check, not a reuse of the same import trick.
    // `cat <path>` exits nonzero when the file doesn't exist, so listing one
    // per required file here mechanically blocks task_complete exactly like
    // the tsc/build commands do — see AANYA required-files doctrine for what
    // each file must actually contain.
    // Part C.3: a phase before the last checks only what it wrote (type check
    // and build); the app-wide files and the visual check come in the last
    // phase, when every page exists.
    requiredVerificationCommands: phase && !phase.isLast ? ["npx tsc --noEmit", "npx next build"] : [
      "npx tsc --noEmit",
      "npx next build",
      "cat app/not-found.tsx",
      "cat app/error.tsx",
      "cat app/global-error.tsx",
      "cat app/icon.svg",
    ],
    // 2026-08-10: mechanically blocks task_complete without at least one
    // real screenshot review this run — same enforcement pattern as
    // Shubham's requiredEvidenceKinds(["http_check"]), for the same reason
    // (a prompt instruction alone is followed probabilistically). Scoped to
    // multi-page projects only (see countPlannedPages's header comment) so
    // a genuine single-page app, which the prompt explicitly allows to skip
    // this step, is never hard-blocked with no way to satisfy the gate.
    requiredEvidenceKinds: phase && !phase.isLast ? [] : countPlannedPages(plan) > 1 ? (["visual_check"] as const) : [],
    // 2026-07-25: raised to 60. Measured live in nextech7: Aanya hit the
    // 40-iteration default exactly while still running npx next build to fix
    // proxy.ts + portal dashboard import issues. Pattern: ~32 write iterations
    // + ~8 build-fix iterations = 40 (cap). 60 gives a safe 20-iteration
    // margin. Non-retryable failure is already in place (generatorFailure()),
    // so a cap hit costs one attempt only.
    // 2026-08-18: raised to 90. Measured live in RateGate (6 pages, dual-role
    // auth, admin dashboard, interactive landing simulation — a genuinely
    // larger app than nextech7) — 60 was hit FOUR consecutive times, always
    // during real, convergent end-to-end verification (a full browser-driven
    // sign-up/admin flow plus methodical backend investigation of a real
    // auth issue), never a repeating/circular pattern. Since each cap hit
    // starts a fresh attempt with no progress carried over (by design — see
    // the note above), a budget that's merely tight for a project's actual
    // size produces the SAME futile outcome every single retry, not
    // self-healing variance. 90 gives real margin for larger, multi-role
    // apps while keeping the existing "cap hit costs one attempt" safety net
    // for genuinely pathological cases.
    // Part C.3: a phase starts from its own size and is extended while it
    // keeps making progress (extendStepsWhileProgressing above).
    // 2026-10-23: a later phase starts with the files already written, whole (builder-preload.ts).
    preloadOwnFiles: !!phase && !phase.scaffold,
    // 2026-10-24: emoji, dead buttons and missing spec colours are checked by the system before the last phase may finish.
    exitChecks: !phase || phase.isLast ? (summary: string) => frontendExitChecksFor(plan.projectId, summary) : undefined,
    maxIterations: phase?.maxSteps ?? 90,
    // 2026-10-24: a team step's settings win (helpers: flash, own files only, type check only; lead: pro, plan-vs-code check).
    ...teamRunOverrides(phase, outputDir, { taskFiles: plan.aanyaTasks.flatMap((t) => t.outputFiles ?? []), baseExitChecks: !phase || phase.isLast ? (summary: string) => frontendExitChecksFor(plan.projectId, summary) : undefined }),
  });

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    errors: result.errors,
  };
}

// A6 (full-system audit, Phase C): Stage 5 QA findings previously went
// nowhere — run.ts's own comment documented the gap. runFix() targets the
// SAME outputDir run() already wrote to — no re-vendoring, no scaffold
// rewrite, no mode param (the locked preview/integrate design is already
// fixed by this point) — just the agent loop pointed at a fix task instead
// of a from-scratch build task.
// 2026-07-26 (agent-autonomy-assessment F1/F2): same root-cause fix as
// Shubham's identical prompt — see shubham/src/index.ts's buildFixTask for
// the full live evidence. "Fix ONLY these specific issues" forced
// point-fixes to symptoms instead of root causes, and the agent never saw
// the API contract/DB schema it needed to tell whether a fix belonged in
// its own layer at all.
export function buildFixTask(findings: string[], plan: BuildPlan): string {
  return `A review reported the following findings about the frontend code you already wrote.

${buildSystemContext(plan)}

FINDINGS TO CHECK:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

STEP 0 — CONFIRM EACH FINDING BEFORE YOU CHANGE ANYTHING. A finding is a
claim, not a fact. For each one, check it against what is real: read the code
it names, request the page or endpoint on the running app, or run the build.
- If the facts show it is true, fix it (below).
- If the facts show it is not true, change nothing for it and call
  dispute_finding with the finding, what you checked and what you saw (quote
  the code, response or output). Tilotma checks it herself.
- Never change code only to make a finding go away.

For each finding you confirmed, it is a SYMPTOM, not necessarily the whole problem. Before editing:
1. Diagnose the root cause — read the full component/file the finding points
   at, not just the cited line. Check the API contract above: an "API
   contract mismatch" or "over-fetching" finding is often really the
   frontend not using a query param the backend already supports.
2. Check whether the same class of issue elsewhere in your own files has the
   same root cause — fix all real instances of it, not just the one cited.
3. Stay within your own domain (frontend) and don't change layout or visual
   design that wasn't flagged.

Workflow:
1. Use read_file to see the exact current content of each affected file
2. Use edit_file for targeted fixes (cheaper than rewriting the whole file) — use write_file only if the fix genuinely requires touching most of the file
3. Run "npx next build" to verify nothing broke
4. Call task_complete with verification_passed: true only after verifying the fix actually addresses the root cause, not just silences the symptom` + answersBlock(plan.projectId);
}

// 2026-10-22 (Trailhead rerun): fix rounds ran on the generic 40-step default while doing the same required live check as a
// generation phase (tuned to 90 from real overruns); a backend fix round ran out at step 40 with its last edit unmade.
export const FIX_MAX_STEPS = 60;

// 2026-10-24: `team` set = one helper or the lead of a fix round run as a team (pipeline/orchestrator/team-fix.ts).
// 2026-10-30 (team plan, stage 4): `extra.exitChecks` adds the caller's own finish check — the acceptance gate's "the
// failing test passes on the rebuilt app" (pipeline/orchestrator/acceptance-gate.ts). It runs only once the builder's own
// checks pass, since a rebuild of an app that fails them would only fail again.
export async function runFix(plan: BuildPlan, findings: string[], team?: { role?: "helper" | "integrate"; ownFiles?: string[]; helperIndex?: number }, extra?: { exitChecks?: () => Promise<string[]> }): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId); // SAME dir run() wrote to — not regenerated
  // F7 (agent-autonomy-assessment): mirrors Shubham's identical fix — see
  // that file for the full rationale.
  const knownMistakesPrefix = await loadKnownMistakesPrefix(plan.projectId);

  const result = await resolveGeneratorRunner()({
    agentName: "aanya",
    model: AGENT_MODELS.aanya, // 2026-09-28: from llm-client's model registry (types.ts)
    // 2026-07-24: see run()'s identical fix above — qwen3.5-122b-a10b 410s
    // (endpoint permanently removed 2026-07-20); swapped for the documented
    // working replacement, qwen3-next-80b.
    fallbackModels: FALLBACK_CHAIN.aanya,
    apiKey,
    systemPrompt: knownMistakesPrefix + buildAgentPrompt("integrate"), // fix always happens post-integrate, per Stage 5's placement after Stage 4
    initialMessage: buildFixTask(findings, plan),
    sandboxDir: outputDir,
    readOnlyDirs: aanyaReadOnlyDirs(outputDir),
    enableAsk: true,
    projectId: plan.projectId,
    // flash (default) — see the rationale on Aanya's run() config above.
    enableHttpTools: true,
    enableWebSearch: true,
    // Phase 5 (full agentic upgrade): read the FULL content of a specific
    // page the user referenced (their existing site, a design reference)
    // instead of guessing at it — web_search alone only gives a
    // synthesized multi-source answer, not one exact page's real content.
    enableWebFetch: true,
    enableScreenshot: true,
    enableBrowser: true,
    // 2026-08-10: same rationale as run() above — needed if a fix touches a
    // form's data-persistence behavior.
    enableDbQuery: true,
    // P3 (agent-autonomy-assessment F3): mirrors Shubham's identical flag —
    // see that file for the full rationale.
    enableEscalation: true,
    // 2026-10-08: a fix round may not change or delete deploy files (Dockerfile, compose, .env) — they are the deploy agent's.
    writableFile: isBuilderFixFile,
    enableDockerTools: true,
    // 2026-08-24 (Workstream 4): not-found.tsx/error.tsx/global-error.tsx/
    // icon.svg are Next.js App Router FILE CONVENTIONS — auto-discovered by
    // exact filename, never imported anywhere, so (unlike Header/Footer
    // above) a missing one does NOT fail `next build` — Next just silently
    // falls back to its own default. That means this specific gap needed a
    // different mechanical check, not a reuse of the same import trick.
    // `cat <path>` exits nonzero when the file doesn't exist, so listing one
    // per required file here mechanically blocks task_complete exactly like
    // the tsc/build commands do — see AANYA required-files doctrine for what
    // each file must actually contain.
    requiredVerificationCommands: [
      "npx tsc --noEmit",
      "npx next build",
      "cat app/not-found.tsx",
      "cat app/error.tsx",
      "cat app/global-error.tsx",
      "cat app/icon.svg",
    ],
    // 2026-08-10: same gate as run() above — see its comment.
    requiredEvidenceKinds: countPlannedPages(plan) > 1 ? (["visual_check"] as const) : [],
    // 2026-10-22: own budget for fix rounds — see FIX_MAX_STEPS.
    // 2026-10-23: a fix round starts with the current files, whole, instead of reading them one at a time.
    preloadOwnFiles: true,
    // 2026-10-24: the same system checks before a fix round may finish.
    exitChecks: () => withExtraChecks(frontendExitChecksFor(plan.projectId), extra),
    maxIterations: FIX_MAX_STEPS,
    ...teamRunOverrides(team, outputDir, { taskFiles: [], baseExitChecks: () => withExtraChecks(frontendExitChecksFor(plan.projectId), extra) }),
  });

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    escalations: result.escalations,
    errors: result.errors,
  };
}

// 2026-08-16 (aanya-nexui-migration Task 1): the components confirmed by
// direct inspection of the real registry (E:\nex-ui\apps\docs\public\r\*.json,
// not the README) to exist under the same name as the old vendored NexUI —
// see the component API audit in
// docs/nexsidi/plans/2026-08-16-aanya-nexui-migration.md. That doc labels
// this list "13 direct matches" but actually enumerates 14 names — an
// off-by-one in the doc's own count, not in the names, which were verified
// directly against index.json (all 14 present there). Panel and Spinner
// have no registry equivalent and are resolved via prompt guidance instead
// (Task 3), not vendored here. Default component list for vendorNexui: the
// only structured signal BuildPlan carries about a project's frontend is
// aanyaTasks[].description (freeform LLM prose) and .outputFiles (file
// paths) — neither names which UI components a task uses, so per-project
// selection can't be derived without guessing which specific component names
// might be needed. Per the plan's own instruction ("do not guess, pick the
// safer option if uncertain"), every generation fetches all 14 rather than
// risk a missing component mid-build.
export const NEXUI_CONFIRMED_COMPONENTS = [
  "button", "card", "input", "badge", "checkbox", "modal", "tabs",
  "select", "tooltip", "switch", "progress", "skeleton", "avatar", "separator",
] as const;

const DEFAULT_NEXUI_REGISTRY_URL = "https://new.yugnex.com";
// Pinned to the version confirmed live/working during this migration's
// audit — bump deliberately, not silently, when a newer CLI is verified.
// 2026-09-27: 0.1.1 -> 0.2.0. Verified: 0.2.0's dist is byte-identical to
// 0.1.1 (only a LICENSE file added) and init/add work against the registry.
export const NEXUI_CLI_VERSION = "0.2.0";

export type VendorExecFn = (command: string, options: { cwd: string }) => string | Promise<string>;

// 2026-08-16 (review fix, Finding C): no other execSync/spawnSync call site in
// this codebase that talks to a network endpoint goes unbounded — see
// pipeline/activities/index.ts's bunInstall (timeout: 180_000) for the
// closest match in kind (npm-registry-dependent package resolution, not a
// fast local check like riya's isPortUsedByDocker docker-ps 5000ms). This
// call does the same class of work (npx resolving @yugnex/cli from the npm
// registry, then the CLI itself fetching each component over HTTP), so it
// gets the same order-of-magnitude budget rather than being unbounded or an
// arbitrarily small number that would false-fail on a slow but healthy
// network. A hang here previously blocked the entire generator run
// indefinitely — see Finding A's header comment on vendorNexui for why a
// fast, clean failure matters more here than elsewhere (there wasn't one).
const VENDOR_EXEC_TIMEOUT_MS = 180_000;

// 2026-09-28: real failure (project a034f90ba50e). Inside the long-running
// worker, the synchronous execSync used here failed INSTANTLY with "spawnSync
// cmd.exe ETIMEDOUT" (~250ms against a 180s timeout) on all 5 activity
// attempts, so the frontend never started. The same command succeeded 5/5 in
// a separate process, and the agents' own commands (async spawn, see
// agent-runtime tools/command.ts) ran fine in the same worker at the same
// time. So this runs asynchronously now, and retries ONLY that instant
// ETIMEDOUT (a real CLI failure — non-zero exit, bad registry — fails at once).
type VendorAsyncExec = (command: string, options: { cwd: string; timeout: number }) => Promise<string>;

const execAsyncDefault: VendorAsyncExec = (command, options) =>
  new Promise((resolve, reject) => {
    exec(
      command,
      { cwd: options.cwd, timeout: options.timeout, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve(String(stdout))),
    );
  });

const VENDOR_RETRY_DELAYS_MS = [2_000, 5_000];

export async function execVendorCommand(
  command: string,
  options: { cwd: string },
  deps: { execAsync: VendorAsyncExec; sleep: (ms: number) => Promise<void> } = {
    execAsync: execAsyncDefault,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      return await deps.execAsync(command, { cwd: options.cwd, timeout: VENDOR_EXEC_TIMEOUT_MS });
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      const instantTimeout = (code === "ETIMEDOUT" || /ETIMEDOUT/.test(String(err))) && Date.now() - started < 10_000;
      if (!instantTimeout || attempt >= VENDOR_RETRY_DELAYS_MS.length) throw err;
      console.warn(`[aanya] "${command.slice(0, 60)}" failed instantly with ETIMEDOUT (attempt ${attempt + 1}) — retrying in ${VENDOR_RETRY_DELAYS_MS[attempt]}ms`);
      await deps.sleep(VENDOR_RETRY_DELAYS_MS[attempt]!);
    }
  }
}

const defaultVendorExecFn: VendorExecFn = (command, options) => execVendorCommand(command, options);

// ── Vendor NexUI components into the generated project ─────────────────────
// 2026-08-16 (aanya-nexui-migration Task 1): replaces the old whole-package
// cpSync-based vendorNexui. NexUI moved from a vendored-package model
// (@yugnex/nexui + @yugnex/nexui-react, copied wholesale from a local
// nexui-publish/ directory) to a shadcn/ui-style model: @yugnex/core is a
// real npm dependency (added to package.json in Task 2, not here) and
// individual component SOURCE FILES are copied in per-project by
// @yugnex/cli, fetched from a registry. This shells out to the CLI's `init`
// (writes components.json + styles/nexui-theme.css into outputDir) then
// `add <components>` (copies the real .tsx files into
// outputDir/components/nexui/) against the configurable registry URL.
//
// Library import vs subprocess — checked, not assumed: @yugnex/cli's
// addCommand/initCommand/listCommand (packages/cli/src/commands/*.ts in the
// nex-ui repo) ARE cleanly separable functions in SOURCE, but that source is
// never published — the real package.json declares `"files": ["dist"]` and
// no "exports" map, and its only build entry point is `src/index.ts`
// (`tsup src/index.ts --format esm --clean`), which bundles everything into
// a single dist/index.js containing ZERO `export` statements (confirmed by
// grepping the actual built bundle) and calls `program.parseAsync()` at
// module top level with no `require.main`-style guard. Importing that
// module would both find nothing to import AND immediately try to parse
// THIS process's own argv as CLI args — a real unwanted side effect, not
// just an awkward API. There is nothing importable in the real, installed
// package, so subprocess is the only mechanism it actually supports (also
// consistent with the plan's own "no new dependencies in NexSidi's own
// repo" constraint — a library import would require adding @yugnex/cli as a
// real dependency here, which the plan explicitly rules out). Confirmed
// working end-to-end (`npx --yes @yugnex/cli@0.1.1 init`/`add` against a
// local fixture directory registry, verifying real output files) before
// writing this — see index.test.ts's real-subprocess test.
// 2026-08-16 (review fix, Finding A): vendorNexui used to trust a zero exit
// code as proof every requested component actually landed on disk. It
// doesn't. Traced into the real CLI source it shells out to
// (packages/cli/src/{commands/add.ts,utils/fetch-registry.ts} in the nex-ui
// repo): fetchRegistryComponent wraps its fetch in a bare
// `try { ... } catch { return null; }` — a 404, a network hiccup, or
// malformed JSON are all indistinguishable and all swallowed to `null`. On
// receiving that `null`, addOne does `console.log(pc.red(...)); return;` —
// no process.exit(1), no throw — so the `add` loop just continues to the
// next component and addCommand returns normally. The CLI process therefore
// exits 0 even if every one of the requested components failed to fetch. A
// bare execSync (which only throws on non-zero exit) can never see this.
// Net effect without this check: a transient registry blip silently produces
// a generation run that believes vendoring succeeded, and the real problem
// only surfaces many expensive agent-loop iterations later as a confusing
// "module not found" build error.
//
// The fix: after `add` returns, verify each requested component's real file
// actually exists on disk. `init` (packages/cli/src/commands/init.ts) writes
// componentsDir as `components/nexui` (no `src/` prefix, since Aanya's
// scaffold has no src/ dir) and every registry component's JSON entry names
// its own file `<component-name>.tsx` (confirmed directly against the real
// registry files, e.g. apps/docs/public/r/button.json's
// `files: [{ path: "button.tsx", ... }]`) — so `outputDir/components/nexui/
// <name>.tsx` is the exact, verified path convention, not a guess.
function missingVendoredComponents(outputDir: string, components: readonly string[]): string[] {
  const componentsDir = join(outputDir, "components", "nexui");
  return components.filter((name) => !existsSync(join(componentsDir, `${name}.tsx`)));
}

export async function vendorNexui(
  outputDir: string,
  components: readonly string[] = NEXUI_CONFIRMED_COMPONENTS,
  execFn: VendorExecFn = defaultVendorExecFn,
  retryDelayMs = 3000,
): Promise<void> {
  const registryUrl = process.env.NEXUI_REGISTRY_URL ?? DEFAULT_NEXUI_REGISTRY_URL;
  const cli = `npx --yes @yugnex/cli@${NEXUI_CLI_VERSION}`;

  await execFn(`${cli} init --yes --registry "${registryUrl}"`, { cwd: outputDir });

  if (components.length > 0) {
    // 2026-10-02 (Ledgerly benchmark run 2): "button" and "card" silently
    // failed to fetch once and the whole generation attempt was lost. A
    // registry blip is transient, so fetch only the missing ones again
    // (up to 2 more times) before giving up.
    let missing = [...components];
    for (let attempt = 0; attempt < 3 && missing.length > 0; attempt++) {
      if (attempt > 0) {
        console.warn(`[aanya] NexUI components missing after add (${missing.join(", ")}) — fetching them again`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
      const names = missing.map((name) => `"${name}"`).join(" ");
      await execFn(`${cli} add ${names} --yes --registry "${registryUrl}"`, { cwd: outputDir });
      missing = missingVendoredComponents(outputDir, components);
    }
    if (missing.length > 0) {
      throw new Error(
        `vendorNexui: the CLI reported success but ${missing.length} component(s) never ` +
          `landed on disk under ${join(outputDir, "components", "nexui")}: ${missing.join(", ")}. ` +
          `The @yugnex/cli 'add' command silently swallows fetch failures (missing component, ` +
          `404, network error) per-component instead of failing the process — check registry ` +
          `URL "${registryUrl}" and network access, then retry.`,
      );
    }
  }
}

// 2026-08-08: explicit user request — the real YugNex logo (packages/agent-runtime/assets/yugnex-logo.png, source:
// E:/ai yug/logo/YugNex_Transparent.png, trimmed to content + resized 2048x2048 -> 137x96 via sharp, alpha preserved).
// 2026-10-24 (Brewline): it used to go into the builder's instructions as a 5,432-character data URI to copy verbatim;
// in 2 of 10 builds the copy was retyped wrong and the footer showed a broken image. The scaffold now writes the file
// into public/ and the builder writes only its path.
const YUGNEX_LOGO_FILE = join(import.meta.dir, "..", "..", "..", "..", "packages", "agent-runtime", "assets", "yugnex-logo.png");

export function vendorYugnexLogo(appDir: string): void {
  mkdirSync(join(appDir, "public"), { recursive: true });
  copyFileSync(YUGNEX_LOGO_FILE, join(appDir, "public", "yugnex-logo.png"));
}

// ── Agent system prompt ───────────────────────────────────────────────────────
// Shared base (stack rules, NexUI usage, layout patterns, critical rules) is the
// same regardless of mode. Mode-specific addenda below tell Aanya whether this
// is a mock-data-only preview build (Stage 3, pre-approval) or a real-backend
// integration pass (post-approval, wiring the locked preview to live APIs).
// 2026-08-23: identity/visual doctrine, workflow/verification, stack/
// component-usage, and layout/required-files content moved to
// packages/agent-runtime/skills/aanya/ (00-identity-and-visual-doctrine.md,
// 10-workflow-and-verification.md, 20-stack-and-components.md,
// 30-layout-and-required-files.md) — loaded by assembleSystemPrompt ahead of
// this basePrompt (see gemini-loop.ts's call site and prompt-assembly.ts's
// own header comment), not duplicated here. This constant keeps only what
// genuinely needs to stay inline: the CRITICAL RULES below.
const AANYA_SHARED_PROMPT_BASE = `\
CRITICAL RULES:
1. NEVER use 'use client' on layout.tsx — it is a Server Component
2. Use 'use client' on any component that uses hooks (useState, useEffect, etc.)
3. API URL: const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
4. Auth token: read the 'token' cookie set at login (e.g. document.cookie.match(/(?:^|;\s*)token=([^;]+)/)?.[1]). Pass it as "Authorization: Bearer <token>" in all backend fetch() calls.
5. Error states: always show a readable error message in the UI
6. Loading states: use Button's isLoading prop for in-button loading, Skeleton
   for page/section loading while fetching (see PANEL & SPINNER above — there
   is no Spinner component in this library)
7. Empty states: show a helpful message when the list is empty
8. NEVER create a proxy.ts file — Next.js 16.2 auth middleware MUST be named
   middleware.ts (already written, see above; this is the real, framework-
   recognized convention — a file named proxy.ts is silently never invoked
   by Next.js at all, which disables server-side auth redirect entirely).
   If you see a proxy.ts file for any reason, use delete_file to remove it
   and make sure middleware.ts has the real logic — do not try
   run_command('rm ...'), rm is not in the shell allowlist.
9. DATE DISPLAY: NEVER render raw ISO date strings to users. Any field that is a
   date (dueDate, createdAt, updatedAt, etc.) MUST be formatted before display.
   Use: new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
   Define a helper at the top of the file and reuse it: const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
   A raw "2026-07-13" or "2026-07-13T00:00:00.000Z" visible in the UI is a defect.
10. NO INTERNAL BRANDING IN USER-FACING TEXT: NEVER mention "NexSidi", "NexUI",
    "@yugnex", or any internal platform/library name in text that is visible to
    the end user (footer, navbar, error messages, tooltips, badge text, etc.).
    The generated app has its own brand — reference only the app's own name and
    WRONG footer: "Powered by NexSidi NexUI."
    CORRECT footer: "© 2026 TaskFlow. All rights reserved."
11. YUGNEX WATERMARK (explicit user request, 2026-08-08) — add exactly ONE
    attribution block in the site footer, BELOW the app's own copyright line
    (never merge them into one sentence). "YugNex" here is the COMPANY name
    (YugNex Technology (OPC) Private Limited) — a legitimate attribution, NOT
    the internal tooling names rule 10 hides. This is the REAL company logo
    (not a placeholder) — the system has already saved it as public/yugnex-logo.png;
    use this exact img tag, do not redraw or embed the image:
    <img src="/yugnex-logo.png" alt="YugNex" width="69" height="48" style={{ height: "24px", width: "auto", opacity: 0.75 }} />
    Footer structure, e.g.:
    © 2026 TaskFlow. All rights reserved.
    [the img tag above] Developed & Managed by YugNex™
    YugNex™ is a trademark of YugNex Technology (OPC) Private Limited.
    Keep this block visually quiet
    (small, muted opacity) — it is attribution, not a second brand competing
    with the app's own identity.
12. NO HARDCODED STATUS BADGES: NEVER render a "Connected", "Online", "Active",
    or "API Connected" badge unconditionally. A status badge must reflect ACTUAL
    runtime state — only show it after a successful fetch() round-trip proves the
    service is reachable. A hardcoded green badge that ignores the actual API
    state misleads users when the backend is down.

VERIFICATION GATE: Do not call task_complete until "npx next build" exits 0.

CONTENT-COMPLETENESS GATE — run this before task_complete, every time.
2026-08-27: real gap found live (project 852be5aeaef4). You were handed a
feature reading "Informational pages detailing the value proposition, how it
works, customer metrics, verified founder details, and frequently asked
questions", plus user stories naming the products, the pricing tiers, and the
FAQ — AND the instruction above that says to build all of it. The delivered
home page contained exactly one sentence: a headline and a subtitle. No
metrics, no how-it-works, no testimonial, no FAQ. Every real number in the
brief (40,000 tickets/day, 65% faster response, 140 customers) and both
founder names were absent from the built site. "npx next build" passed
cleanly, because a nearly-empty page compiles perfectly.
A build that compiles is not a build that is complete. So prove completeness
mechanically, the same way you prove compilation:
1. Re-read the LOCKED SPEC block in your task. List every concrete noun it
   names — each section ("how it works", "FAQ", "metrics"), each named
   product, each pricing tier, each person, each real figure.
2. For each one, run_command a grep against your own written files, e.g.
   run_command: grep -ril "how it works" app components
   A term that returns no match is NOT BUILT. Build it, then re-grep.
3. Only when every term from step 1 returns a real match may you call
   task_complete — and state in your summary which terms you grepped for.
A page whose entire body is a hero section fails this gate. If the spec names
five kinds of content for a page, that page has five kinds of content.
`;

const AANYA_PREVIEW_ADDENDUM = `
MODE: PREVIEW ONLY (Stage 3 — UI-first design approval, no backend yet)
- Use mock/placeholder data defined inline in each component (const arrays/objects
  at the top of the file, or a local mock-data module) — no fetch() calls anywhere.
- Do NOT write hooks that call the backend (no useEffect fetching from an API,
  no API client, no SWR/react-query against a real endpoint).
- Focus entirely on layout, visual hierarchy, and correct NexUI component usage.
- This build will be shown to the user for design approval BEFORE any backend
  exists — there is no live API to call yet, so mock everything realistically
  using the shapes from SHARED TYPES / the API contract as a reference only.
`;

const AANYA_INTEGRATE_ADDENDUM = `
MODE: INTEGRATE (post-approval — wire the locked preview to the real backend)
- Wire the already-approved UI (from the locked preview) to the real backend API.
- API calls: fetch() with Bearer token read from the 'token' cookie (document.cookie parse or a helper). Include as "Authorization: Bearer <token>" header.
- Do NOT change layout or visual design from the locked preview — only replace
  mock data with real fetch calls (plus the loading/error states around them).

STAY IN YOUR FOLDER: your work is the frontend in this directory only.
- You may read the backend and the database (../backend, ../db) to see the
  real routes, request shapes and columns. Never edit, start or stop them,
  and never edit another folder's docker-compose.yml. They are built at the same time
  as you, so the backend is usually NOT running yet — that is expected,
  not a bug for you to fix.
- Never write helper scripts to look outside this folder; read the files
  directly. The API contract above is the agreement; the backend's code
  shows what was really built.
- Prove your forms are wired right by reading your own code against the
  API contract (field names, method, path, Bearer header) and by the
  build. The running app — frontend, backend and database together — is
  tested end to end after deployment.
`;

export function buildAgentPrompt(mode: "preview" | "integrate"): string {
  const addendum = mode === "preview" ? AANYA_PREVIEW_ADDENDUM : AANYA_INTEGRATE_ADDENDUM;
  return AANYA_SHARED_PROMPT_BASE + addendum;
}

// Renames each endpoint's `path` field to `route` for the PROMPT TEXT ONLY —
// found via stress-test 1 (F7): a mid-tier model (kimi-k2.6) repeatedly
// wrote several genuinely different files all to write_file's path
// parameter set to a literal endpoint route like "/api/v1/notes", clobbering
// each write. Root cause: RestEndpoint.path (a backend ROUTE, e.g.
// "/api/v1/notes") and write_file's `path` parameter (a frontend FILE path,
// e.g. "app/notes/page.tsx") share the exact same key name "path" in the
// same prompt context, and the model conflated them. This does not touch
// RestEndpoint/BuildPlan itself — only how the contract is rendered into
// Aanya's prompt.
function renderApiContractForPrompt(apiContract: BuildPlan["apiContract"]): string {
  const renamed = {
    baseUrl: apiContract.baseUrl,
    endpoints: apiContract.endpoints.map(({ path, ...rest }) => ({ route: path, ...rest })),
  };
  return JSON.stringify(renamed, null, 2);
}

// 2026-08-04 (live, verify4617991): the prompt below tells the model "Every
// page must show real content from the project spec" — but the spec was never
// in the message. This renders the locked spec's features/user stories so that
// instruction refers to something the model can actually read. Exported for
// direct unit testing (index.test.ts) without a live LLM call.
export function formatFeaturesForPrompt(features: BuildPlan["features"]): string {
  if (!features || features.length === 0) return "";
  const blocks = features.map((f) => {
    const stories = (f.userStories ?? []).map((s) => `    - ${s}`).join("\n");
    return `- ${f.name}: ${f.description}${stories ? `\n  User stories:\n${stories}` : ""}`;
  });
  return `LOCKED SPEC — THE REQUIREMENTS YOU MUST SATISFY (this is "the project spec"):
Every feature below was explicitly requested. Build ALL of it. When a feature
names specific items (services, sections, fields), every single named item must
appear in the UI — a page that shows 4 of 9 named services is INCOMPLETE and
will be rejected.
${blocks.join("\n")}
`;
}

export function buildAgentTask(plan: BuildPlan, mode: "preview" | "integrate"): string {
  const backendUrl = plan.apiContract.baseUrl ?? "http://localhost:3001";
  const contractJson = renderApiContractForPrompt(plan.apiContract);

  const goal = mode === "preview"
    ? "Build a complete Next.js 16.2 frontend PREVIEW (mock data only, no backend calls yet) for this project."
    : "Wire the already-built and approved Next.js 16.2 frontend preview to the real backend API for this project.";

  const apiSection = mode === "preview"
    ? `BACKEND API CONTRACT (reference only — NOT running yet, do NOT call it; use it to shape your mock data):
${contractJson}`
    : `BACKEND API (running at ${backendUrl}):
${contractJson}`;

  const taskDetails = (plan.aanyaTasks || []).map((t, idx) => {
    return `Task ${idx + 1}: ${t.description}\nFiles to write:\n${t.outputFiles.map(f => `- ${f}`).join("\n")}`;
  }).join("\n\n");

  return `${goal}

PROJECT: ${plan.appName ?? "web app"}
DESCRIPTION: ${plan.appDescription ?? ""}

IMPORTANT — do not confuse these two unrelated things:
- Each endpoint's "route" below (e.g. "/api/v1/notes") is a BACKEND API ROUTE. It is reference-only context — never pass it as write_file's "path" argument.
- write_file's "path" argument is always a FRONTEND FILE PATH relative to the project root (e.g. "app/notes/page.tsx", "app/dashboard/page.tsx"). Every write_file call must use a distinct file path — never reuse the same path for two different pieces of content.

${apiSection}

SHARED TYPES (use these exact field names in your TypeScript interfaces):
${plan.sharedTypes ?? ""}

QUALITY BAR — INVESTOR DEMO TIER (read before writing any component):
This is NOT a tutorial or basic CRUD app. The quality bar is Tier 3-4:
  a Stripe landing page, a Linear dashboard, a Vercel analytics panel.
Do NOT produce: purple gradients on white cards, generic hero sections, stock shadcn layouts.
DO produce: a distinct visual identity — consistent dark theme using NexUI's void palette,
  a brand color hierarchy (primary action, secondary text, muted borders), deliberate
  typography scale, cards with real content and purposeful spacing.

${formatDesignBriefForPrompt(plan.designBrief)}

${formatFeaturesForPrompt(plan.features)}
CONTENT RULE — NO PLACEHOLDER TEXT:
Every page must show real content from the LOCKED SPEC above, NOT "Lorem ipsum" or "Coming soon".
User-facing copy must match what this specific app actually does.

USER FLOW:
A user signs up → logs in → sees a dashboard with real metrics/content → uses the core features
→ can manage their account. All transitions are smooth, with Button's isLoading
prop / Skeleton placeholders during loading states (see PANEL & SPINNER guidance
above — there is no Spinner component in this library).

PLANNED FRONTEND FILES AND PAGES (you MUST implement these pages and files as planned):
${taskDetails}

Start with list_files to see the scaffold, then write pages and components.` + answersBlock(plan.projectId);
}

// ── Static scaffold ───────────────────────────────────────────────────────────
// Found live during the Phase B stress-test gate: this previously read
// process.env.CLERK_PUBLISHABLE_KEY, but the real env var (see .env.example)
// is NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — the mismatch meant every generated
// preview build shipped an empty publishable key, crashing Next.js's static
// prerendering of /_not-found with "Missing publishableKey". Extracted as
// its own function (rather than inline in writeStaticScaffold's template
// string) so the env-var name is directly unit-testable.
// 2026-07-26 (agent-autonomy-assessment follow-on): was
// `process.env.JWT_SECRET || "default_dev_secret"` — a fixed, predictable
// fallback baked into every generated app whenever the env var was unset.
// Riya's deploy-time write (agents/riya/src/index.ts) always overwrites
// this file with a real generated secret before the app starts and is the
// authoritative source; this scaffold-time placeholder just must never be
// a fixed string either, in case anything reads it before Riya runs.
export function buildCustomEnvLocal(backendPort: string): string {
  const placeholder = process.env.JWT_SECRET || randomBytes(32).toString("hex");
  return `NEXT_PUBLIC_API_URL=http://localhost:${backendPort}
JWT_SECRET=${placeholder}
`;
}

// Diagnosis 2026-07-04 (stress2/stress3 forensics): "vendor" used to be
// required in exclude — the old whole-package-vendored NexUI source wasn't
// held to the generated project's React 19 typecheck (it shipped its own
// dist), and letting Next compile it cost every run 10-20 iterations of
// mystery build errors until a model rediscovered this exclusion.
// 2026-08-16 (aanya-nexui-migration Task 2): Task 1 replaced whole-package
// vendoring with @yugnex/cli copying individual component .tsx files into
// components/nexui/ — there is no vendor/ directory produced at all anymore
// (confirmed: vendorNexui's real, verified output path is
// outputDir/components/nexui/<name>.tsx). components/nexui/*.tsx are real,
// first-party project source now — the whole point of the shadcn/ui-style
// "you own the code" model is that the generated project's own TypeScript
// strictness applies to them, same as any file Aanya writes herself.
// "vendor" is dropped; node_modules stays excluded as always.
// Exported for direct unit testing.
export function buildScaffoldTsconfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2017", lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true, skipLibCheck: true, strict: true,
      noEmit: true, esModuleInterop: true, module: "esnext",
      moduleResolution: "bundler", resolveJsonModule: true,
      isolatedModules: true, jsx: "preserve", incremental: true,
      plugins: [{ name: "next" }],
      paths: { "@/*": ["./*"] },
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  }, null, 2);
}

// Same forensics: experimental.serverComponentsExternalPackages was renamed
// upstream in Next 15 and is invalid on the mandated Next 16.2 — Claude
// deleted it in both stress2 and stress3 (the identical edit each run). Ship
// the config without it.
// 2026-08-16 (aanya-nexui-migration Task 2): transpilePackages existed
// solely because the old @yugnex/nexui-react vendored package shipped raw
// TypeScript source that Next.js needed to be told to transpile.
// @yugnex/core ships pre-built dist/*.js + .d.ts (confirmed:
// node_modules/@yugnex/core/dist/{index,client}.js from a real `npm
// install`, not assumed from the README) — nothing needs transpiling.
// Verified empirically, not just asserted: a real `npm install` + `npx next
// build` against a minimal Next.js 16.2 project depending on @yugnex/core,
// with NO transpilePackages entry at all, compiled clean (Next 16.3.1/
// Turbopack, zero errors) — see this migration's plan doc for the full
// build log. Exported for direct unit testing.
export function buildScaffoldNextConfig(): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`;
}

// 2026-08-23: real bug found live (project a355bbb5fa35) — the scaffolded
// middleware only ever checked whether a token cookie EXISTED, never what
// role it carried, so any logged-in client could reach an /admin route and
// see its shell (headers, tables) even though every one of those requests
// then failed against the backend's own correctly role-checked API — a
// confusing wrong-role page shown to the wrong user, not a data leak. A
// project's users table having a `role` column is a generic, reliable,
// already-available signal (dbSchema is Arjun's deterministic output, not
// LLM-guessed) that THIS app actually has an admin/client distinction worth
// gating on — apps with no role column keep the exact prior behavior
// (token-presence only), so this changes nothing for the common case.
export function hasRoleColumn(plan: BuildPlan): boolean {
  return plan.dbSchema.tables.some((t) => t.columns.some((c) => c.name === "role"));
}

export function writeStaticScaffold(plan: BuildPlan, outputDir: string): void {
  const backendPort = plan.apiContract.baseUrl?.match(/:(\d+)/)?.[1] ?? "3001";
  const roleGated = hasRoleColumn(plan);

  const files: Array<{ path: string; content: string }> = [
    {
      path: "package.json",
      content: JSON.stringify({
        name: `${plan.projectId}-frontend`,
        version: "1.0.0",
        private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        // 2026-08-16 (aanya-nexui-migration Task 2): @yugnex/core is the
        // ONLY NexUI package installed as a real dependency now — components
        // themselves are copied in as source by Task 1's vendorNexui, not
        // installed from npm (shadcn/ui-style: "you own the code you ship").
        // "^0.1.0" confirmed live via `npm view @yugnex/core version` this
        // session (published on the public npm registry, not a private-only
        // package) — pin deliberately, bump when a newer version is verified.
        dependencies: {
          next: "^16.2.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          // 2026-09-27: ^0.1.0 never resolves 0.2.0 (0.x caret). 0.2.0's code
          // is byte-identical to 0.1.0 (version bump only), verified.
          "@yugnex/core": "^0.2.0",
        },
        devDependencies: {
          typescript: "^5.7.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@types/node": "^22.0.0",
        },
        // E2 (full-system audit): defense-in-depth alongside E1's
        // devDependency-stripping in vendorNexui() — forces a single
        // resolved version of react/react-dom/@types even if some future
        // vendored or third-party dependency's own manifest requests a
        // different one. Belt-and-suspenders, not a substitute for E1.
        overrides: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
        },
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: buildScaffoldTsconfig(),
    },
    {
      path: "next.config.ts",
      content: buildScaffoldNextConfig(),
    },
    {
      // 2026-07-28: real bug found live — every generated app used NexUI's
      // ONE fixed dark palette + hardcoded Inter font with zero per-project
      // variation, even though Vanya's real designBrief (palette/typeface/
      // mood) was already computed and available on `plan` — it was just
      // never read.
      // 2026-08-16 (aanya-nexui-migration Task 2): colors no longer live
      // here. @yugnex/core's createTheme()/ThemeProvider (see layout.tsx
      // below) is the real, cascade-safe mechanism for per-project color —
      // verified empirically this session that overrides passed to
      // createTheme() land in the SAME SSR-flushed stylesheet as the base
      // theme, so there is no longer a "later runtime injection wins"
      // problem for a static file to lose to. This file now covers the ONE
      // real gap createTheme() leaves open: typography (confirmed against
      // @yugnex/core's actual ThemeOverrides type — colors only, no font
      // slot). buildFontOverrideCss sets a literal font-family on
      // html/body/headings, deliberately NOT touching the --nx-font-family-*
      // CSS variable NexUI's own vendored components read internally — see
      // theme.ts's header comment for why that avoids reintroducing the old
      // cascade-race bug class in a new shape.
      path: "app/theme-overrides.css",
      content: buildFontOverrideCss(plan.designBrief),
    },
    {
      // 2026-10-02: in-house NexUI fonts only, served from the app's own
      // /fonts folder (files copied below) — never Google Fonts.
      path: "app/fonts.css",
      content: inHouseFontFaceCss(usedInHouseFonts(plan.designBrief)),
    },
    {
      // 2026-08-16 (aanya-nexui-migration Task 2): @yugnex/core ships ZERO
      // CSS files (confirmed: a real `npm install` of @yugnex/core@0.1.0 —
      // node_modules/@yugnex/core/dist/ contains only .js/.d.ts/.map, no
      // nexui-tokens.css/nexui-base.css equivalent in any form) — token
      // injection happens entirely at runtime via <ThemeProvider> in
      // layout.tsx, not a static @import. The reset/base rules below now
      // reference @yugnex/core's real CSS custom-property names
      // (--nx-color-background, --nx-color-foreground, --nx-color-primary —
      // confirmed against packages/core/src/theme/createTheme.ts's cssVarName
      // convention: `--nx-${kebab(path)}`), not the old --nx-bg-base/--nx-text
      // names, which no longer exist in this system.
      path: "app/globals.css",
      content: `@import "./fonts.css";
@import "./theme-overrides.css";

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: var(--nx-font-size-base);
  color: var(--nx-color-foreground);
  background: var(--nx-color-background);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  min-height: 100vh;
  background: var(--nx-color-background);
  color: var(--nx-color-foreground);
}

a {
  color: var(--nx-color-primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
`,
    },
    {
      path: "app/layout.tsx",
      // 2026-08-16 (aanya-nexui-migration Task 2): replaces NexuiProvider
      // (@yugnex/nexui-react) with @yugnex/core's real provider stack.
      // Import split confirmed against the ACTUAL published dist/*.d.ts
      // (not the README's usage example, which is wrong — a real `next
      // build` against the README's exact import shape fails with "Module
      // '@yugnex/core/client' has no exported member 'NoFoucScript'"):
      // StyleRegistry/ThemeProvider are "use client" exports, only on
      // "@yugnex/core/client"; NoFoucScript and createTheme are server-safe
      // (no hooks) and only live on the main "@yugnex/core" entry.
      //
      // The old NexuiProvider customTokens race (2026-08-06: a runtime
      // effect-injected <style> tag always won the cascade over a
      // statically-imported CSS file, regardless of import order) does NOT
      // recur here: createTheme(buildThemeOverrideTokens(...)) bakes this
      // project's real per-project colors into the ONE theme object passed
      // to <ThemeProvider>, and ThemeProvider injects that theme's CSS
      // synchronously during render (SSR included, flushed by
      // <StyleRegistry> via Next's useServerInsertedHTML) — there is no
      // second, later style source for anything to lose a fight against.
      // Verified empirically, not assumed: real `npm install` + `next
      // build` + `next start` + raw HTML fetch of the rendered page showed
      // the override colors present in the very first SSR-flushed
      // stylesheet (see this migration's plan doc for the full build/output
      // log).
      //
      // defaultColorMode is pinned to themeColorMode(plan.designBrief) —
      // matching the OLD system's fixed single "void" theme (never a
      // system-preference-driven light/dark switch a design brief was never
      // built to describe two variants for).
      // 2026-08-23: real bug found live (project a355bbb5fa35) — Header.tsx/
      // Footer.tsx were real, well-built components that no page or layout
      // ever imported, so the delivered app had no site navigation on any
      // route. Leaving that wiring to the LLM's own judgment is exactly the
      // kind of structural requirement this scaffold already treats as
      // deterministic (theme setup, StyleRegistry, NoFoucScript) rather than
      // optional — so it's imported here unconditionally. This also turns a
      // silent content gap into a hard `next build` failure ("Module not
      // found: '@/components/layout/Header'") if Aanya skips creating them,
      // caught by her own existing pre-task_complete build gate — see the
      // matching "FILES YOU MUST WRITE" entry in AANYA_SYSTEM_PROMPT above.
      content: `import type { ReactNode } from "react";
import { StyleRegistry, ThemeProvider } from "@yugnex/core/client";
import { createTheme, NoFoucScript } from "@yugnex/core";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

export const metadata = {
  title: "${plan.appName ?? "App"}",
  description: "${plan.appDescription ?? ""}",
};

const projectTheme = createTheme(${JSON.stringify(buildThemeOverrideTokens(plan.designBrief), null, 2)});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <NoFoucScript />
      </head>
      <body>
        <StyleRegistry>
          <ThemeProvider theme={projectTheme} defaultColorMode="${themeColorMode(plan.designBrief)}">
            <Header />
            {children}
            <Footer />
          </ThemeProvider>
        </StyleRegistry>
      </body>
    </html>
  );
}
`,
    },
    {
      // 2026-08-10: real bug found live (project rivhdw1) — this used to
      // write "proxy.ts". Next.js 16.2 ONLY recognizes "middleware.ts" as
      // its routing-middleware convention (confirmed directly this
      // session: real request logs show traffic only ever reaches a file
      // named middleware.ts — "proxy.ts" is just an inert file the
      // framework never invokes). The old comment here ("Next.js rejects
      // having both proxy.ts and middleware.ts present") was never true —
      // Next.js simply ignores proxy.ts entirely. This silently disabled
      // server-side auth redirect on every generated app (client-side
      // redirects were the only real gate) until a QA round caught it,
      // per-project, every single time. Fixed at the source instead.
      path: "middleware.ts",
      content: roleGated
        ? `import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPaths = ["/sign-in", "/sign-up"];
// Any path prefix here requires role === "admin", not just a valid token.
// Extend this list if the plan adds more admin-only sections.
const adminPaths = ["/admin"];

// Edge Middleware runs in a restricted runtime without Node's crypto/
// jsonwebtoken — the backend's own signature-verified role check on every
// /api request is the real security boundary and is unaffected by this
// file. This only decodes the JWT payload (no signature check) to redirect
// the wrong role away from a page's shell before it renders.
function decodeRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path.startsWith(p));
  const token = request.cookies.get("token")?.value;

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  if (token && adminPaths.some((p) => path.startsWith(p)) && decodeRole(token) !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|[^?]*\\.(?:css|js|png|jpg|svg|ico|webp|woff2?)).*)",
    "/(api|trpc)(.*)",
  ],
};
`
        : `import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPaths = ["/sign-in", "/sign-up"];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path.startsWith(p));
  const token = request.cookies.get("token")?.value;

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|[^?]*\\.(?:css|js|png|jpg|svg|ico|webp|woff2?)).*)",
    "/(api|trpc)(.*)",
  ],
};
`,
    },
    {
      path: ".env.local",
      content: buildCustomEnvLocal(backendPort),
    },
  ];

  for (const { path: relPath, content } of files) {
    const parts = relPath.split("/");
    if (parts.length > 1) {
      mkdirSync(join(outputDir, ...parts.slice(0, -1)), { recursive: true });
    }
    writeFileSync(join(outputDir, relPath), content, "utf-8");
  }

  vendorInHouseFonts(outputDir, usedInHouseFonts(plan.designBrief));
  vendorYugnexLogo(outputDir);
}
