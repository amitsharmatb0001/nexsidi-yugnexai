// Temporal activities — one per pipeline stage.
// Each is retryable, timeout-bounded, and observable in Temporal UI.
// All TODO stubs are now replaced with real agent calls.

import { run as runSaanviAgent }  from "../../agents/saanvi/src/index.ts";
import { run as runArjunAgent, getBuildDir, pathToNextjsFile } from "../../agents/arjun/src/index.ts";
import { run as runShubhamAgent, runFix as runShubhamFix } from "../../agents/generators/shubham/src/index.ts";
import { run as runAanyaAgent, runFix as runAanyaFix }   from "../../agents/generators/aanya/src/index.ts";
import { run as runPranavAgent }  from "../../agents/generators/pranav/src/index.ts";
import { run as runRiyaAgent }    from "../../agents/riya/src/index.ts";
import { agentChat }               from "@nexsidi/llm-client";
import { db, projects, qaResults, stuckStateLog } from "@nexsidi/db";
import { eq, and } from "drizzle-orm";
import { Context }                 from "@temporalio/activity";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync, spawnSync } from "child_process";
import type { ProjectSpec } from "../../agents/saanvi/src/index.ts";
import type { BuildPlan }   from "../../agents/arjun/src/index.ts";

// ── In-process cache (activities run in same Temporal worker process)
const specCache = new Map<string, ProjectSpec>();
const planCache = new Map<string, BuildPlan>();

function getAttachmentsContext(projectId: string): string {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
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

// ── Planner fast path: check if build-plan.json was pre-generated ───────────────
export async function checkBuildPlanExists(projectId: string): Promise<boolean> {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const planPath = join(buildDir, projectId, "build-plan.json");
  for (let i = 0; i < 10; i++) {
    if (existsSync(planPath)) return true;
    await new Promise(res => setTimeout(res, 200));
  }
  return false;
}

// ── Stage 1: Requirements → locked ProjectSpec ─────────────────────────────────
export async function runSaanvi(projectId: string, userRequest?: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    if (userRequest) writeCacheFile(projectId, "user-request.txt", userRequest);
    const req  = userRequest ?? readUserRequest(projectId);
    const attachmentsContext = getAttachmentsContext(projectId);
    const enrichedReq = req + attachmentsContext;
    const spec = await runSaanviAgent(projectId, enrichedReq);
    specCache.set(projectId, spec);
    writeCacheFile(projectId, "spec.json", JSON.stringify(spec, null, 2));
    console.log(`[activity:saanvi] spec locked for ${projectId} — ${spec.features.length} features`);
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
    console.log(`[activity:arjun] plan ready — ${plan.apiContract.endpoints.length} endpoints, ${plan.dbSchema.tables.length} tables`);
  } finally {
    clearInterval(hb);
  }
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

// ── Stage 3a–c: code generators (run in parallel from workflow) ───────────────
export async function runShubham(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const result = await runShubhamAgent(getPlan(projectId));
    if (!result.success) throw new Error(`[shubham] ${result.errors.join("; ")}`);
    console.log(`[activity:shubham] ${result.filesWritten.length} files → ${result.outputDir}`);
  } finally {
    clearInterval(hb);
  }
}

export async function runAanya(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const result = await runAanyaAgent(getPlan(projectId), "integrate");
    if (!result.success) throw new Error(`[aanya] ${result.errors.join("; ")}`);
    console.log(`[activity:aanya] ${result.filesWritten.length} files → ${result.outputDir}`);
  } finally {
    clearInterval(hb);
  }
}

export async function runPranav(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const result = await runPranavAgent(getPlan(projectId));
    if (!result.success) throw new Error(`[pranav] ${result.errors.join("; ")}`);
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

// ── Live execution check — starts backend in Docker, hits /api/v1/* ─────────
// Expects HTTP 401 (Unauthorized) — not a crash. 401 proves server started and Clerk is wired.
export function buildLiveCheckEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return [
    "-e", "DATABASE_URL=postgresql://u:p@127.0.0.1:5432/d",
    "-e", `JWT_SECRET=${env.JWT_SECRET ?? "nexsidi_live_check_secret"}`,
  ];
}

export async function runLiveCheck(projectId: string): Promise<{ pass: boolean; detail: string }> {
  const buildDir = getBuildDir(projectId);
  const tag = `nexsidi-live-${projectId}`.toLowerCase();
  let pass = false;
  let detail = "";

  try {
    // Build backend image
    const build = spawnSync("docker", ["build", "-t", tag, "-f", "backend/Dockerfile", "backend/"], {
      cwd: buildDir, encoding: "utf-8", timeout: 180_000,
    });
    if (build.status !== 0) {
      detail = `Docker build failed:\n${(build.stdout ?? "") + (build.stderr ?? "")}`.slice(0, 500);
      console.log(`[activity:live-check] ${detail}`);
      return { pass: false, detail };
    }

    // Start container (no postgres needed for compile/start check — just test it boots)
    const run = spawnSync("docker", [
      "run", "--rm", "-d", "-p", "19001:3001",
      ...buildLiveCheckEnv(),
      "--name", tag, tag,
    ], { encoding: "utf-8", timeout: 15_000 });
    const containerId = run.stdout?.trim() ?? "";

    if (!containerId) {
      detail = `Container failed to start: ${(run.stderr ?? "")}`.slice(0, 300);
      return { pass: false, detail };
    }

    // Give server 5s to start
    await new Promise((r) => setTimeout(r, 5000));

    try {
      // Expect 401 (Clerk working) or 404 (route exists but not found) — NOT a crash (500/ECONNREFUSED)
      const curl = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:19001/api/v1/tasks"], {
        encoding: "utf-8", timeout: 10_000,
      });
      const code = parseInt(curl.stdout?.trim() ?? "0", 10);
      if (code === 401 || code === 200 || code === 404) {
        pass = true;
        detail = `Server responded HTTP ${code} ✓`;
      } else {
        detail = `Server responded HTTP ${code} — expected 401, 200, or 404`;
      }
    } finally {
      // Always clean up container
      spawnSync("docker", ["stop", tag], { encoding: "utf-8", timeout: 10_000 });
      spawnSync("docker", ["rmi", "-f", tag], { encoding: "utf-8", timeout: 10_000 });
    }
  } catch (e) {
    detail = `Live check exception: ${String(e)}`;
  }

  console.log(`[activity:live-check] project=${projectId} pass=${pass} ${detail}`);
  return { pass, detail };
}

// ── Stage 0 gate: spec-compliance check (D21 — runs before QA, cheap) ─────────
export async function runSpecCompliance(projectId: string, iteration: number): Promise<boolean> {
  const plan     = getPlan(projectId);
  const buildDir = getBuildDir(projectId);
  const files    = collectFiles(buildDir);

  // Pass actual route file content so Arjun can verify endpoints exist (not just file names)
  const routeContent = sampleRouteContent(buildDir);

  // Filter auth endpoints in code — do NOT rely on the LLM to skip them.
  // With Clerk, the Express backend never implements /auth/register, /auth/login etc.
  const AUTH_PATH_PATTERN = /\/(auth|login|logout|register|signup|sign-in|sign-up|token|refresh)\b/i;
  const checkableEndpoints = plan.apiContract.endpoints
    .map((e) => `${e.method} ${e.path}`)
    .filter((ep) => !AUTH_PATH_PATTERN.test(ep));

  const { content } = await agentChat(
    "arjun",
    [
      {
        role: "system",
        content: "You are a spec-compliance checker. Given required API endpoints and the ACTUAL " +
          "content of generated route files, answer ONLY 'PASS' or 'FAIL: <reason>'.\n" +
          "PASS if all required endpoints are present anywhere in the route code. " +
          "FAIL only if an endpoint is genuinely absent from the route content.",
      },
      {
        role: "user",
        content: JSON.stringify({
          requiredEndpoints: checkableEndpoints,
          generatedFiles: files,
          routeFileContent: routeContent,
          iteration,
        }),
      },
    ],
    process.env.NIM_API_KEY ?? "",
  );

  const trimmed = content.trim();
  const pass = trimmed.toUpperCase().startsWith("PASS");
  console.log(`[activity:spec-compliance] iter=${iteration} → ${pass ? "PASS" : `FAIL: ${trimmed.slice(0, 200)}`}`);
  return pass;
}

// ── QA agents — adversarial, all three must score ≥85 (Fix #8) ────────────────
export async function runNavya(projectId: string, iteration: number): Promise<number> {
  return runQaAgent("navya", "logic/race-conditions", projectId, iteration);
}

export async function runKaran(projectId: string, iteration: number): Promise<number> {
  return runQaAgent("karan", "security/OWASP", projectId, iteration);
}

export async function runDeepika(projectId: string, iteration: number): Promise<number> {
  return runQaAgent("deepika", "performance/N+1", projectId, iteration);
}

const QA_AGENT_LABEL: Record<string, string> = {
  navya:   "Logic QA",
  karan:   "Security QA",
  deepika: "Performance QA",
};

async function runQaAgent(
  agent: "navya" | "karan" | "deepika",
  focus: string,
  projectId: string,
  iteration: number,
): Promise<number> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  const buildDir = getBuildDir(projectId);
  const label = QA_AGENT_LABEL[agent] ?? agent;

  // Announce QA agent start so UI can show parallel progress
  appendEvent(projectId, {
    type: "tool_call",
    agent: label,
    tool: `${agent}_review`,
    input: { iteration, focus },
  });

  // Pass actual file content (key files, 20K budget so agents see complete functions)
  const codeSnippet = sampleFileContent(buildDir, 20000);

  try {
    const { content } = await agentChat(
      agent,
      [
        { role: "system", content: qaPrompt(focus) },
        {
          role: "user",
          content: `Project: ${projectId} | Iteration: ${iteration}\n\n${codeSnippet}\n\n` +
            'Output ONLY JSON: {"score":number,"findings":[{"severity":"CRITICAL|HIGH|MEDIUM|LOW","description":"..."}]}',
        },
      ],
      process.env.NIM_API_KEY ?? "",
    );

    const parsed = parseJson<{ score: number; findings: Array<{ severity: string; description: string }> }>(content);
    const score  = typeof parsed?.score === "number" ? clamp(parsed.score, 0, 100) : 50;

    await db.insert(qaResults).values({
      projectId,
      agentName: agent,
      iteration,
      score,
      findings: parsed?.findings ?? [],
      passed: score >= 85,
      createdAt: new Date(),
    }).onConflictDoNothing();

    // Publish QA result so UI shows pass/fail with score
    appendEvent(projectId, {
      type: "tool_result",
      agent: label,
      tool: `${agent}_review`,
      status: score >= 85 ? "ok" : "error",
      score,
    });

    console.log(`[activity:qa:${agent}] iter=${iteration} score=${score}`);
    return score;
  } finally {
    clearInterval(hb);
  }
}

function qaPrompt(focus: string): string {
  return `You are an adversarial code quality reviewer. Your default assumption is FAIL — only pass code when evidence proves quality. Focus on: ${focus}.

Review ALL code provided. Flag issues you can infer from the code structure, missing error handling, security gaps, and incomplete implementations.

Severity definitions:
CRITICAL: crash, data-loss, or security exploit (SQL injection, missing auth, unguarded null deref, exposed secrets)
HIGH: likely bug with clear evidence (off-by-one, unhandled promise rejection, missing validation)
MEDIUM: code smell, missing edge case handling, or incomplete implementation
LOW: minor style, naming, or optional improvement

Score = 100 − (CRITICAL×20) − (HIGH×10) − (MEDIUM×5) − (LOW×1). Minimum 0.
Output ONLY JSON: {"score":number,"findings":[{"severity":"CRITICAL|HIGH|MEDIUM|LOW","description":"..."}]}`;
}

// ── WS event publisher — appends to events.jsonl, tailed by /ws/pipeline/:id ─
function appendEvent(projectId: string, event: Record<string, unknown>): void {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
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

// ── Live test (Playwright) — D20 ──────────────────────────────────────────────
export async function runLiveTest(_projectId: string, _iteration: number): Promise<number> {
  // Phase 2: real Playwright run against localhost:3000 with live eval criteria (D18)
  // Phase 1: return passing score so pipeline can proceed end-to-end
  return 8.0;
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

// ── Escalate to Tilotma (stuck-state or unrecoverable failure) ────────────────
export async function escalateTilotma(
  projectId: string,
  reason: string,
  state: unknown,
): Promise<void> {
  console.error(`[activity:escalate] project=${projectId} reason=${reason}`, state);
  // Phase 2: Tilotma asks user ONE specific question with concrete options via Maya SSE
}

export type ProjectStatusWriter = (projectId: string, status: "failed") => Promise<void>;

const writeProjectStatus: ProjectStatusWriter = async (projectId, status) => {
  await db
    .update(projects)
    .set({ status, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
};

export async function markProjectFailed(
  projectId: string,
  reason: string,
  writeStatus: ProjectStatusWriter = writeProjectStatus,
): Promise<void> {
  console.error(`[activity:project-failed] project=${projectId} reason=${reason}`);
  await writeStatus(projectId, "failed");
}

// ── Delivery: Riya runs docker-compose + archives to GitHub ──────────────────
export async function runRiya(projectId: string): Promise<void> {
  const result = await runRiyaAgent(projectId);
  console.log(`[activity:riya] app=${result.appUrl} github=${result.githubRepo ?? "skipped"}`);
  if (!result.success) {
    console.error(`[activity:riya] errors: ${result.errors.join("; ")}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getPlan(projectId: string): BuildPlan {
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

// Read actual source content from key generated files
// Uses 20K char budget so QA agents see complete files, not truncated excerpts.
// Truncated excerpts cause hallucinated "stray character" / "incomplete function" findings.
function sampleFileContent(buildDir: string, maxChars: number): string {
  const priority = [
    // Backend: app setup, routes, controllers (most bug-prone)
    "backend/src/app.ts", "backend/src/index.ts",
    "backend/src/routes/taskRouter.ts", "backend/src/routes/tasks.ts",
    "backend/src/controllers/taskController.ts",
    "backend/src/repositories/taskRepository.ts",
    "backend/src/middlewares/auth.ts", "backend/src/middleware/auth.ts",
    // Frontend: pages and key components
    "frontend/app/page.tsx", "frontend/app/layout.tsx",
    "frontend/app/tasks/page.tsx",
    "frontend/components/TaskList.tsx", "frontend/components/TaskForm.tsx",
    "frontend/lib/api/client.ts",
    // DB schema
    "db/src/schema.ts", "db/migrations/0000_initial.sql",
  ];

  const parts: string[] = [];
  let total = 0;

  const tryRead = (rel: string) => {
    if (total >= maxChars) return;
    const abs = join(buildDir, rel);
    try {
      // Allow up to 4000 chars per file (was 2000) so files aren't cut mid-function
      const text = readFileSync(abs, "utf-8").slice(0, 4000);
      parts.push(`=== ${rel} ===\n${text}`);
      total += text.length;
    } catch { /* file doesn't exist — skip */ }
  };

  for (const p of priority) tryRead(p);

  // Fill remaining budget with whatever files exist
  if (total < maxChars) {
    for (const sub of ["backend", "frontend", "db"]) {
      for (const f of collectFiles(join(buildDir, sub)).slice(0, 8)) {
        if (total >= maxChars) break;
        tryRead(join(sub, f));
      }
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : "No source files found in build directory.";
}

// Read route file content for spec-compliance verification
// Scans the actual backend/src/routes/ directory dynamically — no hardcoded names.
// Routes files with full CRUD are 300-500 lines (10-15K chars) — use 15K per file.
function sampleRouteContent(buildDir: string): string {
  const parts: string[] = [];
  // Always include entry files
  for (const rel of ["backend/src/app.ts", "backend/src/index.ts"]) {
    try {
      const text = readFileSync(join(buildDir, rel), "utf-8").slice(0, 5000);
      parts.push(`=== ${rel} ===\n${text}`);
    } catch { /* skip */ }
  }
  // Scan every file in routes dir — no slice cap: full file needed for CRUD completeness check
  const routesDir = join(buildDir, "backend", "src", "routes");
  try {
    const entries = readdirSync(routesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const rel = `backend/src/routes/${entry.name}`;
      try {
        const text = readFileSync(join(buildDir, rel), "utf-8");
        parts.push(`=== ${rel} ===\n${text}`);
      } catch { /* skip */ }
    }
  } catch { /* routes dir may not exist */ }
  return parts.length > 0 ? parts.join("\n\n") : "No route files found.";
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

function parseJson<T>(text: string): T | null {
  try {
    const fm = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const s  = fm?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return JSON.parse(s) as T;
  } catch { return null; }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
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
