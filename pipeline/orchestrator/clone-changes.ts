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
import { join } from "node:path";
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
   which file(s) you edited to make it — not just "done".`;

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
}

export interface ApplyCloneChangesResult {
  applied: boolean;
  summary: string;
  filesWritten: string[];
  errors: string[];
}

export async function applyCloneChanges(
  opts: ApplyCloneChangesOptions,
  deps: { runGenerator?: GeneratorRunner } = {},
): Promise<ApplyCloneChangesResult> {
  const runGenerator = deps.runGenerator ?? resolveGeneratorRunner();
  const frontendDir = join(opts.buildDir, "frontend");

  const result = await runGenerator({
    agentName: "aanya-clone-edit",
    // Same primary + fallback Aanya's own generator uses (packages/llm-client/
    // src/types.ts's AGENT_MODELS.aanya) — this literally IS Aanya's job
    // (frontend content edits), just scoped to an existing app instead of a
    // fresh one, so it gets her same model routing.
    model: "mistralai/mistral-medium-3.5-128b",
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey: opts.apiKey,
    systemPrompt: CLONE_EDIT_SYSTEM_PROMPT,
    initialMessage: buildCloneEditTask(opts.changes, opts.newName, opts.backendContext),
    sandboxDir: frontendDir,
    geminiTier: "design",
    enableHttpTools: true,
    // A scoped edit against an already-complete app needs far fewer turns
    // than a full build (Aanya's own maxIterations is 90) — bounded low so a
    // run that can't converge fails fast instead of burning a full budget.
    // 2026-09-02: real live test found 25 wasn't enough specifically when
    // backendContext is set — wiring a genuinely new feature into an
    // existing component (find the right integration point among several
    // candidates, add a new store, a new interactive control, verify) is a
    // bigger task than a content/copy edit. Measured live: it was mid-edit
    // on the right file, one component away from done, when it hit 25.
    // Mirrors Aanya's own real precedent for raising this number (60->90)
    // only when evidence showed the existing budget was genuinely tight —
    // not a blanket increase for the common, cheaper, backend-free case.
    maxIterations: opts.backendContext ? 40 : 25,
    requiredVerificationCommands: ["npx tsc --noEmit", "npx next build"],
  });

  return {
    applied: result.success,
    summary: result.summary,
    filesWritten: result.filesWritten,
    errors: result.errors,
  };
}
