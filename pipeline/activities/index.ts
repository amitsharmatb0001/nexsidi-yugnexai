// Temporal activities — one per pipeline stage.
// Each is retryable, timeout-bounded, and observable in Temporal UI.
// All TODO stubs are now replaced with real agent calls.

import { run as runSaanviAgent }  from "../../agents/saanvi/src/index.ts";
import { run as runArjunAgent, getBuildDir, pathToNextjsFile } from "../../agents/arjun/src/index.ts";
import { run as runShubhamAgent, runFix as runShubhamFix } from "../../agents/generators/shubham/src/index.ts";
import { run as runAanyaAgent, runFix as runAanyaFix }   from "../../agents/generators/aanya/src/index.ts";
import { run as runPranavAgent }  from "../../agents/generators/pranav/src/index.ts";
// 2026-07-24 (P1, full agentic upgrade): the real GAN (evidence-gated QA +
// peer debate + fault isolation + instinct memory) and the real deploy +
// live-browser-retest stage — both previously reachable only from
// pipeline/dev-run.ts / scripts/stress-test.ts, never from this Temporal
// worker. This is the unification: drive them as activities instead of
// running the degenerate one-shot QA scorer that used to live in this file
// (runQaAgent + runNavya/Karan/Deepika — deleted 2026-07-25, see
// audit-2026-07-25.md's Phase 2 completion note; their only caller, the
// legacy pre-unification QA loop, was already deleted from
// pipeline/workflows/project-build.ts).
import { runQAFixLoop } from "../orchestrator/stages/stage5-qa-fix-loop.ts";
import { runStage6 } from "../orchestrator/stages/stage6-deployment.ts";
// 2026-07-26 (Patent Claims 1/3/7 wiring): the crypto primitives in
// packages/context-chain existed and were tested but had zero callers
// anywhere in the repo — context_chain had 0 rows after 9+ real pipeline
// runs (audit-2026-07-25.md). recordHandoff/verifyHandoff below are the
// real call sites, wired at the boundaries where content is provably
// stable between record and verify (see context-chain-activities.ts's
// header comment for why the generation->QA boundary is scoped
// differently — npm install between them would make a naive full-tree
// hash produce false-positive rollbacks).
import { recordHandoff, verifyHandoff } from "./context-chain-activities.ts";
// Phase 5 (full agentic upgrade): Firecrawl's page-fetch capability existed
// but was reachable ONLY from agents/planner/src/index.ts. Saanvi is a
// one-shot agentChat caller, not a tool-calling agent loop (unlike
// Aanya/Shubham/QA), so the fetch_url TOOL wired into loop.ts/gemini-loop.ts
// never reaches her — a user saying "build me a site like
// https://example.com" had that URL sit as inert text. extractFirstUrl +
// execFetchUrl below inject the real fetched content into her prompt the
// same way getAttachmentsContext already injects uploaded file content.
import { execFetchUrl } from "../../packages/agent-runtime/src/tools/research.ts";
import { agentChat }               from "@nexsidi/llm-client";
import { db, projects, qaResults, stuckStateLog } from "@nexsidi/db";
import { eq, and } from "drizzle-orm";
import { Context, ApplicationFailure } from "@temporalio/activity";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync, spawnSync } from "child_process";
import type { ProjectSpec } from "../../agents/saanvi/src/index.ts";
import type { BuildPlan }   from "../../agents/arjun/src/index.ts";
import type { DesignBrief } from "../../agents/vanya/src/index.ts";
import { isQuotaExhaustionError } from "../../packages/agent-runtime/src/gemini-loop.ts";
// 2026-08-11 (cost-control Task 1): checkBudget's persisted per-project
// total is the ceiling assertWithinBudget (below) gates every generator/QA
// activity entry point on — see docs/nexsidi/plans/2026-08-11-cost-control.md
// for the incident this responds to.
import { checkBudget } from "../../packages/agent-runtime/src/cost-budget.ts";

// ── In-process cache (activities run in same Temporal worker process)
const specCache = new Map<string, ProjectSpec>();
const planCache = new Map<string, BuildPlan>();

function getAttachmentsContext(projectId: string): string {
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const attachmentsDir = join(buildDir, projectId, "attachments");
  if (!existsSync(attachmentsDir)) return "";

  try {
    const files = readdirSync(attachmentsDir);
    if (files.length === 0) return "";

    let context = "\n\n=== USER UPLOADED ATTACHMENTS ===\n";
    for (const file of files) {
      const filePath = join(attachmentsDir, file);
      const stat = statSync(filePath);
      if (stat.isFile()) {
        context += `File: ${file} (${stat.size} bytes)\n`;
        const isText = /\.(txt|json|md|ts|js|tsx|jsx|html|css|csv|xml|yaml|yml)$/i.test(file);
        if (isText && stat.size < 200000) {
          const content = readFileSync(filePath, "utf-8");
          context += `Content:\n\"\"\"\n${content}\n\"\"\"\n\n`;
        } else {
          context += `[Non-text or large binary file: content not printed]\n\n`;
        }
      }
    }
    return context;
  } catch (err) {
    console.warn("Failed to read attachments context:", err);
    return "";
  }
}

// Pure — no network, no I/O. Requires an explicit http(s):// protocol so a
// bare company name that happens to look like a domain (e.g. "our company
// is called nextech.com") is never mistaken for a real reference URL.
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) return null;
  // Strip trailing prose punctuation (comma, period, closing quote/paren)
  // that regularly follows a URL in a sentence but isn't part of it.
  return match[0].replace(/[.,;:!?)'"]+$/, "");
}

async function getReferencedUrlContext(userRequest: string): Promise<string> {
  const url = extractFirstUrl(userRequest);
  if (!url) return "";

  const result = await execFetchUrl({ url });
  if (result.status !== "success" || !result.output) {
    console.warn(`[activity:saanvi] could not fetch referenced URL ${url}: ${result.summary}`);
    return "";
  }
  return `\n\n=== REFERENCED PAGE (${url}) ===\n${result.output}\n`;
}

// ── Planner fast path: check if build-plan.json was pre-generated ───────────────
export async function checkBuildPlanExists(projectId: string): Promise<boolean> {
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const planPath = join(buildDir, projectId, "build-plan.json");
  for (let i = 0; i < 10; i++) {
    if (existsSync(planPath)) return true;
    await new Promise(res => setTimeout(res, 200));
  }
  return false;
}

export interface SaanviActivityResult {
  status: "locked" | "needs_clarification";
  questions?: string[];
}

// ── Stage 1: Requirements → locked ProjectSpec ─────────────────────────────────
// 2026-08-05: previously always locked a spec, guessing at anything unclear
// (root cause: agents/saanvi/src/index.ts's run() had no way to signal
// ambiguity — see its header comment). Now returns a result the workflow
// checks: on "needs_clarification" it pauses for a human answer (via
// askAndWait in pipeline/workflows/project-build.ts) and re-invokes this same
// activity with `clarificationAnswer` appended to the original request,
// rather than writing spec.json/recording the handoff. `clarificationAnswer`
// is appended, not substituted — Saanvi sees the full original request PLUS
// the answer, so it isn't re-deriving context it already had.
export async function runSaanvi(
  projectId: string,
  userRequest?: string,
  clarificationAnswer?: string,
): Promise<SaanviActivityResult> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    if (userRequest) writeCacheFile(projectId, "user-request.txt", userRequest);
    const req  = userRequest ?? readUserRequest(projectId);
    const attachmentsContext = getAttachmentsContext(projectId);
    // Phase 5: "build me a site like https://..." — fetch what the user
    // actually referenced instead of letting the URL sit as inert text.
    // Fails open (empty string) on any error; real requirements gathering
    // must not block on an external fetch.
    const urlContext = await getReferencedUrlContext(req);
    const answerContext = clarificationAnswer
      ? `\n\n=== CLARIFICATION (user's answer to your previous question(s)) ===\n${clarificationAnswer}\n`
      : "";
    const enrichedReq = req + attachmentsContext + urlContext + answerContext;
    const result = await runSaanviAgent(projectId, enrichedReq);
    if (result.status === "needs_clarification") {
      console.log(`[activity:saanvi] needs clarification for ${projectId} — ${result.questions.length} question(s)`);
      return { status: "needs_clarification", questions: result.questions };
    }
    const spec = result.spec;
    specCache.set(projectId, spec);
    writeCacheFile(projectId, "spec.json", JSON.stringify(spec, null, 2));
    // Patent Claim 1/7: hash + sign the locked spec as it's handed to Arjun.
    await recordHandoff(projectId, "saanvi", "arjun", spec);
    console.log(`[activity:saanvi] spec locked for ${projectId} — ${spec.features.length} features`);
    return { status: "locked" };
  } finally {
    clearInterval(hb);
  }
}

// ── Stage 2: Spec → BuildPlan (API contract + DB schema + task decomp) ─────────
export async function runArjun(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const spec = specCache.get(projectId) ?? readCacheFile<ProjectSpec>(projectId, "spec.json");
    // Patent Claim 3: verify the spec Saanvi handed off before trusting it —
    // rolls back (escalates + halts, nonRetryable) on hash/signature failure
    // or a missing chain record.
    await verifyHandoff(projectId, "saanvi", "arjun", spec);

    // Read the planner's locked page list before it gets overwritten.
    // The planner writes build-plan.json with pages[] + authType; Arjun's job is to
    // ANNOTATE that list, not invent a new one. Detected by presence of pages[] without
    // shubhamTasks (Arjun's marker).
    const plannerPlan = readPlannerSimplePlan(projectId);
    // Stamp nextjsFile in TypeScript (deterministic) so Arjun copies it verbatim,
    // never derives it from the URL path (where the LLM consistently gets it wrong).
    const lockedPages = plannerPlan?.pages.map(p => ({
      ...p,
      nextjsFile: pathToNextjsFile(p.path),
    }));
    const plan = await runArjunAgent(spec, { chat: agentChat }, lockedPages, plannerPlan?.authType);

    planCache.set(projectId, plan);
    writeCacheFile(projectId, "build-plan.json", JSON.stringify(plan, null, 2));
    // Patent Claim 1/7: the locked plan fans out to three independent
    // receivers — each is its own real handoff (its own hash-chain row),
    // not one row shared across three agents.
    await recordHandoff(projectId, "arjun", "shubham", plan);
    await recordHandoff(projectId, "arjun", "aanya", plan);
    await recordHandoff(projectId, "arjun", "pranav", plan);
    console.log(`[activity:arjun] plan ready — ${plan.apiContract.endpoints.length} endpoints, ${plan.dbSchema.tables.length} tables`);
  } finally {
    clearInterval(hb);
  }
}

// 2026-08-05: real gap found live — Vanya generates a DesignBrief (mood,
// palette, typography, layoutConcept) inside Arjun's run(), and it flows
// straight into BuildPlan with ZERO human visibility: `apps/` has no page
// that ever shows it, and the existing "await_spec_approval" gate only
// exposes spec.name/description/features (see stage1-requirements.ts's own
// header comment) — the user approves a feature list having never seen the
// colors/typography/layout direction about to be built. Root-caused via the
// same "check what's true, don't assume" discipline as the redeploy/spec-
// compliance fixes above. Minimal, additive: reads the SAME build-plan.json
// runArjun already writes; doesn't change runArjun's own contract.
export async function getDesignBrief(projectId: string): Promise<DesignBrief> {
  const plan = planCache.get(projectId) ?? readCacheFile<BuildPlan>(projectId, "build-plan.json");
  return plan.designBrief;
}

interface PlannerSimplePlan {
  pages: Array<{ name: string; path: string; description: string }>;
  authType: "none" | "jwt";
}

function readPlannerSimplePlan(projectId: string): PlannerSimplePlan | null {
  const p = join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId, "build-plan.json");
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    // Planner's plan has pages[] + authType but NOT shubhamTasks (Arjun adds those)
    if (Array.isArray(data.pages) && !data.shubhamTasks) {
      return {
        pages: data.pages as PlannerSimplePlan["pages"],
        authType: (data.authType === "jwt" ? "jwt" : "none") as "none" | "jwt",
      };
    }
    return null;
  } catch { return null; }
}

// 2026-07-25 (P4, live NexTech run): real bug found live — a generator
// hitting its own max-iterations ceiling (result.success:false) is a
// DETERMINISTIC outcome; the agent loop already exhausted its own internal
// retry/escalation logic before returning. genAct's Temporal retry policy
// (maximumAttempts: 5) doesn't know that — a plain `throw new Error` here
// is retryable by default, so Temporal blindly re-ran the SAME failing
// Shubham generation 5 times with the SAME config, burning ~71 minutes and
// 5x the real Gemini API cost before finally giving up with the exact same
// failure. ApplicationFailure with nonRetryable:true tells Temporal this
// specific failure class cannot be fixed by retrying, so it fails fast
// after the first attempt — genuinely transient issues (network blips, API
// rate limits) are unaffected, since those are already retried INSIDE the
// agent loop itself (see loop.ts's catch blocks) before result.success is
// ever set to false.
// 2026-08-05: real bug found live (project d709f34a800e, web-UI-triggered
// build) — a transient full-pool Gemini quota exhaustion (the exact shape
// isQuotaExhaustionError/isAllPoolModelsExhaustedError detect) was always
// thrown nonRetryable, killing the ENTIRE workflow instantly — losing
// Shubham's and Pranav's already-completed work too, since Promise.all in
// project-build.ts fails all three together. A genuine generator failure
// (malformed output, stuck loop) really is unrecoverable by retrying
// immediately, so it keeps nonRetryable:true; quota exhaustion gets
// nonRetryable:false instead, so Temporal's own retry policy (genAct:
// maximumAttempts 5) gets a chance — paired with runGeneratorWithQuotaRetry
// below, which waits out the same ~90s cooldown deployWithQuotaRetry uses
// BEFORE ever reaching this function, so by the time this throws, retrying
// immediately again would be wasted anyway for a non-quota failure.
export function generatorFailure(agentName: string, errors: string[]): never {
  throw ApplicationFailure.create({
    message: `[${agentName}] ${errors.join("; ")}`,
    type: "GeneratorExhausted",
    nonRetryable: !isQuotaExhaustionError(errors),
  });
}

// 2026-08-11 (cost-control Task 1): called at the top of every generator and
// QA activity entry point, before any LLM work for that stage happens. An
// over-budget project must halt BEFORE spending more, not after — the whole
// point of a "hard" budget, and the direct fix for the $29K/week incident
// (docs/nexsidi/plans/2026-08-11-cost-control.md), which happened precisely
// because nothing checked a running dollar total against a ceiling anywhere
// in this pipeline.
//
// Mirrors generatorFailure's exact shape (ApplicationFailure, type +
// nonRetryable:true) so this reaches the workflow the same proven way a
// generator's own exhaustion does. nonRetryable is correct here for the
// SAME reason it's correct there: Temporal's own retry policy (genAct:
// maximumAttempts 5 / orchestratorAct: 2) blindly re-running an over-budget
// activity would just spend more — the opposite of the fix — before ever
// reaching a human decision.
//
// type: "BudgetExceeded" and the "budget_exceeded: " message prefix are
// both load-bearing — pipeline/workflows/project-build.ts's
// isBudgetExceededFailure() and its Stage 3/Stage 5 catch blocks key off
// them to route this into escalateAndAwaitRetryDecision("budget_exceeded")
// instead of the generic "generation_failed"/uncaught-failure paths.
export async function assertWithinBudget(projectId: string, agentName: string): Promise<void> {
  const status = await checkBudget(projectId);
  if (!status.withinBudget) {
    throw ApplicationFailure.create({
      message: `budget_exceeded: project ${projectId} has spent $${status.spentUsd.toFixed(2)} of its $${status.capUsd.toFixed(2)} cap — halted before ${agentName} ran`,
      type: "BudgetExceeded",
      nonRetryable: true,
    });
  }
}

// 2026-08-06: real bug found live (project bae438767bed) — this retry
// wrapper was only ever wired into runShubham/runAanya/runPranav (initial
// generation, below). stage5-qa-fix-loop.ts's DI wiring called each agent's
// exported runFix() DIRECTLY, with no retry wrapper at all — when a shared-
// pool quota exhaustion hit all three generators' FIX rounds simultaneously
// (entirely plausible: they run concurrently via Promise.all and share the
// same NIM/Gemini model pools), all three failed outright within a handful
// of iterations (nowhere near their iteration caps), the fix-loop saw zero
// improvement, and the whole workflow escalated as "stuck" — not because
// the findings were hard to fix, but because this retry mechanism was never
// extended to the FIX path. Moved to its own module (quota-retry.ts) so
// stage5-qa-fix-loop.ts can wrap its three fix calls with the identical
// retry behavior without index.ts <-> stage5-qa-fix-loop.ts becoming a
// circular import (index.ts already imports runQAFixLoop from there).
import { runGeneratorWithQuotaRetry } from "./quota-retry.ts";

// ── Stage 3a–c: code generators (run in parallel from workflow) ───────────────
export async function runShubham(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "shubham");
    const plan = getPlan(projectId);
    await verifyHandoff(projectId, "arjun", "shubham", plan);
    const result = await runGeneratorWithQuotaRetry(() => runShubhamAgent(plan));
    if (!result.success) generatorFailure("shubham", result.errors);
    console.log(`[activity:shubham] ${result.filesWritten.length} files → ${result.outputDir}`);
  } finally {
    clearInterval(hb);
  }
}

export async function runAanya(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "aanya");
    const plan = getPlan(projectId);
    await verifyHandoff(projectId, "arjun", "aanya", plan);
    const result = await runGeneratorWithQuotaRetry(() => runAanyaAgent(plan, "integrate"));
    if (!result.success) generatorFailure("aanya", result.errors);
    console.log(`[activity:aanya] ${result.filesWritten.length} files → ${result.outputDir}`);
  } finally {
    clearInterval(hb);
  }
}

export async function runPranav(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "pranav");
    const plan = getPlan(projectId);
    await verifyHandoff(projectId, "arjun", "pranav", plan);
    const result = await runGeneratorWithQuotaRetry(() => runPranavAgent(plan));
    if (!result.success) generatorFailure("pranav", result.errors);
    console.log(`[activity:pranav] ${result.filesWritten.length} DB files written`);
  } finally {
    clearInterval(hb);
  }
}

// ── TypeScript compile gate — runs BEFORE QA scoring ────────────────────────
// Fails fast if tsc can't compile — saves QA time on uncompilable code.
export function resolveNodeCommand(
  command: "npm" | "npx",
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? `${command}.cmd` : command;
}

export function describeCommandFailure(result: {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string | null;
  stderr: string | null;
  error?: Error;
}): string {
  const detail = [result.error?.message, result.stderr, result.stdout]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));

  if (detail) return detail.slice(0, 500);
  if (result.signal) return `terminated by signal ${result.signal}`;
  return `exited with status ${result.status ?? "unknown"}`;
}

export async function runCompileCheck(
  projectId: string,
): Promise<{ pass: boolean; errors: string; timedOut: boolean }> {
  const buildDir = getBuildDir(projectId);
  const backendDir = join(buildDir, "backend");
  const frontendDir = join(buildDir, "frontend");
  const results: string[] = [];
  let timedOut = false;

  for (const [label, dir] of [["backend", backendDir], ["frontend", frontendDir]] as const) {
    if (!existsSync(join(dir, "tsconfig.json"))) continue;
    // Install deps first so tsc can resolve imports and catch type errors.
    // --ignore-scripts prevents postinstall hooks that may fail in CI-like environments.
    // Try bun install first (faster, no spawn issues on Windows), fall back to npm
    // Install deps so tsc can resolve imports. Skip if node_modules already present.
    // Use bun (always available in this runtime) — avoids Windows npm spawn timeout.
    // If install fails, proceed anyway: tsc will catch missing-module errors explicitly.
    const nodeModulesExists = existsSync(join(dir, "node_modules"));
    if (!nodeModulesExists) {
      const bunInstall = spawnSync(process.execPath, ["install", "--ignore-scripts"], {
        cwd: dir, encoding: "utf-8", timeout: 180_000,
        env: { ...process.env },
      });
      if (bunInstall.status !== 0) {
        console.log(`[compile-check] ${label}: bun install failed (${describeCommandFailure(bunInstall)}), proceeding to tsc anyway`);
      }
    }
    try {
      // Invoke the local tsc entry point directly via the runtime — bypasses
      // npx + cmd.exe shell wrapping, which on Windows spawns a process tree
      // (cmd.exe -> npx.cmd -> node -> tsc) prone to hanging (an orphaned
      // grandchild holding the stdout pipe open past the parent's timeout).
      // Direct invocation is both faster and immune to that hang.
      const localTscBin = join(dir, "node_modules", "typescript", "bin", "tsc");
      const tsc = existsSync(localTscBin)
        ? spawnSync(process.execPath, [localTscBin, "--noEmit", "--pretty", "false"], {
            cwd: dir, encoding: "utf-8", timeout: 60_000,
            env: { ...process.env, FORCE_COLOR: "0" },
          })
        : spawnSync(resolveNodeCommand("npx"), ["tsc", "--noEmit", "--pretty", "false"], {
            cwd: dir, encoding: "utf-8", timeout: 300_000, shell: process.platform === "win32",
            env: { ...process.env, FORCE_COLOR: "0" },
          });
      const out = ((tsc.stdout ?? "") + (tsc.stderr ?? "")).trim();
      // Fail on any non-zero exit — catches syntax errors, missing files, import failures.
      if (tsc.status !== 0) {
        // A timed-out/signal-killed process has status=null and empty stdout/stderr —
        // that is NOT a compile error, just an inconclusive run. Report it distinctly
        // so the caller (code-fix) doesn't waste an iteration guessing at a fix for
        // an error that was never actually reported.
        if (!out) {
          timedOut = true;
          results.push(`${label}: tsc produced no output — ${describeCommandFailure(tsc)} (not a compile error, rerun)`);
        } else {
          const errorLines = out.split("\n").filter((l) => l.trim()).slice(0, 25);
          results.push(`${label}: tsc exit ${tsc.status}\n${errorLines.join("\n")}`);
        }
      } else {
        console.log(`[compile-check] ${label}: clean ✓`);
      }
    } catch (e) {
      results.push(`${label}: tsc failed — ${String(e)}`);
    }
  }

  const pass = results.length === 0;
  const errors = results.join("\n\n");
  console.log(`[activity:compile-check] project=${projectId} pass=${pass}${pass ? "" : `\n${errors}`}`);
  return { pass, errors, timedOut };
}

// ── WS event publisher — appends to events.jsonl, tailed by /ws/pipeline/:id ─
function appendEvent(projectId: string, event: Record<string, unknown>): void {
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const logsDir = join(buildDir, projectId, "logs");
  try {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(join(logsDir, "events.jsonl"), JSON.stringify({ ...event, ts: Date.now() }) + "\n", "utf-8");
  } catch (e) {
    console.warn("[events] failed to append:", e);
  }
}

// ── Code fix: target only the generator that owns the failing code ───────────
export type RepairTarget = "backend" | "frontend";

export function selectRepairTargets(reason: string): RepairTarget[] {
  if (!reason.startsWith("compile_error")) return ["backend", "frontend"];

  const detail = reason.replace(/^compile_error:\s*/, "");
  const backendFailed = /(?:^|\n)backend:/m.test(detail);
  const frontendFailed = /(?:^|\n)frontend:/m.test(detail);

  if (backendFailed && !frontendFailed) return ["backend"];
  if (frontendFailed && !backendFailed) return ["frontend"];
  return ["backend", "frontend"];
}

interface RepairRunners {
  backend: (plan: BuildPlan, findings: string[]) => Promise<unknown>;
  frontend: (plan: BuildPlan, findings: string[]) => Promise<unknown>;
}

export async function runSelectedRepairs(
  targets: RepairTarget[],
  plan: BuildPlan,
  findings: string[],
  runners: RepairRunners = { backend: runShubhamFix, frontend: runAanyaFix },
): Promise<void> {
  await Promise.all(targets.map((target) => runners[target](plan, findings)));
}

export async function runCodeFix(projectId: string, iteration: number, reason: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  console.log(`[activity:code-fix] iter=${iteration} reason=${reason}`);

  // Publish self-heal event so the UI shows amber "Fixing..." card
  const shortReason = reason
    .replace(/^(live_check_fail|compile_error|qa_fail|spec_mismatch):\s*/, "")
    .slice(0, 150);
  appendEvent(projectId, {
    type: "repair",
    agent: "system",
    tool: "code_fix",
    attempt: iteration,
    errorSnippet: shortReason || reason.slice(0, 80),
  });

  try {
    const findings = await db
      .select({ agent: qaResults.agentName, score: qaResults.score, findings: qaResults.findings })
      .from(qaResults)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      .where(and(eq(qaResults.projectId, projectId), eq(qaResults.iteration, iteration))!);

    const qaFindings = findings
      .flatMap((r) =>
        (r.findings as Array<{ severity: string; description: string }>).map(
          (f) => `[${r.agent.toUpperCase()}] ${f.severity}: ${f.description}`,
        ),
      );

    // Include the build/run reason so the LLM knows the EXACT error to fix.
    // Without this, after a live_check_fail the LLM only sees QA findings (which passed)
    // and doesn't know about the TypeScript syntax error that broke the Docker build.
    const plan = getPlan(projectId);
    const buildFinding = reason.startsWith("live_check_fail") || reason.startsWith("compile_error")
      ? [`BUILD ERROR (fix this first):\n${reason.replace(/^(live_check_fail|compile_error):\s*/, "").slice(0, 8_000)}`]
      : [];
    const repairFindings = [
      `Fix iteration ${iteration}.`,
      ...buildFinding,
      ...qaFindings,
    ];
    const targets = selectRepairTargets(reason);
    console.log(`[activity:code-fix] repair targets=${targets.join(",")}`);

    // The schema generator is intentionally excluded: compile and QA repairs
    // operate on the existing frontend/backend trees.
    await runSelectedRepairs(targets, plan, repairFindings);
  } finally {
    clearInterval(hb);
  }
}

// ── Stuck-state logging ────────────────────────────────────────────────────────
export async function logStuckState(
  projectId: string,
  iteration: number,
  minScore: number,
  improvement: number,
): Promise<void> {
  console.warn(`[activity:stuck] project=${projectId} iter=${iteration} minScore=${minScore} improvement=${improvement}`);
  await db.insert(stuckStateLog).values({
    projectId, iteration,
    minScore,
    improvement,
    createdAt: new Date(),
  }).onConflictDoNothing();
}

export type ProjectStatusWriter = (projectId: string, status: "failed" | "needs_review") => Promise<void>;

const writeProjectStatus: ProjectStatusWriter = async (projectId, status) => {
  await db
    .update(projects)
    .set({ status, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
};

// ── Escalate to Tilotma (stuck-state or unrecoverable failure) ────────────────
// 2026-07-25 (Phase 6, full MVP upgrade): this was a pure console.error stub
// — found live on nextech10's own run, which hit exactly this path
// (qa-fix-loop stuck after 4 rounds, 4 findings not converging). The
// projects.status column already existed and markProjectFailed already
// wrote a real status for hard failures; a STUCK escalation left the row
// silently at whatever status it already had — a user with no log tail
// open would see nothing different from a healthy, still-running build.
// This does not yet build the "Tilotma asks user ONE specific question via
// Maya SSE" UI CLAUDE.md describes (D16's HITL "blocking" gate) — that is
// real remaining scope — but a project stuck in "needs_review" is at least
// visibly different from "pending"/"generating" to any caller that reads
// project status, instead of indistinguishable silence.
export async function escalateTilotma(
  projectId: string,
  reason: string,
  state: unknown,
  writeStatus: ProjectStatusWriter = writeProjectStatus,
): Promise<void> {
  console.error(`[activity:escalate] project=${projectId} reason=${reason}`, state);
  await writeStatus(projectId, "needs_review");
}

export async function markProjectFailed(
  projectId: string,
  reason: string,
  writeStatus: ProjectStatusWriter = writeProjectStatus,
): Promise<void> {
  console.error(`[activity:project-failed] project=${projectId} reason=${reason}`);
  await writeStatus(projectId, "failed");
}

// ── Stage 5 (P1): the real GAN — evidence-gated QA + peer debate +
// fault isolation + instinct memory. Replaced the degenerate one-shot
// runQaAgent scorer as the QA path new workflow runs take (that scorer
// and its callers were deleted 2026-07-25 — see audit-2026-07-25.md).
export function buildStage4Result(projectId: string): { backendOutputDir: string; frontendOutputDir: string; filesWritten: string[] } {
  const buildDir = getBuildDir(projectId);
  return {
    backendOutputDir: join(buildDir, "backend"),
    frontendOutputDir: join(buildDir, "frontend"),
    filesWritten: collectFiles(buildDir),
  };
}

// Context-chain hashing needs a manifest that changes if and only if the
// GENERATED source changes — collectFiles() above (reused as-is for its
// other callers, runQAFixLoop/runStage6) walks node_modules too, which
// would make the hash noisy (thousands of npm paths) and, worse, is
// installed once by the pre-QA compile gate and never rewritten before
// this boundary, so including it adds no signal — only cost. Filtered here,
// not in collectFiles itself, so this scoping is local to the one caller
// that needs it.
//
// 2026-07-26 (live, simple1): deliberately DROPS backendOutputDir/
// frontendOutputDir from the returned (and therefore hashed) object.
// Root-caused via mtime forensics on a real rollback — no file in the build
// dir changed between recordHandoff and verifyHandoff, so the false-positive
// hash mismatch could only have come from the two raw absolute paths, which
// are environment-dependent (drive-letter case, slash direction, trailing
// slash, how BUILD_DIR got resolved in whichever process ran the activity)
// and carry no information about whether the actual SOURCE QA reviewed
// changed. Only the relative, filtered, sorted file list is what Claim 3
// needs to detect real tampering.
export function filterSourceManifest(stage4Result: { backendOutputDir: string; frontendOutputDir: string; filesWritten: string[] }) {
  // 2026-08-05 (live, verify361300): real rollback root-caused — Riya's
  // deploy step runs `git init && git add -A && git commit` (agents/riya/
  // src/index.ts) as the normal "GitHub repo" deliverable. buildStage4Result
  // does a LIVE directory rescan on every call, so when stage6's own retry
  // (or a Temporal activity retry) re-invokes verifyHandoff after Riya's
  // FIRST attempt already ran git init, the rescan now sees .git/* files
  // that weren't present when recordDeployHandoffActivity snapshotted the
  // manifest — a false-positive mismatch against the pipeline's OWN
  // artifact, not tampering. .git is generated deploy output, not reviewed
  // source, exactly like node_modules/.next/dist above — same exclusion logic.
  const EXCLUDE = /(^|\/)(node_modules|\.next|dist|\.git)(\/|$)|\.tsbuildinfo$|(^|\/)(package-lock\.json|bun\.lock|bun\.lockb|yarn\.lock|pnpm-lock\.yaml)$/;
  return {
    filesWritten: stage4Result.filesWritten.filter((f) => !EXCLUDE.test(f)).sort(),
  };
}

export interface QAFixLoopActivityResult {
  pass: boolean;
  stuck: boolean;
  iterations: number;
  findingsCount: number;
}

export async function runQAFixLoopActivity(projectId: string): Promise<QAFixLoopActivityResult> {
  const ctx = Context.current();
  const hb = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "qa-gan");
    const plan = getPlan(projectId);
    const stage4Result = buildStage4Result(projectId);
    const result = await runQAFixLoop(projectId, plan, stage4Result);
    console.log(
      `[activity:qa-fix-loop] pass=${result.pass} stuck=${result.stuck ?? false} iterations=${result.iterations} findings=${result.findings.length}`,
    );
    // 2026-08-04 (live, final838491 — 2nd occurrence, root-caused): recording
    // the handoff HERE used to cause a real, reproducible false-positive
    // hash mismatch. The post-QA compile-check step (project-build.ts) runs
    // AFTER this point and BEFORE deploy's verifyHandoff — it's a legitimate
    // pipeline step, not tampering, but it can still touch the build
    // directory (npm install if node_modules is stale, a killed/retried tsc
    // process). Two live runs hit this exact race. Recording is now done by
    // recordDeployHandoffActivity, called from the workflow AFTER compile-
    // check settles and BEFORE the deploy-approval wait — late enough to
    // avoid the compile-check race, early enough that the (potentially long)
    // human-approval wait is still covered by real tamper detection, unlike
    // collapsing record immediately against verify (which would make the
    // check a tautology — nothing could ever be caught).
    return {
      pass: result.pass,
      stuck: result.stuck ?? false,
      iterations: result.iterations,
      findingsCount: result.findings.length,
    };
  } finally {
    clearInterval(hb);
  }
}

// 2026-08-04 (live, final838491): split out of runQAFixLoopActivity so the
// snapshot is taken AFTER the post-QA compile-check settles (project-build.ts
// calls this between the compile-check retry loop and the deploy-approval
// wait), not at the instant QA passes. See runQAFixLoopActivity's header
// comment for the full root cause. Patent Claim 1/7: still records the exact
// codebase about to be trusted for deploy — just at a point that isn't racing
// a routine, expected pipeline step.
export async function recordDeployHandoffActivity(projectId: string): Promise<void> {
  const stage4Result = buildStage4Result(projectId);
  await recordHandoff(projectId, "qa-gan", "deploy", filterSourceManifest(stage4Result));
}

// ── Stage 6 (P1): deploy + re-run adversarial QA against the LIVE deployed
// URL, driving the real Playwright browser (Tilotma Tier-3). This is the
// only place in the running pipeline where the generated frontend is
// actually observed rendering, not just curled for an HTTP status code.
export interface DeployActivityResult {
  success: boolean;
  appUrl: string;
  stuck: boolean;
}

export async function runDeployWithLiveRetest(projectId: string): Promise<DeployActivityResult> {
  const ctx = Context.current();
  const hb = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const plan = getPlan(projectId);
    const stage4Result = buildStage4Result(projectId);
    // Patent Claim 3: verify the codebase QA just approved is exactly what
    // deploy is about to ship — before it's shipped.
    await verifyHandoff(projectId, "qa-gan", "deploy", filterSourceManifest(stage4Result));
    const result = await runStage6(projectId, stage4Result, plan);
    console.log(`[activity:deploy] success=${result.success} appUrl=${result.appUrl} stuck=${result.stuck ?? false}`);
    return { success: result.success, appUrl: result.appUrl, stuck: result.stuck ?? false };
  } finally {
    clearInterval(hb);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function getPlan(projectId: string): BuildPlan {
  return planCache.get(projectId) ?? readCacheFile<BuildPlan>(projectId, "build-plan.json");
}

function readUserRequest(projectId: string): string {
  const p = join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId, "user-request.txt");
  return existsSync(p) ? readFileSync(p, "utf-8").trim() : `Project ${projectId}`;
}

function writeCacheFile(projectId: string, filename: string, content: string): void {
  const dir = join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, "utf-8");
}

function readCacheFile<T>(projectId: string, filename: string): T {
  const p = join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId, filename);
  if (!existsSync(p)) throw new Error(`Cache file missing: ${p} — did runSaanvi/runArjun run first?`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function collectFiles(dir: string): string[] {
  const walk = (d: string, prefix = ""): string[] => {
    try {
      return readdirSync(d).flatMap((f) => {
        const full = join(d, f);
        const rel  = prefix ? `${prefix}/${f}` : f;
        return statSync(full).isDirectory() ? walk(full, rel) : [rel];
      });
    } catch { return []; }
  };
  return walk(dir);
}

export async function checkPlanNeeds(projectId: string): Promise<{ shubham: boolean; pranav: boolean }> {
  try {
    const plan = getPlan(projectId);
    return {
      shubham: Array.isArray(plan.shubhamTasks) && plan.shubhamTasks.length > 0,
      pranav: Array.isArray(plan.pranavTasks) && plan.pranavTasks.length > 0,
    };
  } catch (err) {
    console.warn("Failed to check plan needs, defaulting to true:", err);
    return { shubham: true, pranav: true };
  }
}
