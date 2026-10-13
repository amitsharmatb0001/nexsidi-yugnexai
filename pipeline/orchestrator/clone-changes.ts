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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findDanglingAnchorsInApp, type DanglingAnchor } from "./anchor-check.ts";
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
   places never uses it.`;

export function buildCloneEditTask(changes: string, newName: string, backendContext?: string): string {
  const backendSection = backendContext
    ? `\n\nThe backend was just updated to support this request:\n${backendContext}\nWire your changes to what it now actually provides — don't guess at endpoint shapes, use exactly what's described above.\n`
    : "";
  return `App name: ${newName}

Apply exactly this change request to the existing frontend:
"${changes}"
${backendSection}
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

/** Every in-page link in the app's pages and components whose target id exists nowhere. */
export async function scanDanglingAnchors(frontendDir: string): Promise<DanglingAnchor[]> {
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
  return findDanglingAnchorsInApp(files);
}

export interface ApplyCloneChangesResult {
  applied: boolean;
  summary: string;
  filesWritten: string[];
  errors: string[];
}

export async function applyCloneChanges(
  opts: ApplyCloneChangesOptions,
  deps: { runGenerator?: GeneratorRunner; verify?: FrontendVerify; anchors?: DanglingAnchorScan } = {},
): Promise<ApplyCloneChangesResult> {
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
  const finish = async (done: ApplyCloneChangesResult): Promise<ApplyCloneChangesResult> => {
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

  const first = await runPass(buildCloneEditTask(opts.changes, opts.newName, opts.backendContext), opts.backendContext ? 40 : 25);

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
