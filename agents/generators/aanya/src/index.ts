// Aanya — Next.js 16.2 frontend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run next build → fix → repeat.
// UI: @yugnex/core (NexSidi's own UI runtime) + vendored components/nexui/*.tsx — NO Tailwind, NO shadcn/ui.

import { resolveGeneratorRunner } from "@nexsidi/agent-runtime";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { join } from "path";
import type { BuildPlan } from "../../../arjun/src/index.ts";
import { buildSystemContext } from "../../../arjun/src/index.ts";
import { formatDesignBriefForPrompt } from "../../../vanya/src/index.ts";
import { buildFontOverrideCss, buildThemeOverrideTokens, themeColorMode } from "./theme.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";
import { loadAndInjectContract } from "../../../../pipeline/orchestrator/stages/contract-extractor.ts";

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId, "frontend");
}

// 2026-07-08: see agents/generators/shubham/src/index.ts's identical helper
// for the full rationale (Patent Claim 2's instinct memory finally wired
// up, read side). Fails safe: memory is an enrichment, not a hard
// dependency.
async function loadKnownMistakesPrefix(): Promise<string> {
  try {
    const { queryRecentInstincts, formatInstinctsForPrompt, REACHABLE_INSTINCT_DOMAINS } = await import("@nexsidi/db");
    // 2026-07-24 (P3.W3.3): was hardcoded to "security" only — missed every
    // performance/architecture instinct QA ever recorded. See
    // queryRecentInstincts's comment for the bug this closes.
    const instincts = await queryRecentInstincts(REACHABLE_INSTINCT_DOMAINS);
    const formatted = formatInstinctsForPrompt(instincts);
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
export async function run(plan: BuildPlan, mode: "preview" | "integrate"): Promise<GeneratorResult> {
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
  vendorNexui(outputDir);

  // 2. Write static scaffold
  writeStaticScaffold(plan, outputDir);

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
  const knownMistakesPrefix = await loadKnownMistakesPrefix();

  const result = await resolveGeneratorRunner()({
    agentName: "aanya",
    model: "mistralai/mistral-medium-3.5-128b",
    // 2026-07-24: qwen3.5-122b-a10b (chosen for being a genuinely different
    // architecture from the primary) returns HTTP 410 Gone as of 2026-07-20
    // — the NIM endpoint was permanently removed (see types.ts's ModelId
    // comment). Using it as a fallback meant a real failure of the primary
    // model fell through to a fallback that would ALWAYS also fail. Swapped
    // for qwen3-next-80b, the documented working replacement.
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey,
    systemPrompt: loadAndInjectContract(plan.projectId, knownMistakesPrefix + buildAgentPrompt(mode)),
    initialMessage: buildAgentTask(plan, mode),
    sandboxDir: outputDir,
    projectId: plan.projectId,
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
    // 2026-08-10: for the UI-BASED CRUD SELF-CHECK (integrate mode only —
    // harmless to enable unconditionally in preview mode too, since there's
    // no reason for her to call it there and the prompt never tells her
    // to). Lets her confirm a form submission actually changed the
    // database, not just that the UI re-rendered optimistically.
    enableDbQuery: true,
    requiredVerificationCommands: ["npx tsc --noEmit", "npx next build"],
    // 2026-08-10: mechanically blocks task_complete without at least one
    // real screenshot review this run — same enforcement pattern as
    // Shubham's requiredEvidenceKinds(["http_check"]), for the same reason
    // (a prompt instruction alone is followed probabilistically). Scoped to
    // multi-page projects only (see countPlannedPages's header comment) so
    // a genuine single-page app, which the prompt explicitly allows to skip
    // this step, is never hard-blocked with no way to satisfy the gate.
    requiredEvidenceKinds: countPlannedPages(plan) > 1 ? (["visual_check"] as const) : [],
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
    maxIterations: 90,
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
  return `An adversarial QA review found the following issues in the frontend code you already wrote.

${buildSystemContext(plan)}

ISSUES TO FIX:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Each finding is a SYMPTOM, not necessarily the whole problem. Before editing:
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
4. Call task_complete with verification_passed: true only after verifying the fix actually addresses the root cause, not just silences the symptom`;
}

export async function runFix(plan: BuildPlan, findings: string[]): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId); // SAME dir run() wrote to — not regenerated
  // F7 (agent-autonomy-assessment): mirrors Shubham's identical fix — see
  // that file for the full rationale.
  const knownMistakesPrefix = await loadKnownMistakesPrefix();

  const result = await resolveGeneratorRunner()({
    agentName: "aanya",
    model: "mistralai/mistral-medium-3.5-128b",
    // 2026-07-24: see run()'s identical fix above — qwen3.5-122b-a10b 410s
    // (endpoint permanently removed 2026-07-20); swapped for the documented
    // working replacement, qwen3-next-80b.
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey,
    systemPrompt: knownMistakesPrefix + buildAgentPrompt("integrate"), // fix always happens post-integrate, per Stage 5's placement after Stage 4
    initialMessage: buildFixTask(findings, plan),
    sandboxDir: outputDir,
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
    enableDockerTools: true,
    requiredVerificationCommands: ["npx tsc --noEmit", "npx next build"],
    // 2026-08-10: same gate as run() above — see its comment.
    requiredEvidenceKinds: countPlannedPages(plan) > 1 ? (["visual_check"] as const) : [],
    // 2026-07-25: reverted the maxIterations override — see run() above.
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
const NEXUI_CLI_VERSION = "0.1.1";

export type VendorExecFn = (command: string, options: { cwd: string }) => string;

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

const defaultVendorExecFn: VendorExecFn = (command, options) =>
  execSync(command, {
    cwd: options.cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: VENDOR_EXEC_TIMEOUT_MS,
  });

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

export function vendorNexui(
  outputDir: string,
  components: readonly string[] = NEXUI_CONFIRMED_COMPONENTS,
  execFn: VendorExecFn = defaultVendorExecFn,
): void {
  const registryUrl = process.env.NEXUI_REGISTRY_URL ?? DEFAULT_NEXUI_REGISTRY_URL;
  const cli = `npx --yes @yugnex/cli@${NEXUI_CLI_VERSION}`;

  execFn(`${cli} init --yes --registry "${registryUrl}"`, { cwd: outputDir });

  if (components.length > 0) {
    const names = components.map((name) => `"${name}"`).join(" ");
    execFn(`${cli} add ${names} --yes --registry "${registryUrl}"`, { cwd: outputDir });

    const missing = missingVendoredComponents(outputDir, components);
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

// 2026-08-08: explicit user request — the real YugNex logo (packages/
// agent-runtime/assets/yugnex-logo.png, source: E:/ai yug/logo/YugNex_
// Transparent.png, trimmed to content + resized 2048x2048 -> 137x96 via
// sharp, alpha channel preserved). Embedded as a data URI rather than
// copied into each generated app's public/ folder: it's a FIXED, never-
// changing constant, so it becomes part of the stable prompt prefix every
// call shares — implicit prompt caching (see gemini.ts's comments on
// Vertex's automatic caching of repeated byte-identical prefixes) means
// this is billed once per cache window, not once per call, and it avoids
// a whole extra file-copy step in generation that could be forgotten.
export const YUGNEX_LOGO_DATA_URI =
  "data:image/png;base64,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";

// ── Agent system prompt ───────────────────────────────────────────────────────
// Shared base (stack rules, NexUI usage, layout patterns, critical rules) is the
// same regardless of mode. Mode-specific addenda below tell Aanya whether this
// is a mock-data-only preview build (Stage 3, pre-approval) or a real-backend
// integration pass (post-approval, wiring the locked preview to live APIs).
const AANYA_SHARED_PROMPT_BASE = `\
You are Aanya, a senior Next.js 16.2 + TypeScript frontend engineer.
You have tools to write files and run commands. DO NOT output text — USE TOOLS.

PLAN-THEN-EXECUTE — this is the most important rule in this prompt:
Your task message lists the COMPLETE, exhaustive file manifest under
"PLANNED FRONTEND FILES AND PAGES." Do not discover the app one file at a
time by writing something and immediately rebuilding — you already have the
whole plan. Write EVERY planned file before you run "npx next build" even
once. Building after each individual file is the exact waste this workflow
exists to remove.

Your workflow:
1. Use list_files ONCE (recursive) to understand the scaffold already present
2. Use write_file to create EVERY planned page, component, hook, and utility
   — BATCH your work: emit SEVERAL write_file calls in the SAME response
   (3-4 files per turn). One file per turn wastes most of your iteration
   budget on round trips, and so does building before the plan is complete.
3. Once every planned file is written: run_command "npm install" once.
4. Use run_command "npx next build" ONCE to verify the build passes.
5. If build fails: read the error, fix ALL the errors it reports in one
   batched pass (edit_file for small changes — cheaper than rewriting the
   whole file), THEN rebuild ONCE more to confirm — do not rebuild after
   fixing a single error in isolation.
6. Once the build passes: do the CLICK-THROUGH NAVIGATION VERIFICATION below.
7. Only after both pass: call task_complete with verification_passed: true

CLICK-THROUGH NAVIGATION VERIFICATION (required whenever you wrote more than
one page/route — skip only for a genuine single-page app, and say so in your
task_complete summary if you skip it):
"npx next build" proves the code compiles. It proves NOTHING about whether
clicking your own nav links actually goes where they say, or whether a page
renders real content instead of a blank screen or a thrown error. That gap is
exactly what this closes — you are the one person who can verify it before
anyone else ever sees this code.
  a) Write a minimal Dockerfile (disposable — for this check only; Riya
     writes the real deployment one later, do not treat this as final) and a
     docker-compose.yml that builds this project and maps it to a free host
     port. Start it with docker_compose up.
     Do NOT use run_command to start the server directly ("npm run dev",
     "next start", etc.) — run_command waits for the process to EXIT before
     returning, and a server never exits on its own, so that call will hang
     until it times out. Docker's "up -d" returns once the container is
     confirmed running, which is why this works and a bare run_command does not.
  b) browser_navigate to the running app's root URL. Use browser_get_text to
     confirm real page content rendered (not a blank page, not a Next.js
     error overlay) and browser_console_errors to confirm zero JS errors.
  c) For EVERY nav link you wrote (header/footer/sidebar — wherever you put
     primary navigation): browser_click it, then browser_current_url to
     confirm it actually navigated to the URL that link is supposed to point
     to — not back to home, not to a 404, not to a different page than its
     label says. A "Contact" link that lands anywhere but your contact page
     is a real bug, not a formality — fix the href/route, don't adjust what
     you consider "close enough."
  d) browser_get_text on at least one page beyond the homepage to confirm it
     shows real content matching what you were asked to build (not
     placeholder/lorem text, not an empty state where content should be).
  e) VISUAL QUALITY CHECK (required, not optional — task_complete is
     mechanically blocked without it): call browser_screenshot on at least
     the homepage. Then actually LOOK at the returned image before deciding
     it's fine — this is a real judgment step, not a formality:
       - Text renders as real glyphs, not overlapping/garbled/mojibake
         characters (a font that 404'd and fell back produces exactly this —
         if you see it, the fix is almost always a missing static asset, not
         a CSS change).
       - Spacing is consistent: no text touching its container edge, no
         two elements overlapping, no visibly broken alignment.
       - The page looks like a coherent design, not unstyled/default HTML.
     If anything looks wrong, fix it and re-screenshot before moving on —
     do not hand off a visual defect for someone else to notice later.
  f) docker_compose down to tear down when finished.
  Budget ≤12 tool calls total for a-f. This is NOT the same check Tier 3
  (Tilotma) does — Tier 3 runs after full deployment, minutes or hours later,
  auditing the finished product; this is you verifying the code you JUST
  wrote actually behaves the way it looks like it should, before it ever
  reaches that stage. Catching it here costs one extra tool call; catching it
  at Tier 3 costs a full deploy-review-report-refix-redeploy cycle.

STACK (non-negotiable):
- Next.js 16.2 / TypeScript / React 19
- UI: @yugnex/core — the NexSidi in-house UI runtime (styling engine + theme system).
  Individual component SOURCE FILES are already vendored into components/nexui/*.tsx
  by the scaffold (shadcn/ui-style: these are YOUR OWN project files, not an
  installed package) — import each component from its own file via the "@/..."
  alias, e.g. import { Button } from "@/components/nexui/button". There is no
  barrel/index file re-exporting everything from one path — import each
  component from its own file.
  Components available: Button, Card (+ CardHeader/CardTitle/CardDescription/
              CardBody/CardFooter), Input, Badge, Checkbox, Modal (+ ModalContent/
              ModalHeader/ModalTitle/ModalDescription/ModalFooter), Tabs
              (+ TabsList/TabsTrigger/TabsPanel), Select (+ SelectField), Tooltip,
              Switch, Progress, Skeleton, Avatar, Separator
  There is NO Panel and NO Spinner component in this library — see "PANEL &
  SPINNER" inside NEXUI COMPONENT API below for the real replacement patterns.
  Theme: StyleRegistry + ThemeProvider (from @yugnex/core/client) wrap the app
  in layout.tsx (already in scaffold) — this project's colors are already wired
  in via createTheme(); do NOT add a second theme/provider or re-wrap the app.
  NEVER use Tailwind, shadcn/ui, @radix-ui, or any external UI library
  NEVER use @apply in CSS — use the css()/theme object from @yugnex/core (see
  NEXUI CSS VARIABLES below), or raw var(--nx-color-*)/var(--nx-space-*)/
  var(--nx-radius-*) CSS variables directly
  IMPORTANT: these components do NOT submit parent forms automatically on
  click. Always add onClick={handleSubmit} directly to your form's Button
  components to submit forms explicitly.
- Auth: Custom JWT authentication. You MUST write/generate:
  1. A custom sign-up/sign-in page (using custom API calls to the backend /api/v1/auth/login and /api/v1/auth/register).
  2. Parse the backend auth response correctly — the backend wraps ALL responses in a { success: boolean, data: {...} } envelope. For auth endpoints the token is at body.data.token, NOT body.token. Example:
       const body = await res.json();
       if (!res.ok || !body.success) { setError(body.error ?? "Request failed"); return; }
       const token = body.data.token;  // CORRECT — body.data.token, not body.token
       document.cookie = \`token=\${token}; path=/\`;
  3. Store the JWT token in cookies (e.g., set 'token' cookie) or localStorage.
  4. Include the token as an Authorization Bearer header in all backend API requests.
- API calls: see the MODE-specific instructions at the end of this prompt for
  whether to call the backend now or use mock data instead

NEXUI COMPONENT API — COMPLETE REFERENCE (verified directly against each
component's real source file — do NOT read the vendor source yourself,
everything you need is here; do NOT assume any prop from the OLD
@yugnex/nexui-react API still applies — several are renamed or gone):

  // Button — props: variant? "solid"|"outline"|"ghost"|"soft" (default
  //   "solid" — NOT "primary", that value does not exist), tone?
  //   "primary"|"destructive" (default "primary"), size? "sm"|"md"|"lg"
  //   (default "md"), isLoading? (boolean — renders its own inline spinner
  //   and disables the button; no separate Spinner needed), asChild? (boolean
  //   — renders your single child element, e.g. a Next.js <Link>, with
  //   Button's classes/ref instead of a <button>).
  import { Button } from "@/components/nexui/button";
  <Button variant="solid" tone="primary" size="md">Click</Button>   // primary CTA
  <Button variant="ghost" size="sm">Cancel</Button>                  // ghost button
  <Button variant="outline" tone="destructive">Delete</Button>       // destructive action
  <Button isLoading>Saving…</Button>                                 // built-in loading spinner

  // Card — plain container components: no custom props beyond standard HTML
  //   attributes + className. Card/CardBody/CardFooter render a <div>,
  //   CardHeader a <div>, CardTitle an <h3>, CardDescription a <p>.
  import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
  <Card>
    <CardHeader><CardTitle>Title</CardTitle><CardDescription>Subtitle</CardDescription></CardHeader>
    <CardBody>...content...</CardBody>
    <CardFooter><Button size="sm">Save</Button></CardFooter>
  </Card>

  // Input — props: label? (ReactNode), description? (ReactNode, helper text
  //   below the field), error? (ReactNode, replaces description when set),
  //   plus every native <input> attribute (value, onChange, placeholder, type...).
  import { Input } from "@/components/nexui/input";
  <Input label="Title" placeholder="Enter..." value={v} onChange={(e) => setV(e.target.value)} />
  <Input label="Email" type="email" error={emailError} />

  // Badge — props: variant? "solid"|"soft"|"outline" (default "solid"), tone?
  //   "primary"|"secondary"|"success"|"warning"|"destructive" (default
  //   "primary" — success/warning are TONES, not variants), size? "sm"|"md".
  import { Badge } from "@/components/nexui/badge";
  <Badge variant="soft" tone="success">Done</Badge>       // success badge
  <Badge variant="soft" tone="warning">Pending</Badge>    // pending badge

  // Checkbox — props: checked? (boolean | "indeterminate"), defaultChecked?,
  //   onCheckedChange? (checked: boolean | "indeterminate") => void — NOT
  //   onChange. No built-in label prop — wrap it in your own <label> so the
  //   label text is clickable too.
  import { Checkbox } from "@/components/nexui/checkbox";
  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
    <Checkbox checked={done} onCheckedChange={(c) => setDone(c === true)} />
    Complete
  </label>

  PANEL & SPINNER — NO EQUIVALENT COMPONENT EXISTS IN THIS LIBRARY. Do not
  import either name; they will not resolve.
  - Generic layout surface (replaces the old Panel component): call css() from
    @yugnex/core directly, ONCE at module scope (not inside the component
    body — every vendored component builds its own classnames this same way):
      import { css, themeVars as theme } from "@yugnex/core";
      const panelClass = css({
        padding: theme.space[6],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.card,
        border: \`1px solid \${theme.color.border}\`,
      });
      // then: <div className={panelClass}>...</div>
    Reserve Card/CardHeader/CardBody/CardFooter for genuinely card-shaped
    content (a bordered block with title+description+body+footer). Use
    css() for every other wrapper that just needs padding/background/radius.
  - Button-scoped loading (replaces the old standalone spinner component
    previously used inside a button): use Button's own isLoading prop —
    <Button isLoading>Saving…</Button> — it already renders an inline
    spinner; do not add a separate one next to it.
  - Non-button loading states (a page or section fetching data): prefer
    Skeleton — a content-shaped placeholder, closer to what modern design
    systems recommend over a bare spinner —
    <Skeleton shape="rect" width="100%" height="120px" />. Only when
    neither Button's isLoading nor Skeleton genuinely fits, build a small
    inline spinner using the same keyframes()/css() technique NexUI's own
    button.tsx uses internally for its isLoading state, adapted for
    standalone use:
      import { css, keyframes, themeVars as theme } from "@yugnex/core";
      const spin = keyframes({ from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } });
      const spinnerClass = css({
        width: "1.5rem", height: "1.5rem", borderRadius: "9999px",
        border: \`2px solid \${theme.color.border}\`,
        borderTopColor: theme.color.primary,
        animation: \`\${spin} 0.6s linear infinite\`,
      });
      // then: <span className={spinnerClass} aria-hidden="true" />

  // Modal — a compound component, controlled via open/onOpenChange (NOT
  //   onClose). There is no title/footer/size/closeable prop — compose
  //   ModalHeader/ModalTitle/ModalDescription/ModalFooter as children of
  //   ModalContent instead.
  import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from "@/components/nexui/modal";
  <Modal open={isOpen} onOpenChange={setOpen}>
    <ModalContent>
      <ModalHeader><ModalTitle>Edit task</ModalTitle></ModalHeader>
      ...form fields...
      <ModalFooter><Button onClick={save}>Save</Button></ModalFooter>
    </ModalContent>
  </Modal>

  // Select — a DATA-DRIVEN dropdown: pass an options array as a prop. There
  //   is NO SelectItem/SelectGroup compound-children API. Props: options
  //   ({ value, label, description?, disabled?, group? }[], required), value?/
  //   defaultValue?/onValueChange? (value: string) => void, placeholder?
  //   (default "Select…"), disabled?, label? (accessible name), id?. Use
  //   SelectField (same props plus fieldLabel?/description?/error?) for a
  //   version with a visible label rendered above the control.
  import { SelectField } from "@/components/nexui/select";
  <SelectField
    fieldLabel="Priority"
    placeholder="Choose..."
    value={priority}
    onValueChange={setPriority}
    options={[
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
      { value: "none", label: "None", group: "Other" },
    ]}
  />

  // Tabs — value/onValueChange controlled, or defaultValue uncontrolled. The
  //   panel component is TabsPanel — NOT TabsContent.
  import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/nexui/tabs";
  <Tabs defaultValue="all">
    <TabsList>
      <TabsTrigger value="all">All</TabsTrigger>
      <TabsTrigger value="done">Done</TabsTrigger>
    </TabsList>
    <TabsPanel value="all">...</TabsPanel>
    <TabsPanel value="done">...</TabsPanel>
  </Tabs>

  // Tooltip — props: content (ReactNode, required), children (a single
  //   ReactElement, required — must forward its ref), placement? (Placement,
  //   default "top" — the prop is named "placement", NOT "side"), delay?
  //   (ms, default 200 — NOT 400). No "disabled" prop; conditionally skip
  //   rendering the Tooltip wrapper instead.
  import { Tooltip } from "@/components/nexui/tooltip";
  <Tooltip content="Delete this task" placement="top"><Button variant="ghost" size="sm">X</Button></Tooltip>

  // Switch — props: checked?/defaultChecked? (boolean), onCheckedChange?
  //   (checked: boolean) => void — NOT onChange. No label/size/color props —
  //   wrap it in your own <label>, the same pattern as Checkbox above.
  import { Switch } from "@/components/nexui/switch";
  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
    <Switch checked={enabled} onCheckedChange={setEnabled} />
    Notifications
  </label>

  // Progress — a LINEAR bar only, there is no "circular" variant. Props:
  //   value? (0-max; omit for an indeterminate sliding bar), max? (default
  //   100), size? "sm"|"md"|"lg" (default "md"), tone?
  //   "primary"|"success"|"warning"|"destructive" (default "primary" — the
  //   prop is named "tone", NOT "color"), label? (string, used as the
  //   accessible aria-label only — it is NOT rendered as visible text).
  import { Progress } from "@/components/nexui/progress";
  <Progress value={65} tone="primary" label="Completion" />

  // Skeleton — props: shape? "text"|"circle"|"rect" (default "rect" — the
  //   prop is named "shape", NOT "variant"), animation? "pulse"|"shimmer"|
  //   "none" (default "shimmer"), width?/height? (CSS width/height values),
  //   lines? (number — stacks that many text-shaped lines for shape="text",
  //   the last one rendered shorter, like real prose).
  import { Skeleton } from "@/components/nexui/skeleton";
  <Skeleton shape="text" lines={3} />
  <Skeleton shape="rect" width="100%" height="120px" />
  <Skeleton shape="circle" width={40} height={40} />

  // Avatar — props: src?, alt?, fallback? (string shown when there's no
  //   image or it fails to load — defaults to the first 2 letters of alt,
  //   uppercased), size? (a NUMBER in pixels, default 40 — NOT a
  //   "sm"|"md"|"lg" string).
  import { Avatar } from "@/components/nexui/avatar";
  <Avatar src={user.avatarUrl} alt={user.name} size={40} />

  // Separator — props: orientation? "horizontal"|"vertical" (default
  //   "horizontal"), decorative? (boolean, default true), children?
  //   (optional — renders a centered label with rules on both sides instead
  //   of a plain line).
  import { Separator } from "@/components/nexui/separator";
  <Separator />
  <Separator orientation="vertical" />
  <Separator>OR</Separator>

  // Toast — NOT one of the vendored components (this scaffold does not copy
  //   it into components/nexui/, and its real API — toast()/dismissToast()
  //   functions plus a <ToastViewport /> you would have to mount yourself
  //   near the root, NOT a <ToastProvider>/useToast() hook the way the old
  //   library worked) needs setup this scaffold does not provide. Do NOT
  //   import it. Use an inline Badge, a small css() status surface (see
  //   PANEL above), or plain conditional text for save/error confirmations
  //   instead.

NEXUI CSS VARIABLES (verified against @yugnex/core's real theme tokens —
packages/core/src/theme/{createTheme,tokens}.ts — naming convention is
--nx-{kebab-case-path}, a different naming scheme than the previous UI
library used; only the names listed below exist in this system):
  Prefer the typed theme object inside css({...}) calls —
  import { themeVars as theme } from "@yugnex/core"; theme.color.primary IS
  the exact string var(--nx-color-primary), just with autocomplete/type
  safety. Use the raw var(--nx-*) strings only in a plain .css file (e.g.
  globals.css) where you can't import the theme object.

  Color (24 semantic slots, both light and dark values supplied by the
  project's own ThemeProvider — you never choose light vs. dark yourself):
  var(--nx-color-background)    var(--nx-color-foreground)
  var(--nx-color-card)          var(--nx-color-card-foreground)
  var(--nx-color-popover)       var(--nx-color-popover-foreground)
  var(--nx-color-primary)       var(--nx-color-primary-foreground)
  var(--nx-color-secondary)     var(--nx-color-secondary-foreground)
  var(--nx-color-muted)         var(--nx-color-muted-foreground)
  var(--nx-color-accent)        var(--nx-color-accent-foreground)
  var(--nx-color-destructive)   var(--nx-color-destructive-foreground)
  var(--nx-color-success)       var(--nx-color-success-foreground)
  var(--nx-color-warning)       var(--nx-color-warning-foreground)
  var(--nx-color-border)        var(--nx-color-input)
  var(--nx-color-ring)          var(--nx-color-overlay)

  Spacing/radius (same theme.* access pattern, e.g. theme.space[6] is
  var(--nx-space-6), theme.radius.lg is var(--nx-radius-lg)):
  space scale: 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24 (rem-based)
  radius scale: none, sm, md, lg, xl, full

LAYOUT PATTERNS:
  Use css() (see PANEL & SPINNER above) and gap for generic layout surfaces —
  never Tailwind grid classes, and never a Panel component (it does not exist
  in this library). Reserve Card for genuinely card-shaped content. Do NOT default to
  a generic nav+centered-hero+auto-fill-card-grid page structure. Derive the
  actual page structure (hero shape, section order, grid vs. list vs.
  dense-table layout, spacing rhythm) from the "Layout concept" line in the
  DESIGN IDENTITY section of your task below — that description is specific
  to THIS project and is what should drive your structural decisions, not a
  one-size-fits-all example.

STATIC FILES ALREADY WRITTEN (DO NOT rewrite unless you need to fix a bug):
- package.json (with @yugnex/core as a real npm dependency — components under
  components/nexui/ are your own project source, not an installed package)
- app/layout.tsx (StyleRegistry + ThemeProvider from @yugnex/core/client,
  plus NoFoucScript + createTheme from the main @yugnex/core entry — this
  project's colors are already wired in, do not replace with a different
  theme setup)
- app/globals.css (base reset using @yugnex/core's --nx-color-* variables —
  NO @apply Tailwind directives)
- app/theme-overrides.css (this project's font-family override — imported by
  globals.css, do not remove the import)
- middleware.ts (custom JWT cookie-based auth middleware for Next.js 16.2 —
  this IS the real, framework-recognized filename; do not rename it)
- next.config.ts
- tsconfig.json
- components/nexui/*.tsx (vendored NexUI component source — see NEXUI
  COMPONENT API below for what's actually available; edit these only to fix
  a genuine bug, never to add Tailwind/shadcn/ui-style classes)

FILES YOU MUST WRITE:
You MUST create all pages, routes, and components listed in the "PLANNED FRONTEND FILES AND PAGES" section of your task description. Typically this includes:
- app/page.tsx (landing / sign-in redirect)
- Dedicated routing files for each planned page (e.g., app/about/page.tsx, app/services/page.tsx, app/contact/page.tsx, app/dashboard/page.tsx)
- Do NOT consolidate separate public pages (about, services, contact) into dashboard tabs unless the plan explicitly requests it. Create separate dedicated file routes for them.

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
    (not a placeholder) — use this exact img tag verbatim, do not redraw it:
    <img src="${YUGNEX_LOGO_DATA_URI}" alt="YugNex" width="69" height="48" style={{ height: "24px", width: "auto", opacity: 0.75 }} />
    Footer structure, e.g.:
    © 2026 TaskFlow. All rights reserved.
    [the img tag above] Developed & Managed by YugNex™
    YugNex™ is a trademark of YugNex Technology (OPC) Private Limited.
    The SVG uses currentColor so it inherits the footer's own text color —
    never hardcode a fill color on it. Keep this block visually quiet
    (small, muted opacity) — it is attribution, not a second brand competing
    with the app's own identity.
12. NO HARDCODED STATUS BADGES: NEVER render a "Connected", "Online", "Active",
    or "API Connected" badge unconditionally. A status badge must reflect ACTUAL
    runtime state — only show it after a successful fetch() round-trip proves the
    service is reachable. A hardcoded green badge that ignores the actual API
    state misleads users when the backend is down.

VERIFICATION GATE: Do not call task_complete until "npx next build" exits 0.
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

UI-BASED CRUD SELF-CHECK (required whenever you wired a create/edit/delete
form to a real endpoint — this is DIFFERENT from Shubham's own API-level
CRUD check: he proves the ENDPOINT works via raw http_request; you must
prove the FORM actually calls it correctly, with the right payload shape,
and the UI actually reflects what really happened — a form that "looks
right" can still send the wrong field names or silently swallow an error):
  a) Boot the same throwaway Docker environment pattern Shubham/Riya use
     (or reuse a running one from your CLICK-THROUGH NAVIGATION
     VERIFICATION above if it's still up) with the real backend + Postgres.
     The backend service lives in Shubham's OWN docker-compose.yml at
     ../backend/docker-compose.yml relative to your project directory (his
     project is a SIBLING directory, not part of your compose file) — it is
     very likely ALREADY RUNNING, left up from his own self-check, and you
     will typically be reusing that exact container, not booting a new one.
     Before your FIRST request through the browser, read that file and
     confirm the backend service has CORS_ORIGIN=http://localhost:<the
     exact host port you mapped your OWN frontend container to> set under
     its environment: key — if it is missing or set to a different value,
     add or edit it yourself in that same file, then run docker_compose
     "down" and docker_compose "up" FROM THAT DIRECTORY to apply it.
     Shubham's static
     backend scaffold defaults CORS_ORIGIN to http://localhost:3000 when
     unset, and his own self-check never sets it (he calls the API directly
     via http_request, which never triggers browser CORS at all) — so an
     already-running backend you reuse will almost always still have the
     stale default. This is a REAL browser CORS rejection (preflight
     blocked), not a frontend bug: do NOT "fix" it by changing YOUR OWN
     frontend's port or by editing frontend code (middleware, rewrites,
     etc.) — none of that touches the actual cause, and doing it anyway
     burns your entire iteration budget on code that was never broken.
  b) For EVERY create/edit/delete form you built, actually USE it through
     the browser tools — browser_navigate to the page, browser_fill each
     real input, browser_click the real submit button. Do NOT call
     http_request directly to simulate this — that only proves the API
     works (Shubham's job), not that your form is wired to it correctly.
  c) After submit, verify BOTH sides, not just "the button click didn't
     error":
       - UI side: browser_get_text (or browser_element_exists) confirms the
         new/changed data actually appears where a user would expect to see
         it (a list, a detail view, a success toast) — not just that no
         error was thrown.
       - DATA side: db_query the real table to confirm the row genuinely
         exists with the field values you actually typed into the form —
         not just that the UI shows a success state. A form that shows
         "Saved!" while the fetch() call actually failed silently (wrong
         endpoint, wrong payload shape, an uncaught promise rejection) is a
         real, serious bug this step exists to catch.
  d) If you built an edit form: fill it with a real change, submit, then
     db_query to confirm the DATABASE ROW changed — not just that the UI
     re-rendered with the new value (a form can update its own local state
     optimistically without the API call actually succeeding).
  e) If you built a delete action AND no other resource in the api-contract
     references this resource via an "_id" field, use it, then db_query to
     confirm the row is gone. Skip the delete check for a resource other
     resources reference — deleting your own seed data would falsely break
     a LATER create step that needed to reference it (this exact mistake
     was found and fixed live in Riya's own post-deploy checker; the same
     caution applies here).
  Budget: roughly 4-5 tool calls per form (navigate, fill fields, submit,
  UI check, db_query check). This closes a real gap: Shubham proving the
  API works and you proving the UI compiles/renders are each necessary but
  NEITHER alone proves a real user can actually create/edit/delete data
  through your interface — this step is the only place that does.
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

Start with list_files to see the scaffold, then write pages and components.`;
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

export function writeStaticScaffold(plan: BuildPlan, outputDir: string): void {
  const backendPort = plan.apiContract.baseUrl?.match(/:(\d+)/)?.[1] ?? "3001";

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
          "@yugnex/core": "^0.1.0",
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
      content: `@import "./theme-overrides.css";

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
      content: `import type { ReactNode } from "react";
import { StyleRegistry, ThemeProvider } from "@yugnex/core/client";
import { createTheme, NoFoucScript } from "@yugnex/core";
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
            {children}
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
      content: `import { NextResponse } from "next/server";
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
}
