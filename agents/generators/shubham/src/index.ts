// Shubham — Express backend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run tsc → fix → repeat.
// No longer does one-shot LLM generation. Agent ACTS on real tool feedback.

import { resolveGeneratorRunner, type Escalation } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import type { BuildPlan, GeneratorTask } from "../../../arjun/src/index.ts";
import { buildSystemContext } from "../../../arjun/src/index.ts";

export interface GeneratorResult {
  success: boolean;
  projectId: string;
  outputDir: string;
  filesWritten: string[];
  errors: string[];
  // P3 (agent-autonomy-assessment F3): findings this fix run handed off to
  // another agent's domain instead of forcing a workaround — see
  // tools/escalate.ts and stage5-qa-fix-loop.ts's routing of these.
  escalations?: Escalation[];
}

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId, "backend");
}

// 2026-08-10: real gap found live (user request) — Shubham's self-check
// mechanical gate ("requiredEvidenceKinds: ['http_check']") is satisfied by
// testing ONE endpoint, leaving every other resource's CRUD chain
// unverified at generation time. Counts distinct resources (grouped by
// first path segment after /api/v1/, excluding auth) that have a real POST
// create endpoint — same grouping convention agents/riya/src/index.ts's
// verifyAllResourceCrud uses, kept as a separate local function rather than
// importing from riya (Shubham generates the code Riya later deploys/
// verifies — importing from riya into shubham would be a backwards
// dependency direction). Used to size requiredEvidenceCounts so the
// mechanical gate scales with how many resources actually need testing.
export function countTestableResources(plan: BuildPlan): number {
  const endpoints = plan.apiContract?.endpoints ?? [];
  const resources = new Map<string, typeof endpoints>();
  for (const ep of endpoints) {
    const seg = ep.path.replace(/^\/api\/v1\//, "").split("/")[0];
    if (!seg || seg === "auth") continue;
    resources.set(seg, [...(resources.get(seg) ?? []), ep]);
  }
  let count = 0;
  for (const eps of resources.values()) {
    if (eps.some((e) => e.method === "POST" && !/:[a-zA-Z_]/.test(e.path))) count++;
  }
  return count;
}

// Scan src/routes/ for *.routes.ts files and make sure each one is imported
// and mounted in src/routes/index.ts. A never-wired route file (the original
// bug this function fixes: "every generated API was dead") is mounted at
// "/<resource>" (e.g. tasks.routes.ts mounts at "/tasks"). A route file that
// is ALREADY imported in index.ts is left completely alone, including its
// mount path — this runs after every fix-loop pass too (runFix, below), and
// the fix loop hand-tunes mount paths in this exact file (e.g. singular
// "/appointment" -> plural "/appointments" to match the API contract).
// Mechanically re-deriving every path from the filename on every call
// silently reverted those fixes every time (found live, project
// meridianbk4: the same route-mismatch QA finding recurred 3 times because
// of this). Deterministic and fail-safe. Exported for unit testing.
//
// Returns the routes/index.ts path (relative to backendDir, matching the
// same format as the agentic loop's own filesWritten entries) when it
// actually wrote something, or null on a genuine no-op (no route files, or
// everything already wired). 2026-08-16 (token-waste-reduction plan, Task
// 1): this write previously happened OUTSIDE the agentic write_file tool
// loop that run()/runFix()'s own `result.filesWritten` tracks — confirmed by
// reading run()/runFix() below, neither fed this function's writes back into
// filesWritten at all. That's a real gap for round-scoped QA re-scan (this
// plan's whole "what changed since last round" mechanism): a fix round that
// only changed routes/index.ts via auto-wiring would have been invisible to
// the next round's "focus your reads here" signal, and a route-mounting
// regression in that exact file could go silently unread. run()/runFix()
// below fold this return value into their own filesWritten so it isn't lost.
export function autoWireRoutes(backendDir: string): string | null {
  const routesDir = join(backendDir, "src", "routes");
  try {
    if (!existsSync(routesDir)) return null;
    const routeFiles = readdirSync(routesDir)
      .filter((f) => f.endsWith(".routes.ts"))
      .sort();
    if (routeFiles.length === 0) return null;

    const indexPath = join(routesDir, "index.ts");
    const indexRelPath = "src/routes/index.ts";
    const existing = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "";
    const isWired = (file: string) => existing.includes(`./${file.replace(/\.routes\.ts$/, "")}.routes"`);
    const missing = routeFiles.filter((f) => !isWired(f));

    if (existing && missing.length === 0) return null; // everything already wired — don't touch hand-tuned mounts

    const importLine = (file: string) => {
      const resource = file.replace(/\.routes\.ts$/, "");
      const ident = resource.replace(/[^a-zA-Z0-9]/g, "_") + "Router";
      return { resource, ident, importLine: `import ${ident} from "./${resource}.routes";`, mountLine: (r: string, i: string) => `router.use("/${r}", ${i});` };
    };

    if (!existing || missing.length === routeFiles.length) {
      // Nothing wired yet (fresh generation or empty placeholder) — build from scratch.
      const importLines: string[] = ['import { Router } from "express";'];
      const mountLines: string[] = ["", "const router = Router();", ""];
      for (const file of routeFiles) {
        const { resource, ident, importLine: imp, mountLine } = importLine(file);
        importLines.push(imp);
        mountLines.push(mountLine(resource, ident));
      }
      mountLines.push("", "export default router;", "");
      writeFileSync(indexPath, importLines.join("\n") + "\n" + mountLines.join("\n"), "utf-8");
      console.log(`[shubham] auto-wired ${routeFiles.length} route file(s) into routes/index.ts: ${routeFiles.join(", ")}`);
      return indexRelPath;
    }

    // Mixed state: some route files already wired (possibly hand-tuned),
    // some genuinely new — append only the new ones, touch nothing else.
    let content = existing;
    const newImports: string[] = [];
    const newMounts: string[] = [];
    for (const file of missing) {
      const { resource, ident, importLine: imp, mountLine } = importLine(file);
      newImports.push(imp);
      newMounts.push(mountLine(resource, ident));
    }
    const routerImportMatch = content.match(/import \{ Router \} from "express";\n/);
    if (routerImportMatch?.index !== undefined) {
      const insertAt = routerImportMatch.index + routerImportMatch[0].length;
      content = content.slice(0, insertAt) + newImports.join("\n") + "\n" + content.slice(insertAt);
    } else {
      content = newImports.join("\n") + "\n" + content;
    }
    const exportMatch = content.match(/export default router;/);
    if (exportMatch?.index !== undefined) {
      content = content.slice(0, exportMatch.index) + newMounts.join("\n") + "\n" + content.slice(exportMatch.index);
    } else {
      content += "\n" + newMounts.join("\n") + "\n";
    }
    writeFileSync(indexPath, content, "utf-8");
    console.log(`[shubham] auto-wired ${missing.length} new route file(s) into routes/index.ts (preserved existing mounts): ${missing.join(", ")}`);
    return indexRelPath;
  } catch (err) {
    console.warn(`[shubham] autoWireRoutes skipped: ${String(err)}`);
    return null;
  }
}

// 2026-07-08: Patent Claim 2's instinct memory had a real DB table but
// nothing ever wrote to OR read from it — every run started with total
// amnesia, so the same bug classes (e.g. the SQL injection this session
// found in a dynamic UPDATE query) could resurface run after run. This is
// the read side (packages/db/src/instincts.ts is the write side, wired
// into stage5-qa-fix-loop.ts). Fails safe: memory is an enrichment, not a
// hard dependency — if Postgres isn't reachable, generation proceeds
// exactly as before this feature existed rather than blocking on it.
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

// ── Main entry ────────────────────────────────────────────────────────────────
export async function run(plan: BuildPlan): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId);
  mkdirSync(outputDir, { recursive: true });

  // Write static scaffold first — agent focuses only on business logic
  writeStaticScaffold(plan, outputDir);

  // Primary history: kimi-k2.6 (failed, F7) -> z-ai/glm-5.2 (2026-07-03) ->
  // mistral-medium-3.5-128b (2026-07-04). glm-5.2 demoted after
  // scripts/ping-glm.ts proved its endpoint hangs past the 120s timeout on
  // every request shape — and stress-3's log shows this agent succeeded in 21
  // iterations entirely on mistral-medium (the then-fallback) after glm's
  // iteration-1 hang. Dropped from the chain entirely: a hanging endpoint
  // costs a full 120s timeout per attempt before failing over.
  // runAgentEscalated (Task 15): open-source chain first; Sonnet 5 single
  // retry only when the whole chain genuinely can't finish. See
  // packages/agent-runtime/src/claude-loop.ts.
  const knownMistakesPrefix = await loadKnownMistakesPrefix();

  const result = await resolveGeneratorRunner()({
    agentName: "shubham",
    model: "mistralai/mistral-medium-3.5-128b",
    // 2026-07-24: qwen3.5-122b-a10b (chosen for being a genuinely different
    // architecture from the primary) returns HTTP 410 Gone as of 2026-07-20
    // — the NIM endpoint was permanently removed (see types.ts's ModelId
    // comment). Using it as a fallback meant a real failure of the primary
    // model fell through to a fallback that would ALWAYS also fail. Swapped
    // for qwen3-next-80b, the documented working replacement.
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey,
    systemPrompt: knownMistakesPrefix,
    initialMessage: buildAgentTask(plan),
    sandboxDir: outputDir,
    projectId: plan.projectId,
    // 2026-07-12: pro (thinking) model for code quality; http + docker tools so
    // Shubham self-verifies its own work like a real backend dev (boot a
    // throwaway Postgres, apply migrations, start the server, curl health +
    // auth-enforcement) before handing off.
    // 2026-07-25 (Phase 1, full MVP upgrade): was `geminiModel:
    // process.env.GEMINI_GENERATION_MODEL`. Verified live (audit-2026-07-25.md,
    // A.3): `.env` set GEMINI_GENERATION_MODEL=gemini-3.5-flash, and
    // poolForTier(tier, explicitModel) collapses the WHOLE pool to that one
    // model with no fallback whenever explicitModel is set — Shubham never
    // reached gemini-3.6-flash regardless of what TIER_POOLS.generation
    // said, silently pinned to the old model by an env var nobody was
    // meant to be relying on as a permanent override. geminiModel now
    // unset (still overridable per-run if a future caller has a real
    // reason to pin one) — geminiTier: "generation" selects the pool.
    geminiTier: "generation",
    enableHttpTools: true,
    enableDockerTools: true,
    enableWebSearch: true,
    enableScreenshot: true,
    enableBrowser: true,
    enableDbQuery: true,
    requiredVerificationCommands: ["npx tsc --noEmit", "npm run build"],
    // 2026-08-06: real bug found live (project bae438767bed) — the LIVE
    // AUTH-BOUNDARY VERIFICATION section above is prompt text only, and the
    // model simply skipped it entirely (task_complete's own summary listed
    // only tsc + build as evidence, with no acknowledgment it had skipped a
    // required section, despite the prompt explicitly requiring that
    // acknowledgment). A prompt instruction is followed probabilistically,
    // same lesson as D28 (hooks vs. skills) applied to generation prompts —
    // this makes it mechanical instead: task_complete is REJECTED unless at
    // least one http_request actually happened this run, mirroring the
    // identical, already-proven gate on Riya's deploy activity
    // (agents/riya/src/index.ts). Does not guarantee the http_request
    // specifically tested the auth boundary (any successful call satisfies
    // it), but closes the observed failure mode of zero live verification
    // happening at all.
    requiredEvidenceKinds: ["http_check"],
    // 2026-08-10: real gap found live (user request) — "≥1 http_request
    // total" is satisfied by testing ONE endpoint, leaving every other
    // resource's CRUD chain unverified at generation time (the exact
    // "self-check the obvious stuff at the source, don't leave it for QA
    // or a later round-trip" gap the user asked to close). Requires at
    // least one real http_request PER TESTABLE RESOURCE — a conservative
    // floor (not "4 calls per resource" for full CRUD) chosen the same way
    // as Aanya's visual_check gate: meaningfully raises the bar without
    // demanding an exact call-count pattern that could be wrong for an
    // app with unusual endpoint shapes. See FULL CRUD SELF-CHECK below for
    // what this is meant to enforce in practice.
    requiredEvidenceCounts: countTestableResources(plan) > 0 ? { http_check: countTestableResources(plan) } : {},
    // 2026-07-25: raised from 40 (default) to 60 after two consecutive
    // live P4 runs (nextech5, nextech6) both failed at exactly iteration 40
    // while Shubham was still in the live-verification phase. Measured
    // breakdown in both runs: ~33 code-write iterations + 7 verification
    // iterations = 40 (cap). 60 gives a safe 20-iteration margin above
    // measured usage. The non-retryable fix in generatorFailure() (same
    // session) means a hit on this cap costs ONE attempt, not 5x retries.
    // Also updated SELF-VERIFICATION PROTOCOL to remove the server-start
    // + HTTP endpoint check (that was causing 7+ iterations of server-start
    // failures on Windows); DB schema verification is now ≤4 calls.
    // 2026-08-10: raised 60 -> 90. FULL CRUD SELF-CHECK above adds ~3-4 tool
    // calls per testable resource on top of the existing ~40-call budget —
    // a starting estimate (no live measurement yet for this specific
    // addition, unlike the 40->60 change above which was tuned from two
    // real overruns); revisit if a live run hits this cap mid-CRUD-check.
    maxIterations: 90,
  });

  // Deterministically mount the *.routes.ts files into routes/index.ts (see
  // autoWireRoutes) — a placeholder was left there and the never-implemented
  // auto-wiring meant every generated API was dead. Runs after the agent has
  // written its route files.
  const autoWiredFile = autoWireRoutes(outputDir);
  // Token-waste-reduction plan Task 1: fold autoWireRoutes' own write into
  // filesWritten — it happens outside the agentic loop above, so
  // result.filesWritten alone would never mention it (see autoWireRoutes'
  // own comment for the live gap this closes).
  const filesWritten = autoWiredFile && !result.filesWritten.includes(autoWiredFile)
    ? [...result.filesWritten, autoWiredFile]
    : result.filesWritten;

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten,
    errors: result.errors,
  };
}

// A6 (full-system audit, Phase C): Stage 5 QA findings previously went
// nowhere — run.ts's own comment documented the gap: "a fault-isolated
// re-fix-and-retest loop ... is NOT implemented here." runFix() targets the
// SAME outputDir run() already wrote to (files already exist there) with a
// fix-focused task instead of a from-scratch build task — the agent reads
// the affected files and edits them, it doesn't regenerate the project.
// 2026-07-26 (agent-autonomy-assessment F1/F2): the old prompt said "Fix
// ONLY these specific issues — do not refactor working code that wasn't
// flagged" and gave no spec/contract/schema. Live proof this was the actual
// cause of a stuck-state, not a model limit: across 6 real rounds on a
// booking system, this exact instruction forced 3 separate point-fixes to
// the SAME race condition (missing check -> added it; race on approve ->
// added FOR UPDATE; duplicate insert -> added a per-user advisory lock)
// instead of one correct locking design, and the agent could never see the
// missing DB unique constraint that was the real root cause because the
// schema was never shown to it. Root-cause reasoning is now instructed
// explicitly and the full system context is included.
export function buildFixTask(findings: string[], plan: BuildPlan): string {
  return `An adversarial QA review found the following issues in the backend code you already wrote.

${buildSystemContext(plan)}

ISSUES TO FIX:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Each finding is a SYMPTOM, not necessarily the whole problem. Before editing:
1. Diagnose the root cause — read the full function/file the finding points
   at, not just the cited line. Check the DB schema above: a "race condition"
   or "invalid state" finding is very often really a missing UNIQUE/CHECK
   constraint or FOREIGN KEY, not something application code alone can fully
   close. If the correct fix belongs in the database schema (which you
   cannot edit), call escalate_finding(target_agent: "pranav", ...) instead
   of writing an application-layer workaround that can't actually close the
   gap — a workaround here is not a fix, it's a finding QA will just report
   again next round.
2. Check whether the same class of issue elsewhere in your own files has the
   same root cause (e.g. the same missing-lock pattern in a sibling
   controller) — fix all real instances of it, not just the one cited.
3. Stay within your own domain (backend) and don't rewrite files unrelated to
   the root cause you diagnosed.

Workflow:
1. Use read_file to see the exact current content of each affected file
2. Use edit_file for targeted fixes (cheaper than rewriting the whole file) — use write_file only if the fix genuinely requires touching most of the file
3. Run "npx tsc --noEmit" (or the project's build command) to verify nothing broke
4. Call task_complete with verification_passed: true only after verifying the fix actually addresses the root cause, not just silences the symptom`;
}

export async function runFix(plan: BuildPlan, findings: string[]): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId); // SAME dir run() wrote to — not regenerated
  // F7 (agent-autonomy-assessment): instincts were written by the fix loop
  // (recordInstincts, stage5-qa-fix-loop.ts) but never read by it — the one
  // call site that most needs "you already made this mistake" had it
  // missing. Mirrors run()'s identical prefix above.
  const knownMistakesPrefix = await loadKnownMistakesPrefix();

  const result = await resolveGeneratorRunner()({
    agentName: "shubham",
    model: "mistralai/mistral-medium-3.5-128b",
    // 2026-07-24: see run()'s identical fix above — qwen3.5-122b-a10b 410s
    // (endpoint permanently removed 2026-07-20); swapped for the documented
    // working replacement, qwen3-next-80b.
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey,
    systemPrompt: knownMistakesPrefix,
    initialMessage: buildFixTask(findings, plan),
    sandboxDir: outputDir,
    projectId: plan.projectId,
    // 2026-07-25 (Phase 1, full MVP upgrade): was `geminiModel:
    // process.env.GEMINI_GENERATION_MODEL`. Verified live (audit-2026-07-25.md,
    // A.3): `.env` set GEMINI_GENERATION_MODEL=gemini-3.5-flash, and
    // poolForTier(tier, explicitModel) collapses the WHOLE pool to that one
    // model with no fallback whenever explicitModel is set — Shubham never
    // reached gemini-3.6-flash regardless of what TIER_POOLS.generation
    // said, silently pinned to the old model by an env var nobody was
    // meant to be relying on as a permanent override. geminiModel now
    // unset (still overridable per-run if a future caller has a real
    // reason to pin one) — geminiTier: "generation" selects the pool.
    geminiTier: "generation",
    enableHttpTools: true,
    enableDockerTools: true,
    enableWebSearch: true,
    enableScreenshot: true,
    enableBrowser: true,
    enableDbQuery: true,
    // P3 (agent-autonomy-assessment F3): only enabled on the fix path, not
    // generation — escalation is a "this finding's real fix isn't mine"
    // signal, which only makes sense once there's a specific finding to
    // diagnose.
    enableEscalation: true,
    requiredVerificationCommands: ["npx tsc --noEmit", "npm run build"],
    // 2026-08-06: real bug found live (project bae438767bed) — the LIVE
    // AUTH-BOUNDARY VERIFICATION section above is prompt text only, and the
    // model simply skipped it entirely (task_complete's own summary listed
    // only tsc + build as evidence, with no acknowledgment it had skipped a
    // required section, despite the prompt explicitly requiring that
    // acknowledgment). A prompt instruction is followed probabilistically,
    // same lesson as D28 (hooks vs. skills) applied to generation prompts —
    // this makes it mechanical instead: task_complete is REJECTED unless at
    // least one http_request actually happened this run, mirroring the
    // identical, already-proven gate on Riya's deploy activity
    // (agents/riya/src/index.ts). Does not guarantee the http_request
    // specifically tested the auth boundary (any successful call satisfies
    // it), but closes the observed failure mode of zero live verification
    // happening at all.
    requiredEvidenceKinds: ["http_check"],
    // 2026-07-25: reverted the maxIterations override for the same reason
    // as run() above — see that comment. A fix task's live-verification
    // phase can be just as tool-call-heavy as a full generation's.
  });

  // Deterministically mount the *.routes.ts files into routes/index.ts (see
  // autoWireRoutes) — a placeholder was left there and the never-implemented
  // auto-wiring meant every generated API was dead. Runs after the agent has
  // written its route files.
  const autoWiredFile = autoWireRoutes(outputDir);
  // Token-waste-reduction plan Task 1: see run()'s identical fold above —
  // this write happens outside the agentic loop, so result.filesWritten
  // alone would never mention it, and the NEXT QA round's round-scoped
  // re-review (stage5-qa-fix-loop.ts) relies on filesWritten being complete.
  const filesWritten = autoWiredFile && !result.filesWritten.includes(autoWiredFile)
    ? [...result.filesWritten, autoWiredFile]
    : result.filesWritten;

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten,
    errors: result.errors,
    escalations: result.escalations,
  };
}

// 2026-08-23: SHUBHAM_AGENT_SYSTEM_PROMPT moved to
// packages/agent-runtime/skills/shubham/ (00-identity-and-doctrine.md,
// 10-workflow-and-scaffold.md, 20-critical-rules-and-verification.md) —
// loaded by assembleSystemPrompt ahead of the dynamic knownMistakesPrefix
// (see gemini-loop.ts's call site and prompt-assembly.ts's own header
// comment). No interpolation was used anywhere in the old constant, so
// nothing needed to stay inline — systemPrompt is now knownMistakesPrefix
// alone; the doctrine directory supplies everything else.

// Renames each endpoint's `path` field to `route` for the PROMPT TEXT ONLY —
// same fix applied to Aanya's generator after stress-test 1 (F7) found a
// mid-tier model conflating a backend route (e.g. "/api/v1/notes",
// RestEndpoint.path) with write_file's own "path" parameter (a source file
// path, e.g. "src/routes/notes.ts") because both share the literal key name
// "path" in the same prompt context. Applied proactively here — same
// mechanism, not yet independently reproduced for Shubham, but the identical
// collision exists in this prompt too. Does not touch RestEndpoint/BuildPlan
// itself, only how the contract is rendered into the prompt.
function renderApiContractForPrompt(apiContract: BuildPlan["apiContract"]): string {
  const renamed = {
    baseUrl: apiContract.baseUrl,
    endpoints: apiContract.endpoints.map(({ path, ...rest }) => ({ route: path, ...rest })),
  };
  return JSON.stringify(renamed, null, 2);
}

// P5.W5.1 (full agentic upgrade plan — plan-then-execute): Arjun's BuildPlan
// already decomposes an exhaustive per-task file manifest ("outputFiles must
// list every file the agent must produce. Be exhaustive.") but it was never
// rendered into Shubham's prompt — the agent had zero visibility into the
// exact file list Arjun already planned, unlike Aanya (whose buildAgentTask
// already renders aanyaTasks as "PLANNED FRONTEND FILES AND PAGES"). Without
// it, the only way the agent could tell whether it was "done" was to feel
// around with tsc after every file — the measured cause of the 30-60x
// per-session tsc/build re-verification tax. Mirrors Aanya's inline
// taskDetails map; pure and exported for direct unit testing.
export function renderTaskManifest(tasks: GeneratorTask[]): string {
  if (tasks.length === 0) return "";
  return tasks
    .map((t, idx) => `Task ${idx + 1}: ${t.description}\nFiles to write:\n${t.outputFiles.map((f) => `- ${f}`).join("\n")}`)
    .join("\n\n");
}

function buildAgentTask(plan: BuildPlan): string {
  const taskDetails = renderTaskManifest(plan.shubhamTasks ?? []);

  return `Build a complete Express + TypeScript backend for this project.

PROJECT: ${plan.appName ?? "web app"}
DESCRIPTION: ${plan.appDescription ?? ""}

IMPORTANT — do not confuse these two unrelated things:
- Each endpoint's "route" below (e.g. "/api/v1/notes") is the URL ROUTE to implement — pass it to router.get/post/put/patch/delete(), never to write_file's "path" argument.
- write_file's "path" argument is always a SOURCE FILE PATH relative to the project root (e.g. "src/routes/notes.ts"). Every write_file call must use a distinct file path — never reuse the same path for two different pieces of content.

API CONTRACT (implement ALL these endpoints):
${renderApiContractForPrompt(plan.apiContract)}

DATABASE SCHEMA (use these EXACT table and column names):
${JSON.stringify(plan.dbSchema, null, 2)}

SHARED TYPES (frontend and backend must agree on these):
${plan.sharedTypes ?? ""}

PLANNED BACKEND FILES (you MUST implement every file listed here — this is
the complete, exhaustive manifest; nothing outside this workflow's plan is
expected, and nothing in it should be skipped):
${taskDetails}

Start by using list_files to see what scaffold files are already present.
Then write EVERY planned file above completely, batching several write_file
calls per turn — do not pause to type-check between individual files. Only
once every planned file is written do you move to the single verification
pass described in your system prompt.`;
}

// ── Static scaffold — written before agent starts ────────────────────────────
function writeStaticScaffold(plan: BuildPlan, outputDir: string): void {
  const port = plan.apiContract.baseUrl?.match(/:(\d+)/)?.[1] ?? "3001";

  const files: Array<{ path: string; content: string }> = [
    {
      path: "package.json",
      content: JSON.stringify({
        name: `${plan.projectId}-backend`,
        version: "1.0.0",
        private: true,
        scripts: {
          build: "tsc --outDir dist --rootDir src",
          start: "node dist/index.js",
          dev: "ts-node-dev --respawn --transpile-only src/index.ts",
        },
        dependencies: {
          express: "^4.21.2",
          jsonwebtoken: "^9.0.2",
          bcryptjs: "^2.4.3",
          cors: "^2.8.5",
          helmet: "^8.0.0",
          dotenv: "^16.5.0",
          pg: "^8.14.1",
          zod: "^3.24.1",
          "express-rate-limit": "^7.5.0",
        },
        devDependencies: {
          typescript: "^5.7.0",
          "@types/express": "^5.0.0",
          "@types/cors": "^2.8.17",
          "@types/pg": "^8.11.11",
          "@types/node": "^22.0.0",
          "@types/jsonwebtoken": "^9.0.8",
          "@types/bcryptjs": "^2.4.6",
          "ts-node-dev": "^2.0.0",
        },
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "commonjs", lib: ["ES2022"],
          outDir: "./dist", rootDir: "./src",
          strict: true, esModuleInterop: true, resolveJsonModule: true,
          skipLibCheck: true, forceConsistentCasingInFileNames: true,
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist"],
      }, null, 2),
    },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE ${port}
CMD ["node", "dist/index.js"]
`,
    },
    {
      path: "src/index.ts",
      content: `import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import routes from "./routes/index";

const app = express();
const port = Number(process.env.PORT) || ${port};

app.use(express.json());
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000", credentials: true }));
app.use("/api/v1", routes);
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(port, () => console.log(\`[backend] listening on :\${port}\`));
`,
    },
    {
      path: "src/routes/index.ts",
      // Placeholder — autoWireRoutes() replaces this after agent writes route files
      content: `import { Router } from "express";
export default Router();
`,
    },
    {
      path: "src/types/requests.ts",
      content: `export interface CreateTaskRequest {
  title: string;
  description?: string | null;
  dueDate?: string | null;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  isCompleted?: boolean;
}
`,
    },
  ];

  for (const { path: relPath, content } of files) {
    const absPath = join(outputDir, relPath);
    mkdirSync(join(outputDir, relPath.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
  }
}
