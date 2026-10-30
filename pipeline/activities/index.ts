// Temporal activities — one per pipeline stage.
// Each is retryable, timeout-bounded, and observable in Temporal UI.
// All TODO stubs are now replaced with real agent calls.

import { run as runSaanviAgent }  from "../../agents/saanvi/src/index.ts";
import { run as runArjunAgent, getBuildDir, pathToNextjsFile, withNormalizedDbSchema, writePlanFiles } from "../../agents/arjun/src/index.ts";
import { memoizeStep } from "../../packages/agent-runtime/src/step-memo.ts";
import { run as runShubhamAgent, runFix as runShubhamFix } from "../../agents/generators/shubham/src/index.ts";
import { run as runAanyaAgent, runFix as runAanyaFix }   from "../../agents/generators/aanya/src/index.ts";
import { ensureClientDirectiveForStyledModules } from "../../agents/generators/aanya/src/client-directive.ts";
import { runChecked as runPranavAgent }  from "../../agents/generators/pranav/src/index.ts";
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
import { buildHandoffContext } from "./handoff-context.ts";
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
import { readSystemVersion, stampSystemVersion, checkSystemVersion } from "../orchestrator/system-version.ts";
import { openCustomerQuestions, recordCustomerAnswer } from "../../packages/agent-runtime/src/tools/ask.ts";
import { openBlockers } from "../../packages/agent-runtime/src/tools/blocked.ts";
import { toCustomerText } from "../../packages/agent-runtime/src/customer-text.ts";
import { fileURLToPath } from "node:url";
import { writeAcceptanceTests, testerPrompts, defaultTesterChat } from "../../agents/qa/aarav/src/index.ts";
import { readAcceptanceTests, saveAcceptanceTests, acceptanceTestsForPhase } from "../orchestrator/acceptance-tests.ts";
import { runAcceptanceGate } from "../orchestrator/acceptance-gate.ts";
import { realGateDeps } from "../orchestrator/acceptance-gate-real.ts";
import { refreshAppMap } from "../orchestrator/app-map/index.ts";

// ── In-process cache (activities run in same Temporal worker process)
const specCache = new Map<string, ProjectSpec>();
const planCache = new Map<string, BuildPlan>();

function getAttachmentsContext(projectId: string): string {
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const attachmentsDir = join(buildDirFor(projectId, buildDir), "attachments");
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
  const planPath = join(buildDirFor(projectId, buildDir), "build-plan.json");
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
    stampSystemVersion(buildDirFor(projectId), await readSystemVersion(REPO_ROOT), "spec");
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
    // 2026-10-22: the finished spec is kept and reused by a retry with the same request (step-memo.ts).
    const result = await memoizeStep(buildDirFor(projectId), "saanvi-spec", { projectId, enrichedReq }, () => runSaanviAgent(projectId, enrichedReq));
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
// 2026-08-30: rejectionFeedback threads through from the workflow's own
// clarificationHistory (the exact text the user typed rejecting the prior
// round) so runArjunAgent can decide whether Vanya's design brief needs to
// be regenerated at all — see isDesignRelatedFeedback's header comment in
// agents/arjun/src/index.ts for the live inefficiency this closes. Adding a
// parameter to an existing activity call is safe for Temporal replay (it
// doesn't change which activities run or in what order — only what
// argument an already-recorded call receives), so this needs no patched()
// guard, unlike a workflow-level control-flow change would.
export async function runArjun(projectId: string, rejectionFeedback?: string): Promise<void> {
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
    // Read the PRIOR round's build-plan.json (if this is a rejection re-run)
    // before it gets overwritten below — its designBrief is what a
    // non-design rejection should carry forward instead of paying for a
    // fresh Vanya run.
    let priorDesignBrief: BuildPlan["designBrief"] | undefined;
    try {
      priorDesignBrief = readCacheFile<BuildPlan>(projectId, "build-plan.json").designBrief;
    } catch {
      // No prior build-plan.json — first attempt at this project, nothing to reuse.
    }
    // 2026-09-28: normalised before it's written and hashed (see withNormalizedDbSchema).
    // 2026-10-22: the finished plan is kept and reused by a retry with the same inputs (step-memo.ts); a reused plan writes
    // its files again, as the run would have.
    const plan = withNormalizedDbSchema(await memoizeStep(buildDirFor(projectId), "arjun-plan",
      { spec, lockedPages, authType: plannerPlan?.authType, priorDesignBrief, rejectionFeedback, buildPhases: plannerPlan?.buildPhases },
      () => runArjunAgent(spec, { chat: agentChat }, lockedPages, plannerPlan?.authType, priorDesignBrief, rejectionFeedback, plannerPlan?.buildPhases)));
    writePlanFiles(projectId, plan);

    planCache.set(projectId, plan);
    writeCacheFile(projectId, "build-plan.json", JSON.stringify(plan, null, 2));
    // Patent Claim 1/7: the locked plan fans out to three independent
    // receivers — each is its own real handoff (its own hash-chain row),
    // not one row shared across three agents.
    await recordHandoff(projectId, "arjun", "shubham", plan);
    await recordHandoff(projectId, "arjun", "aanya", plan);
    await recordHandoff(projectId, "arjun", "pranav", plan);
    recordClaimEvidence(buildDirFor(projectId), 1, "task graph with capability-based assignment", {
      tasks: { backend: plan.shubhamTasks.length, frontend: plan.aanyaTasks.length, database: plan.pranavTasks.length },
      phases: plan.buildPhases?.length ?? 0,
      assigned: plan.assignments?.length ?? 0,
      movedByCapability: plan.assignments?.filter((a) => a.moved).length ?? 0,
      independenceVerified: plan.independenceVerified,
    });
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
  buildPhases?: Array<{ name: string; goal: string; pages: string[]; endpoints: string[]; tables: string[] }>;
}

// 2026-08-27: real bug found live (project 852be5aeaef4). build-plan.json is
// BOTH the planner's output AND Arjun's output — Arjun overwrites it at the
// end of runArjun (see writeCacheFile there, and line ~190's own "before it
// gets overwritten" comment). The detection below distinguishes them by
// "pages[] present, shubhamTasks absent", so it works exactly ONCE: on the
// FIRST Arjun run. Every re-run after that — and the spec-rejection loop
// re-runs Saanvi+Arjun on every rejection — reads Arjun's own output, sees
// shubhamTasks, returns null, and silently drops annotation mode. With
// lockedPages undefined, the reconciliation in agents/arjun/src/index.ts
// (the deterministic guarantee that every page the user was PROMISED gets
// built) never runs, and Arjun is free to re-invent the page list.
//
// Confirmed live: the user approved a plan containing /faq, rejected the
// spec twice on unrelated grounds (auth scope), and the delivered app had no
// /faq page at all — with nothing anywhere reporting it as dropped. This is
// the concrete mechanism behind the "why does it silently drop the plan"
// complaint.
//
// PLANNER_PLAN_FILE is a separate, write-once copy that Arjun never touches,
// so the planner's locked page list survives an arbitrary number of
// rejection re-runs. build-plan.json is still read as a fallback for
// projects created before this file existed.
const PLANNER_PLAN_FILE = "planner-plan.json";

function parsePlannerSimplePlan(raw: string): PlannerSimplePlan | null {
  const data = JSON.parse(raw) as Record<string, unknown>;
  // Planner's plan has pages[] + authType but NOT shubhamTasks (Arjun adds those)
  if (Array.isArray(data.pages) && !data.shubhamTasks) {
    return {
      pages: data.pages as PlannerSimplePlan["pages"],
      authType: (data.authType === "jwt" ? "jwt" : "none") as "none" | "jwt",
      ...(Array.isArray(data.buildPhases) && data.buildPhases.length ? { buildPhases: data.buildPhases as PlannerSimplePlan["buildPhases"] } : {}),
    };
  }
  return null;
}

function readPlannerSimplePlan(projectId: string): PlannerSimplePlan | null {
  const dir = buildDirFor(projectId);

  // Preferred: the durable copy, immune to Arjun's overwrite.
  const durable = join(dir, PLANNER_PLAN_FILE);
  if (existsSync(durable)) {
    try {
      const plan = parsePlannerSimplePlan(readFileSync(durable, "utf-8"));
      if (plan) return plan;
    } catch { /* fall through to the legacy path below */ }
  }

  // Legacy/first-run: build-plan.json still holds the planner's version.
  // Promote it to the durable copy so the NEXT run (after Arjun overwrites
  // build-plan.json) can still find it.
  const legacy = join(dir, "build-plan.json");
  if (!existsSync(legacy)) return null;
  try {
    const rawText = readFileSync(legacy, "utf-8");
    const plan = parsePlannerSimplePlan(rawText);
    if (plan) {
      try {
        writeCacheFile(projectId, PLANNER_PLAN_FILE, rawText);
        console.log(`[activity:arjun] preserved planner page list (${plan.pages.length} pages) to ${PLANNER_PLAN_FILE} — survives spec-rejection re-runs`);
      } catch (e) {
        console.error(`[activity:arjun] could not persist ${PLANNER_PLAN_FILE}: ${String(e)}`);
      }
    }
    return plan;
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
// 2026-10-04 (progress guard): work the guard held (see
// orchestrator/progress-guard.ts) leaves the activity as this non-retryable
// failure, so Temporal never re-runs it by itself; the workflow holds and asks
// the developer (guard_hold). HOLD.md in the build folder says why.
export function guardHoldFailure(hold: { reason: string; evidence: string[] }): ApplicationFailure {
  return ApplicationFailure.create({
    message: `guard_hold: ${hold.reason}`,
    type: "GuardHold",
    nonRetryable: true,
    details: [hold],
  });
}

// 2026-10-29 (team plan, stage 0): a build tests one version of the system. A version the owner has not accepted
// holds the build (see orchestrator/system-version.ts); the workflow asks the owner with reason "system_changed".
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export async function assertSameSystem(projectId: string, step: string): Promise<void> {
  const verdict = checkSystemVersion(buildDirFor(projectId), await readSystemVersion(REPO_ROOT), step);
  if (!verdict.ok) {
    console.error(`[SYSTEM CHANGED] ${verdict.reason}: ${verdict.evidence.join("; ")}`);
    throw ApplicationFailure.create({
      message: `system_changed: ${verdict.reason}`,
      type: "SystemChanged",
      nonRetryable: true,
      details: [verdict],
    });
  }
}

// 2026-10-29 (team plan, stage 2): a builder's question the approved documents do not answer (tools/ask.ts) stops the
// step before it counts as done; the workflow asks the customer in plain words, records the answer, and runs the step
// again with the answer in every builder's task.
export async function assertNoOpenCustomerQuestion(projectId: string): Promise<void> {
  const open = openCustomerQuestions(projectId);
  if (open.length === 0) return;
  console.log(`[activity] ${open.length} question(s) for the customer — the build waits for the answer`);
  throw ApplicationFailure.create({
    message: `customer_question: ${open.length} question(s) for the customer`,
    type: "CustomerQuestion",
    nonRetryable: true,
    details: [open.map((q) => ({ id: q.id, forCustomer: q.forCustomer }))],
  });
}

// 2026-10-30 (Amit: "the owner can't do the edit — why did nobody flag it"): an open blocker report stops paid work, like an
// open customer question. The workflow has it decided (orchestrator/blockers.ts) and runs the step again, or holds the
// build when the decision is a person's.
export async function assertNoOpenBlocker(projectId: string): Promise<void> {
  const open = openBlockers(projectId);
  if (open.length === 0) return;
  console.log(`[activity] ${open.length} blocker report(s) open — paid work stops until each is decided`);
  throw ApplicationFailure.create({
    message: `blocked: ${open.length} report(s) waiting for a decision`,
    type: "Blocked",
    nonRetryable: true,
    details: [open.map((b) => ({ agent: b.agent, owner: b.owner, what: b.what.slice(0, 300) }))],
  });
}

export function isBlockedError(err: unknown): boolean {
  return err instanceof ApplicationFailure && err.type === "Blocked";
}

/** Decides every open blocker: the owner fixes it at once, an answer is recorded, a customer question opens, or a person decides. */
export async function resolveBlockersActivity(projectId: string): Promise<{ routed: number; answered: number; customer: number; person: Array<{ agent: string; what: string; reason: string }> }> {
  const ctx = Context.current();
  const hb = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "blockers");
    await assertSameSystem(projectId, "blockers");
    const plan = getPlan(projectId);
    const { resolveBlockers } = await import("../orchestrator/blockers.ts");
    const { projectHygieneFindings } = await import("../orchestrator/stages/builder-exit-checks.ts");
    const [{ runFix: fixShubham }, { runFix: fixAanya }, { runFix: fixPranav }] = await Promise.all([
      import("../../agents/generators/shubham/src/index.ts"),
      import("../../agents/generators/aanya/src/index.ts"),
      import("../../agents/generators/pranav/src/index.ts"),
    ]);
    const r = await resolveBlockers(projectId, {
      fix: (owner, findings) => runGeneratorWithQuotaRetry(() => (owner === "shubham" ? fixShubham(plan, findings) : owner === "aanya" ? fixAanya(plan, findings) : fixPranav(plan, findings))),
      systemFindings: () => { try { return projectHygieneFindings(buildDirFor(projectId)).map((f) => `${f.file}: ${f.issue}`); } catch { return []; } },
    });
    console.log(`[activity:blockers] routed ${r.routed}, answered ${r.answered}, to the customer ${r.customer}, to a person ${r.person.length}`);
    return r;
  } finally {
    refreshAppMap(buildDirFor(projectId));
    clearInterval(hb);
  }
}

export function isCustomerQuestionError(err: unknown): boolean {
  return err instanceof ApplicationFailure && err.type === "CustomerQuestion";
}

/** The questions waiting for the customer, in the words the customer sees. */
export async function openCustomerQuestionsActivity(projectId: string): Promise<Array<{ id: string; forCustomer: string }>> {
  return openCustomerQuestions(projectId).map((q) => ({ id: q.id, forCustomer: toCustomerText(q.forCustomer) }));
}

export async function recordCustomerAnswerActivity(projectId: string, id: string, answer: string): Promise<void> {
  recordCustomerAnswer(projectId, id, answer);
}

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
import { runBuilderPhase, listBuiltFiles, builderTeamsOn, collapsePhasesForTeam, type PhaseStore, type PhaseStage } from "./build-phases.ts";
import { recordBlocked } from "../../packages/agent-runtime/src/tools/blocked.ts";
import { buildDirFor } from "../../packages/agent-runtime/src/build-dir.ts";
import { recordClaimEvidence } from "../../packages/agent-runtime/src/claims-evidence.ts";
import { verifyDir } from "../orchestrator/verify-commands.ts";
import { sandboxDefault } from "../../packages/agent-runtime/src/sandbox/container-sandbox.ts";

// ── Stage 3a–c: code generators (run in parallel from workflow) ───────────────
export async function runShubham(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "shubham");
    await assertSameSystem(projectId, "shubham");
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    const plan = getPlan(projectId);
    await verifyHandoff(projectId, "arjun", "shubham", plan);
    const result = await runGeneratorWithQuotaRetry(() => runShubhamAgent(withNormalizedDbSchema(plan)));
    if (!result.success) generatorFailure("shubham", result.errors);
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
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
    await assertSameSystem(projectId, "aanya");
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    const plan = getPlan(projectId);
    await verifyHandoff(projectId, "arjun", "aanya", plan);
    // Verified in its on-disk (hashed) shape, then normalised for the generator.
    const result = await runGeneratorWithQuotaRetry(() => runAanyaAgent(withNormalizedDbSchema(plan), "integrate"));
    if (!result.success) generatorFailure("aanya", result.errors);
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    console.log(`[activity:aanya] ${result.filesWritten.length} files → ${result.outputDir}`);
  } finally {
    clearInterval(hb);
  }
}

// ── Stage 3 (phased): one build phase at a time (Part C.3, 2 Oct 2026) ──────
// See build-phases.ts. Each builder works phase by phase in a fresh, focused
// conversation; progress is saved in <build>/phases.json so a Retry resumes
// from the phase that failed, never from the start.
const PHASES_FILE = "phases.json";

function phaseStore(projectId: string): PhaseStore {
  const read = (): Record<string, number[]> => {
    try { return readCacheFile<Record<string, number[]>>(projectId, PHASES_FILE); } catch { return {}; }
  };
  const mark = (key: string, phase: number) => {
    const done = read();
    done[key] = [...new Set([...(done[key] ?? []), phase])].sort((a, b) => a - b);
    writeCacheFile(projectId, PHASES_FILE, JSON.stringify(done, null, 2));
  };
  return {
    isDone: (builder, phase) => (read()[builder] ?? []).includes(phase),
    markDone: (builder, phase) => mark(builder, phase),
    // 2026-10-25: a team's prepare step (shared files and helpers) is saved under its own key, so a Retry resumes at the lead's step.
    isPrepared: (builder, phase) => (read()[`prepared:${builder}`] ?? []).includes(phase),
    markPrepared: (builder, phase) => mark(`prepared:${builder}`, phase),
  };
}

/** How many build phases the approved plan has (0 = no phases: the old one-shot generation). */
export async function getBuildPhaseCount(projectId: string): Promise<number> {
  const plan = getPlan(projectId) as BuildPlan & { buildPhases?: unknown[] };
  const count = Array.isArray(plan.buildPhases) ? plan.buildPhases.length : 0;
  // 2026-10-24: with builder teams the whole app is one team pass (see collapsePhasesForTeam). Decided here, once per
  // build, and recorded, so a build that already started with several phases keeps them (runPhaseFor reads the record).
  if (count > 1 && builderTeamsOn()) {
    writeCacheFile(projectId, TEAM_PASS_FILE, JSON.stringify({ phasesInPlan: count, at: new Date().toISOString() }));
    return 1;
  }
  return count;
}

const TEAM_PASS_FILE = "team-pass.json";
function isTeamPass(projectId: string): boolean {
  try {
    readCacheFile<unknown>(projectId, TEAM_PASS_FILE);
    return true;
  } catch {
    return false;
  }
}

// 2026-10-29 (team plan, stage 3): the tester writes each phase's acceptance tests right after the plan is approved, from the
// approved plan only. A retry with the same plan reuses them; a tester that cannot write them leaves a record, not an error.
export async function runAarav(projectId: string): Promise<{ tests: number; refused: number; notWritten: number; gaps: number }> {
  const ctx = Context.current();
  const hb = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "aarav");
    await assertSameSystem(projectId, "aarav");
    const dir = buildDirFor(projectId);
    const suite = await memoizeStep(dir, "aarav-tests", { prompts: testerPrompts(dir) }, () => writeAcceptanceTests(dir, { chat: defaultTesterChat }));
    saveAcceptanceTests(dir, suite);
    return { tests: suite.tests.length, refused: suite.rejected.length, notWritten: suite.notWritten.length, gaps: suite.gaps?.length ?? 0 };
  } finally {
    clearInterval(hb);
  }
}

/** The acceptance tests a builder's phase task carries ("" when none were written). */
function acceptanceTestsSection(projectId: string, phase: number, builder: "aanya" | "shubham"): string {
  const suite = readAcceptanceTests(buildDirFor(projectId));
  if (!suite?.tests.length) return "";
  return acceptanceTestsForPhase(suite.tests, isTeamPass(projectId) ? "all" : phase, builder);
}

async function runPhaseFor(projectId: string, builder: "aanya" | "shubham", phase: number, stage?: PhaseStage): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, builder);
    await assertSameSystem(projectId, builder);
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    const plan = getPlan(projectId);
    await verifyHandoff(projectId, "arjun", builder, plan);
    const schemaReady = withNormalizedDbSchema(plan);
    const normalized = isTeamPass(projectId) ? collapsePhasesForTeam(schemaReady as never) as typeof schemaReady : schemaReady;
    const outputDir = join(buildDirFor(projectId), builder === "aanya" ? "frontend" : "backend");
    await runBuilderPhase({
      projectId,
      builder,
      phase,
      plan: normalized,
      store: phaseStore(projectId),
      scaffoldNeeded: !existsSync(join(outputDir, "package.json")),
      existingFiles: listBuiltFiles(outputDir),
      ...(stage ? { stage } : {}),
      runAgent: async (phasePlan, run) => {
        const p = phasePlan as unknown as BuildPlan;
        const tests = acceptanceTestsSection(projectId, phase, builder);
        const withTests = tests ? { ...run, header: `${run.header}

${tests}` } : run;
        const result = await runGeneratorWithQuotaRetry(() =>
          builder === "aanya" ? runAanyaAgent(p, "integrate", withTests) : runShubhamAgent(p, withTests),
        );
        await assertNoOpenCustomerQuestion(projectId);
        await assertNoOpenBlocker(projectId);
        return { success: result.success, errors: result.errors, filesWritten: result.filesWritten };
      },
      reportBlocked: (what, checked) => recordBlocked(projectId, builder, { owner: "tilotma", what, checked }),
    }).catch((err) => {
      if (isCustomerQuestionError(err) || isBlockedError(err)) throw err;
      return generatorFailure(builder, [String(err instanceof Error ? err.message : err)]);
    });
  } finally {
    // 2026-10-30 (understanding plan, step 2): the app map follows every change of the code.
    refreshAppMap(buildDirFor(projectId));
    clearInterval(hb);
  }
}

export async function runAanyaPhase(projectId: string, phase: number, stage?: PhaseStage): Promise<void> {
  await runPhaseFor(projectId, "aanya", phase, stage);
}

export async function runShubhamPhase(projectId: string, phase: number): Promise<void> {
  await runPhaseFor(projectId, "shubham", phase);
}

export async function runPranav(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "pranav");
    await assertSameSystem(projectId, "pranav");
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    const plan = getPlan(projectId);
    await verifyHandoff(projectId, "arjun", "pranav", plan);
    const result = await runGeneratorWithQuotaRetry(() => runPranavAgent(withNormalizedDbSchema(plan)));
    if (!result.success) generatorFailure("pranav", result.errors);
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    console.log(`[activity:pranav] ${result.filesWritten.length} DB files written`);
  } finally {
    refreshAppMap(buildDirFor(projectId));
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

  // 2026-09-28: runs before every compile check (post-generation AND
  // post-QA), so whatever last touched the frontend, a styled Server
  // Component can't ship unstyled — see client-directive.ts.
  if (existsSync(join(frontendDir, "tsconfig.json"))) {
    const directive = ensureClientDirectiveForStyledModules(frontendDir);
    if (directive.updated.length) console.log(`[compile-check] frontend: added "use client" to ${directive.updated.join(", ")}`);
    for (const s of directive.skipped) console.warn(`[compile-check] frontend: ${s.path} calls css() but can't be a client module (${s.reason})`);
  }

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
    // Patent claim 5: with the sandbox on (NEXSIDI_SANDBOX_BUILDS=on, default on Linux) the generated code's type check runs
    // in a throwaway container: private namespaces, cgroup limits, seccomp whitelist, no network, removed when it ends.
    // Before 2026-10-22 only the Express Build path used it, so the full pipeline never ran generated code that way.
    if (sandboxDefault(process.env, process.platform) && existsSync(join(dir, "node_modules", "typescript", "bin", "tsc"))) {
      const t0 = Date.now();
      const r = await verifyDir(dir, [{ command: "node node_modules/typescript/bin/tsc --noEmit --pretty false", timeoutMs: 300_000 }], { sandbox: true });
      recordClaimEvidence(buildDir, 5, "generated code type-checked inside an isolated container", {
        part: label, ran: r.ran, ok: r.ok, seconds: Math.round((Date.now() - t0) / 1000),
        isolation: "namespaces, cgroup v2 limits (2 CPU, 2 GB, 1024 processes), seccomp whitelist, network none, removed after",
      });
      if (r.ok) console.log(`[compile-check] ${label}: clean ✓ (in the isolated container)`);
      else if (!r.ran) { timedOut = true; results.push(`${label}: the type check in the isolated container did not finish (not a compile error, rerun)`); }
      else results.push(`${label}: tsc failed in the isolated container\n${r.output.split("\n").filter((l) => l.trim()).slice(-25).join("\n")}`);
      continue;
    }
    try {
      // Invoke the local tsc entry point directly via the runtime — bypasses
      // npx + cmd.exe shell wrapping, which on Windows spawns a process tree
      // (cmd.exe -> npx.cmd -> node -> tsc) prone to hanging (an orphaned
      // grandchild holding the stdout pipe open past the parent's timeout).
      // Direct invocation is both faster and immune to that hang.
      const localTscBin = join(dir, "node_modules", "typescript", "bin", "tsc");
      const tsc = existsSync(localTscBin)
        // 2026-10-22: 60 s timed out twice while three builders shared the machine; see compile-timeout.test.ts.
        ? spawnSync(process.execPath, [localTscBin, "--noEmit", "--pretty", "false"], {
            cwd: dir, encoding: "utf-8", timeout: 180_000,
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
  const logsDir = join(buildDirFor(projectId, buildDir), "logs");
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

// 2026-08-13 (cost-control Task 1, HIGH finding closed): runCodeFix invokes
// the same generators (runShubhamFix/runAanyaFix, via runSelectedRepairs)
// that ARE gated at their normal entry points (runShubham/runAanya above
// both call assertWithinBudget first) — but this activity had no check of
// its own, despite being called in a loop from BOTH the pre-QA compile gate
// (up to 3x) and the post-QA compile gate (up to 3x) in
// pipeline/workflows/project-build.ts. Real, repeated, previously-uncapped
// spend. Gated first, before any repair work, matching the exact pattern
// used by runShubham/runAanya/runPranav/runQAFixLoopActivity above.
export async function runCodeFix(projectId: string, iteration: number, reason: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  console.log(`[activity:code-fix] iter=${iteration} reason=${reason}`);

  try {
    // Checked first, before even publishing the self-heal UI event below —
    // an over-budget project shouldn't show an amber "Fixing..." card for
    // repair work that's about to be halted before it starts.
    await assertWithinBudget(projectId, "code-fix");

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

// 2026-08-26: real gap found live — reason was always console.error'd only,
// never persisted; a project sitting at "needs_review" was indistinguishable
// from a healthy in-progress build to anything reading the DB row, and the
// actual reason (spec_rejected_too_many_times, stuck_state, budget_exceeded,
// ...) required grepping worker logs to recover. failureReason makes it a
// real, queryable field the frontend can show directly.
export type ProjectStatusWriter = (projectId: string, status: "failed" | "needs_review", failureReason: string) => Promise<void>;

const writeProjectStatus: ProjectStatusWriter = async (projectId, status, failureReason) => {
  await db
    .update(projects)
    .set({ status, failureReason, updatedAt: new Date() })
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
  await writeStatus(projectId, "needs_review", reason);
}

export async function markProjectFailed(
  projectId: string,
  reason: string,
  writeStatus: ProjectStatusWriter = writeProjectStatus,
): Promise<void> {
  console.error(`[activity:project-failed] project=${projectId} reason=${reason}`);
  await writeStatus(projectId, "failed", reason);
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
  // .nexsidi is the chain's own folder (handoff files and snapshots written AFTER a handoff is recorded); counting it
  // would make a healthy project look changed between record and verify.
  const EXCLUDE = /(^|\/)(node_modules|\.next|dist|\.git|\.nexsidi)(\/|$)|\.tsbuildinfo$|(^|\/)(package-lock\.json|bun\.lock|bun\.lockb|yarn\.lock|pnpm-lock\.yaml)$/;
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

// 2026-10-30 (team plan, stage 4): the build closes only when its acceptance tests pass on the running app
// (orchestrator/acceptance-gate.ts). Every round is a paid step, so the budget, the system version and open customer
// questions are checked before each one, as at every other paid step.
export async function runAcceptanceGateActivity(projectId: string): Promise<{ status: string; reason?: string; rounds: number; passed?: number; failed?: number; withdrawn: string[] }> {
  const ctx = Context.current();
  const hb = setInterval(() => ctx.heartbeat("running"), 30_000);
  await assertWithinBudget(projectId, "acceptance-gate");
  await assertSameSystem(projectId, "acceptance-gate");
  await assertNoOpenCustomerQuestion(projectId);
  await assertNoOpenBlocker(projectId);
  refreshAppMap(buildDirFor(projectId));
  const { deps, cleanup } = realGateDeps(projectId, getPlan(projectId));
  try {
    const r = await runAcceptanceGate(buildDirFor(projectId), {
      ...deps,
      beforeRound: async () => {
        await assertWithinBudget(projectId, "acceptance-gate");
        await assertSameSystem(projectId, "acceptance-gate");
        await assertNoOpenCustomerQuestion(projectId);
        await assertNoOpenBlocker(projectId);
      },
    });
    console.log(`[activity:acceptance] ${r.status}${r.reason ? ` — ${r.reason}` : ""}`);
    if (r.status === "waiting_for_customer") { await assertNoOpenCustomerQuestion(projectId); await assertNoOpenBlocker(projectId); }
    return { status: r.status, ...(r.reason ? { reason: r.reason } : {}), rounds: r.rounds, passed: r.last?.passed, failed: r.last?.failed, withdrawn: r.withdrawn };
  } finally {
    await cleanup().catch((err) => console.warn(`[activity:acceptance] cleanup failed: ${String(err).slice(0, 200)}`));
    clearInterval(hb);
  }
}

export async function runQAFixLoopActivity(projectId: string): Promise<QAFixLoopActivityResult> {
  const ctx = Context.current();
  const hb = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "qa-gan");
    await assertSameSystem(projectId, "qa-gan");
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    const plan = getPlan(projectId);
    const stage4Result = buildStage4Result(projectId);
    refreshAppMap(buildDirFor(projectId));
    const result = await runQAFixLoop(projectId, plan, stage4Result);
    refreshAppMap(buildDirFor(projectId));
    // 2026-10-23: the cap is checked again after the rounds, so a step that reached it stops as a budget stop, not a pass.
    await assertWithinBudget(projectId, "qa-gan (after the rounds)");
    await assertSameSystem(projectId, "qa-gan (after the rounds)");
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    console.log(
      `[activity:qa-fix-loop] pass=${result.pass} stuck=${result.stuck ?? false} iterations=${result.iterations} findings=${result.findings.length}`,
    );
    recordClaimEvidence(buildDirFor(projectId), 6, "review-and-fix loop ended", {
      passed: result.pass, stuck: result.stuck ?? false, iterations: result.iterations, openFindings: result.findings.length, held: !!result.hold,
    });
    if (result.hold) throw guardHoldFailure(result.hold);
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
  // Claims 1 and 3: the handoff carries the code map (structure, dependency graph, rules, error records), not just file names.
  // getPlan throws if the plan is missing, on purpose: recording with no rules and checking with rules would disagree.
  await recordHandoff(projectId, "qa-gan", "deploy", buildHandoffContext(buildDirFor(projectId), filterSourceManifest(stage4Result), getPlan(projectId)));
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

// 2026-08-13 (cost-control Task 1): flagged by review as a lower-confidence
// but genuinely in-scope gap, decided in favor of gating after reading
// runStage6 (stage6-deployment.ts) — it is NOT pure browser automation. It
// dynamically imports and runs runStage5 (the full Navya/Karan/Deepika/
// Tier-3 GAN re-run against the live URL), runLiveEval (Tilotma's
// live-browser LLM eval), and runFix on Shubham/Aanya/Pranav for live-check
// repair — all real LLM spend, retried up to MAX_DEPLOY_ATTEMPTS (2) times
// per deploy attempt, itself retried by the workflow's Stage 6 loop on a
// human retry decision. Same pattern as every other gated activity.
export async function runDeployWithLiveRetest(projectId: string): Promise<DeployActivityResult> {
  const ctx = Context.current();
  const hb = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    await assertWithinBudget(projectId, "deploy");
    await assertSameSystem(projectId, "deploy");
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    const plan = getPlan(projectId);
    const stage4Result = buildStage4Result(projectId);
    // Patent Claim 3: verify the codebase QA just approved is exactly what
    // deploy is about to ship — before it's shipped.
    await verifyHandoff(projectId, "qa-gan", "deploy", buildHandoffContext(buildDirFor(projectId), filterSourceManifest(stage4Result), plan));
    refreshAppMap(buildDirFor(projectId));
    const result = await runStage6(projectId, stage4Result, plan);
    await assertWithinBudget(projectId, "deploy (after the live rounds)");
    await assertSameSystem(projectId, "deploy (after the live rounds)");
    await assertNoOpenCustomerQuestion(projectId);
    await assertNoOpenBlocker(projectId);
    console.log(`[activity:deploy] success=${result.success} appUrl=${result.appUrl} stuck=${result.stuck ?? false}`);
    recordClaimEvidence(buildDirFor(projectId), 2, result.success ? "deployed after the live checks passed" : "deploy attempt did not pass the live checks", {
      success: result.success, appUrl: result.appUrl, stuck: result.stuck ?? false,
    });
    if (result.hold) throw guardHoldFailure(result.hold);
    return { success: result.success, appUrl: result.appUrl, stuck: result.stuck ?? false };
  } finally {
    clearInterval(hb);
  }
}

// ── Post-delivery change requests (Workstream 3) ───────────────────────────
// Root cause: once a project reached "done" there was no way back in — no
// composer, no request-changes route. This is the targeted-regeneration half
// of that fix: apply a user's free-text change request to the ALREADY
// GENERATED codebase (never re-run Saanvi/Arjun/full generation — the plan
// explicitly calls for targeted regeneration, not a full rebuild), reusing
// runFix — the exact same fix-dispatch mechanism Stage 5's QA loop already
// uses, just fed a user request instead of a QA finding.
export interface ChangeRequestResult {
  filesChanged: string[];
  errors: string[];
}

export async function applyChangeRequestActivity(projectId: string, changeText: string): Promise<ChangeRequestResult> {
  const plan = getPlan(projectId);
  // buildFixTask's surrounding scaffold (both agents) frames its findings
  // list as "an adversarial QA review found the following issues" — wrong
  // framing for a deliberate feature/change request, so the finding text
  // itself corrects the record up front. Dispatched to BOTH Aanya and
  // Shubham unconditionally (no triage step exists to know which domain a
  // free-text request actually touches) — real cost for a request that only
  // needed one of them, accepted for this MVP rather than adding a
  // classifier call; Pranav (schema) is deliberately excluded, since a
  // blind schema migration from unclassified free text is a materially
  // higher-risk mistake than an unnecessary no-op generator call.
  const finding = `[user-requested change] The user asked for the following change to the already-delivered app — implement it; this is not a bug report: ${changeText}`;
  const [shubhamResult, aanyaResult] = await Promise.all([
    runShubhamFix(plan, [finding]),
    runAanyaFix(plan, [finding]),
  ]);
  return {
    filesChanged: [...shubhamResult.filesWritten, ...aanyaResult.filesWritten],
    errors: [...shubhamResult.errors, ...aanyaResult.errors],
  };
}

// Nothing in the existing pipeline ever wrote projects.status="done" or
// projects.appUrl to the DB (confirmed live, repo-wide search this session —
// the one prior "done" HITS the frontend's own SSE-driven client state, per
// apps/web/app/build/[id]/page.tsx's `type: "complete"` handler, never a DB
// column) — a real, separate, pre-existing gap. This activity is the first
// place that actually persists it, needed for THIS flow's completion to be
// durably queryable rather than living only in the (now-terminated) original
// workflow's in-memory state.
export async function markProjectDone(projectId: string, appUrl: string): Promise<void> {
  await db
    .update(projects)
    .set({ status: "done", appUrl, failureReason: null, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function getPlan(projectId: string): BuildPlan {
  return planCache.get(projectId) ?? readCacheFile<BuildPlan>(projectId, "build-plan.json");
}

function readUserRequest(projectId: string): string {
  const p = join(buildDirFor(projectId), "user-request.txt");
  return existsSync(p) ? readFileSync(p, "utf-8").trim() : `Project ${projectId}`;
}

function writeCacheFile(projectId: string, filename: string, content: string): void {
  const dir = buildDirFor(projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, "utf-8");
}

function readCacheFile<T>(projectId: string, filename: string): T {
  const p = join(buildDirFor(projectId), filename);
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
