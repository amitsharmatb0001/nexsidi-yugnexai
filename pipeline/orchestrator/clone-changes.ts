// LLM-assisted scoped edit pass for the clone flow — v2 of clone-project.ts's
// deterministic name/branding swap (2026-09-01, real user request: "give me
// a document & prompt to test... can it do the clone AND understand the
// changes of bits & pieces, or does it just clone blindly"). clone-project.ts
// itself already documents this exact gap in its own header comment ("that
// needs an LLM-assisted pass and is a natural v2, not built here") — this is
// that v2. Deliberately reuses resolveGeneratorRunner() — the SAME entry
// point Aanya's own generator (agents/generators/aanya/src/index.ts) uses —
// instead of calling runAgentEscalated directly, so this automatically
// respects whichever tier (GENERATOR_TIER=gemini vs NIM/Claude-escalation)
// is actually active in this environment rather than hardcoding an
// assumption about it.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findDanglingAnchorsInApp, reachableFiles, type DanglingAnchor } from "./anchor-check.ts";
import { accentOnDark } from "./clone-theme.ts";
import { extractNotApplied } from "./clone-report.ts";
import { verifyDir, type VerifyResult } from "./verify-commands.ts";
import { AGENT_MODELS, FALLBACK_CHAIN } from "@nexsidi/llm-client";
// Deep relative import, not the "@nexsidi/agent-runtime" package alias —
// pipeline/package.json's dependencies list does not include agent-runtime
// (only agent-bus/context-chain/db/llm-client/workspace-contract), and every
// existing pipeline/orchestrator/** call site that reaches into agent-runtime
// (stage5-adversarial-qa.ts, stage6-deployment.ts, spec-compliance.ts) does
// it the same way, confirmed via a repo-wide grep before choosing this.
import { resolveGeneratorRunner, type GeneratorRunner } from "../../packages/agent-runtime/src/generator-tier.ts";

export const CLONE_EDIT_SYSTEM_PROMPT = `You are editing an ALREADY WORKING, ALREADY DELIVERED Next.js frontend.
This is NOT a fresh build — the app already compiles, already renders every
page, and has already been through full generation and QA. Your ONLY job is
to apply the SPECIFIC changes requested below, and nothing else.

RULES:
1. This directory has no node_modules yet — dependencies were intentionally
   not copied from the source project. Run "npm install" FIRST, before
   anything else.
2. Apply ONLY what is explicitly requested. Use read_file to see the current
   content, then edit_file for targeted changes. Only use write_file if a
   change genuinely requires touching most of a file.
3. Do not change layout, visual design, colors, copy, or structure that
   wasn't asked for. This app already passed design review — leave
   everything else exactly as it is.
4. The app's current name is given below — never reintroduce an old name you
   might see referenced anywhere you touch.
5. Before editing, use list_files and read_file to find every place the
   requested content actually lives (a services list, a hero section, a
   color token) — do not guess a location and edit the wrong file.
6. If the request below names a specific existing file as a pattern to
   model new work after, read_file that EXACT file FIRST, before writing
   anything new — and copy its real conventions (styling approach,
   data-fetching pattern, prop shapes, error handling) instead of
   inventing your own. That file was named because it already solves the
   same kind of problem — searching for a different one wastes turns you
   don't have.
7. If you add a new top-level PAGE that's meant to be publicly visible (a
   marketing/informational page, not an account-only screen), check
   middleware.ts (or an equivalent auth-gating file) for a hardcoded list of
   public paths. If one exists, add your new route to it — otherwise the
   page silently redirects visitors to sign-in, which is wrong for content
   that should be public. Leave it untouched if the new page is genuinely
   meant to require login.
8. After editing, run "npx tsc --noEmit" then "npx next build" to verify
   nothing broke. Do not call task_complete until both pass.
9. Call task_complete with a summary that states, for EACH requested change,
   which file(s) you edited to make it — not just "done".
10. Read a file once, whole. read_file already returns up to 8000 characters;
   do not pass a smaller limit or an offset unless the file is longer than
   that. Re-reading one file in small slices spends iterations you do not
   have.
11. When a change adds a field to data that is passed around (a type or
   interface in lib/api.ts, a props type), declare the new field as
   REQUIRED, not optional, so the compiler points at every place that builds
   or renders that data. Fix each one: the form that sends it, the screen
   that shows it. An optional field compiles cleanly while one of those
   places never uses it.
12. If part of the request refers to something that does not exist in this
   app (for example "when editing an invoice" in an app with no edit
   screen), do NOT build a new feature to match it and do NOT skip it
   quietly. Apply every part that can be applied, then end the task_complete
   summary with one line per part you could not apply, in exactly this form:
   "Not applied: <the part> — <why it cannot be applied here>".
13. Before a form sends a field to the backend, read the backend's validator
   for that route (the schema in its controller) and send exactly the format
   it accepts. An <input type="date"> gives "YYYY-MM-DD"; if the validator
   wants something else, convert it in the form's submit code or, if the
   validator is plainly too strict for a date picker, say so in the summary.
   A form that the validator rejects looks finished and fails the first time
   anyone uses it.
14. Use a new endpoint's response shape exactly as the backend summary states
   it. If the summary does not state it, open the endpoint's controller and
   read its res.json call before writing code that uses the data. A screen
   that treats an object as a list crashes the first time the page opens.`;

export function buildCloneEditTask(changes: string, newName: string, backendContext?: string, accentColor?: string | null): string {
  const backendSection = backendContext
    ? `\n\nThe backend was just updated to support this request:\n${backendContext}\nWire your changes to what it now actually provides — don't guess at endpoint shapes, use exactly what's described above.\n`
    : "";
  const accentSection = accentColor
    ? `\n\nAccent colour: the main accent is ${accentColor}; the app's theme token already carries it. Where you recolour literal hex values elsewhere, use ${accentColor} for fills and buttons, and ${accentOnDark(accentColor)} for text and icons on dark panels (it is lightened so it reads at 4.5:1 there).\n`
    : "";
  return `App name: ${newName}

Apply exactly this change request to the existing frontend:
"${changes}"
${backendSection}${accentSection}
Start with list_files to see the current project structure, then read_file
on whichever files are relevant to the request before editing anything.`;
}

export interface ApplyCloneChangesOptions {
  buildDir: string; // the clone's root dir — cloneProject()'s returned buildDir
  changes: string; // plain-English change request
  newName: string; // the clone's already-renamed display name, for context
  apiKey: string;
  // Set when clone-plan.ts decided this request also needed backend work —
  // the backend pass's own summary of what it actually built, so this pass
  // wires to real endpoints instead of guessing at shapes that were never
  // confirmed to exist.
  backendContext?: string;
  // The project the spend of every pass is added to (the same per-project total full builds use).
  projectId?: string;
  // The accent colour the request names, as a hex (see clone-plan.ts).
  accentColor?: string | null;
}

export type FrontendVerifyResult = VerifyResult;
export type FrontendVerify = (frontendDir: string) => Promise<FrontendVerifyResult>;

/** The same two checks the Docker build runs, run here so a failure is found now and not minutes later. */
export const verifyFrontend: FrontendVerify = (frontendDir) =>
  verifyDir(frontendDir, [
    { command: "npx tsc --noEmit", timeoutMs: 240_000 },
    { command: "npx next build", timeoutMs: 420_000 },
  ]);

export type DanglingAnchorScan = (frontendDir: string) => Promise<DanglingAnchor[]>;

/** The source files under app/ and components/, paths relative to the frontend folder. */
export async function readFrontendSources(frontendDir: string): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry)) files.push({ path: relative(frontendDir, full).split(sep).join("/"), content: readFileSync(full, "utf-8") });
    }
  };
  for (const d of ["app", "components"]) walk(join(frontendDir, d));
  return files;
}

/** Every in-page link in the app's pages and components whose target id exists nowhere. */
export async function scanDanglingAnchors(frontendDir: string): Promise<DanglingAnchor[]> {
  return findDanglingAnchorsInApp(await readFrontendSources(frontendDir));
}

export interface ApplyCloneChangesResult {
  applied: boolean;
  summary: string;
  filesWritten: string[];
  errors: string[];
  // Parts of the request the pass reported it could not apply (see clone-report.ts).
  notApplied: string[];
}

type ApplyCloneChangesCore = Omit<ApplyCloneChangesResult, "notApplied">;

export async function applyCloneChanges(
  opts: ApplyCloneChangesOptions,
  deps: { runGenerator?: GeneratorRunner; verify?: FrontendVerify; anchors?: DanglingAnchorScan } = {},
): Promise<ApplyCloneChangesResult> {
  const core = await applyCloneChangesCore(opts, deps);
  return { ...core, notApplied: extractNotApplied(core.summary) };
}

async function applyCloneChangesCore(
  opts: ApplyCloneChangesOptions,
  deps: { runGenerator?: GeneratorRunner; verify?: FrontendVerify; anchors?: DanglingAnchorScan } = {},
): Promise<ApplyCloneChangesCore> {
  const runGenerator = deps.runGenerator ?? resolveGeneratorRunner();
  const verify = deps.verify ?? verifyFrontend;
  const anchors = deps.anchors ?? scanDanglingAnchors;
  const frontendDir = join(opts.buildDir, "frontend");

  const runPass = (initialMessage: string, maxIterations: number) =>
    runGenerator({
      agentName: "aanya-clone-edit",
      // Same primary + fallback Aanya's own generator uses (packages/llm-client/
      // src/types.ts's AGENT_MODELS.aanya) — this literally IS Aanya's job
      // (frontend content edits), just scoped to an existing app instead of a
      // fresh one, so it gets her same model routing.
      model: AGENT_MODELS.aanya, // 2026-09-28: from llm-client's model registry (types.ts)
      fallbackModels: FALLBACK_CHAIN.aanya,
      apiKey: opts.apiKey,
      systemPrompt: CLONE_EDIT_SYSTEM_PROMPT,
      initialMessage,
      sandboxDir: frontendDir,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      geminiTier: "design",
      enableHttpTools: true,
      maxIterations,
      requiredVerificationCommands: ["npx tsc --noEmit", "npx next build"],
    });

  // A scoped edit against an already-complete app needs far fewer turns than a full build (Aanya's own
  // maxIterations is 90) — bounded low so a run that can't converge fails fast. 25 for a content edit; 40 when it
  // also wires to a backend that just changed (measured live 2026-09-02: 25 was one component short).
  // A section the pass removed can leave links pointing at it (Shopbill run 5: a "Compare vs Spreadsheets" button).
  // Types and the build cannot see that. Ask the agent once to take them out; whatever is left is reported, and the
  // delivered change is kept.
  const finish = async (applied: ApplyCloneChangesCore): Promise<ApplyCloneChangesCore> => {
    let done = applied;
    // Files the pass itself orphaned (a removed section's component) are taken out, so they do not ship unused —
    // and cannot make a dead link look valid. Only files the app used before and no longer uses; never anything else.
    const sourcesAfter = await readFrontendSources(frontendDir);
    const reachableAfter = reachableFiles(sourcesAfter);
    const removed: string[] = [];
    for (const path of reachableBefore) {
      if (reachableAfter.has(path) || !sourcesAfter.some((f) => f.path === path)) continue;
      try {
        unlinkSync(join(frontendDir, path));
        removed.push(path);
      } catch {
        /* leave it: an unused file is harmless */
      }
    }
    if (removed.length > 0) {
      done = { ...done, summary: `${done.summary}\nRemoved files the change left unused: ${removed.join(", ")}.`.trim() };
    }
    const dead = await anchors(frontendDir);
    if (dead.length === 0) return done;
    const list = dead.map((d) => `"#${d.anchor}" in ${d.file}`).join(", ");
    const fix = await runPass(
      `Some links on the page point at sections that no longer exist: ${list}. ` +
        `Remove each such link or button (or point it at something that exists). Change nothing else, ` +
        `then run "npx tsc --noEmit" and "npx next build" until both pass.`,
      8,
    );
    const left = await anchors(frontendDir);
    const filesWritten = [...new Set([...done.filesWritten, ...fix.filesWritten])];
    const errors = left.length > 0
      ? [...done.errors, `Links to sections that no longer exist remain: ${left.map((d) => `"#${d.anchor}" in ${d.file}`).join(", ")}`]
      : done.errors;
    return { ...done, filesWritten, errors };
  };

  const sourcesBefore = await readFrontendSources(frontendDir);
  const reachableBefore = reachableFiles(sourcesBefore);
  const first = await runPass(buildCloneEditTask(opts.changes, opts.newName, opts.backendContext, opts.accentColor), opts.backendContext ? 40 : 25);

  if (first.success) {
    return finish({ applied: true, summary: first.summary, filesWritten: first.filesWritten, errors: first.errors });
  }

  // The pass ended without its checks green (typically out of iterations, one error short — Shopbill run 3).
  // Run the real checks here; if they fail, send the agent back ONCE with exactly those errors, then fail honestly.
  const found = await verify(frontendDir);
  // Green checks mean the app builds, not that the requested change was made (an agent that gave up having written
  // nothing leaves an untouched app that passes). Only a pass that reported success counts as applied, so with no
  // failing checks to hand back there is nothing to fix up: the pass failed, and says so.
  if (!found.ran) {
    return { applied: false, summary: first.summary, filesWritten: first.filesWritten, errors: first.errors };
  }
  if (found.ok) {
    // The app builds, but the pass did not finish (out of iterations, or the model went quiet). Continue it once
    // from the state it left, with the original request — instead of throwing away what it did.
    const more = await runPass(
      `You did not finish this task. Compare what is already done in the app with the request below, finish whatever ` +
        `is still missing, run "npx tsc --noEmit" and "npx next build" until both pass, then call task_complete.\n\n` +
        buildCloneEditTask(opts.changes, opts.newName, opts.backendContext),
      12,
    );
    const filesWrittenMore = [...new Set([...first.filesWritten, ...more.filesWritten])];
    if (more.success) {
      return finish({ applied: true, summary: more.summary || first.summary, filesWritten: filesWrittenMore, errors: [] });
    }
    return { applied: false, summary: more.summary || first.summary, filesWritten: filesWrittenMore, errors: [...first.errors, ...more.errors] };
  }

  const second = await runPass(
    `The change was applied, but the frontend does not pass its checks. Fix exactly these errors and nothing else, ` +
      `then run "npx tsc --noEmit" and "npx next build" until both pass:

${found.output}`,
    12,
  );
  const again = await verify(frontendDir);
  const filesWritten = [...new Set([...first.filesWritten, ...second.filesWritten])];
  if (again.ran && again.ok) {
    return finish({ applied: true, summary: second.summary || first.summary, filesWritten, errors: [] });
  }
  return {
    applied: false,
    summary: second.summary || first.summary,
    filesWritten,
    errors: [...first.errors, ...second.errors, `The frontend still does not build:
${again.output || found.output}`],
  };
}
