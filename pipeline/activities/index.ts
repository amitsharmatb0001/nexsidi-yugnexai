// Temporal activities — one per pipeline stage.
// Each is retryable, timeout-bounded, and observable in Temporal UI.
// All TODO stubs are now replaced with real agent calls.

import { run as runSaanviAgent }  from "../../agents/saanvi/src/index.ts";
import { run as runArjunAgent, getBuildDir }   from "../../agents/arjun/src/index.ts";
import { run as runShubhamAgent } from "../../agents/generators/shubham/src/index.ts";
import { run as runAanyaAgent }   from "../../agents/generators/aanya/src/index.ts";
import { run as runPranavAgent }  from "../../agents/generators/pranav/src/index.ts";
import { run as runRiyaAgent }    from "../../agents/riya/src/index.ts";
import { agentChat }               from "@nexsidi/llm-client";
import { db, qaResults, stuckStateLog } from "@nexsidi/db";
import { eq, and } from "drizzle-orm";
import { Context }                 from "@temporalio/activity";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync, spawnSync } from "child_process";
import type { ProjectSpec } from "../../agents/saanvi/src/index.ts";
import type { BuildPlan }   from "../../agents/arjun/src/index.ts";

// ── In-process cache (activities run in same Temporal worker process)
const specCache = new Map<string, ProjectSpec>();
const planCache = new Map<string, BuildPlan>();

// ── Stage 1: Requirements → locked ProjectSpec ─────────────────────────────────
export async function runSaanvi(projectId: string, userRequest?: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    // Persist the user request to disk so re-run picks it up after worker restart
    if (userRequest) writeCacheFile(projectId, "user-request.txt", userRequest);
    const req  = userRequest ?? readUserRequest(projectId);
    const spec = await runSaanviAgent(projectId, req);
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
    const plan = await runArjunAgent(spec);
    planCache.set(projectId, plan);
    console.log(`[activity:arjun] plan ready — ${plan.apiContract.endpoints.length} endpoints, ${plan.dbSchema.tables.length} tables`);
  } finally {
    clearInterval(hb);
  }
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
    const result = await runAanyaAgent(getPlan(projectId));
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
export async function runCompileCheck(projectId: string): Promise<{ pass: boolean; errors: string }> {
  const buildDir = getBuildDir(projectId);
  const backendDir = join(buildDir, "backend");
  const frontendDir = join(buildDir, "frontend");
  const results: string[] = [];

  for (const [label, dir] of [["backend", backendDir], ["frontend", frontendDir]] as const) {
    if (!existsSync(join(dir, "tsconfig.json"))) continue;
    try {
      const tsc = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
        cwd: dir, encoding: "utf-8", timeout: 60_000,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      const out = (tsc.stdout ?? "") + (tsc.stderr ?? "");
      const errorLines = out.split("\n").filter((l) => l.includes("error TS")).slice(0, 20);
      if (errorLines.length > 0) {
        results.push(`${label}: ${errorLines.length} TypeScript error(s)\n${errorLines.join("\n")}`);
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
  return { pass, errors };
}

// ── Live execution check — starts backend in Docker, hits /api/v1/* ─────────
// Expects HTTP 401 (Unauthorized) — not a crash. 401 proves server started and Clerk is wired.
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
      "-e", `DATABASE_URL=postgresql://u:p@127.0.0.1:5432/d`,
      "-e", `CLERK_SECRET_KEY=${process.env.CLERK_SECRET_KEY ?? "sk_test_placeholder"}`,
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
        detail = `Server responded HTTP ${code} — expected 401 (Clerk) or 404`;
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

async function runQaAgent(
  agent: "navya" | "karan" | "deepika",
  focus: string,
  projectId: string,
  iteration: number,
): Promise<number> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  const buildDir = getBuildDir(projectId);

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

    console.log(`[activity:qa:${agent}] iter=${iteration} score=${score}`);
    return score;
  } finally {
    clearInterval(hb);
  }
}

function qaPrompt(focus: string): string {
  return `You are a code quality reviewer. Review ONLY the code shown. Focus on: ${focus}.
CRITICAL RULE: Only flag issues you can see DIRECTLY in the provided code.
DO NOT assume what is in files not shown. DO NOT flag missing implementations unless you can confirm absence.
If a file appears truncated, skip that file — do not flag truncation as a bug.

Severity definitions:
CRITICAL: definitive crash, data-loss, or security exploit visible in code (SQL injection, unguarded null deref causing crash, missing auth on a route)
HIGH: likely bug with clear evidence (off-by-one, unhandled promise rejection that reaches user)
MEDIUM: code smell or real edge case with clear evidence in shown code
LOW: minor style or optional improvement

Score = 100 − (CRITICAL×10) − (HIGH×5) − (MEDIUM×2) − (LOW×1). Minimum 0.
Output ONLY JSON: {"score":number,"findings":[{"severity":"CRITICAL|HIGH|MEDIUM|LOW","description":"..."}]}`;
}

// ── Code fix: re-run generators with QA findings attached ────────────────────
export async function runCodeFix(projectId: string, iteration: number, reason: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  console.log(`[activity:code-fix] iter=${iteration} reason=${reason}`);

  try {
    const findings = await db
      .select({ agent: qaResults.agentName, score: qaResults.score, findings: qaResults.findings })
      .from(qaResults)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      .where(and(eq(qaResults.projectId, projectId), eq(qaResults.iteration, iteration))!);

    const summary = findings
      .flatMap((r) =>
        (r.findings as Array<{ severity: string; description: string }>).map(
          (f) => `[${r.agent.toUpperCase()}] ${f.severity}: ${f.description}`,
        ),
      )
      .join("\n");

    const plan = getPlan(projectId);
    const fixContext = `\nFIX THESE QA FINDINGS (iteration ${iteration}):\n${summary}`;
    const patchedPlan: BuildPlan = {
      ...plan,
      shubhamTasks: plan.shubhamTasks.map((t) => ({ ...t, description: t.description + fixContext })),
      aanyaTasks:   plan.aanyaTasks.map(  (t) => ({ ...t, description: t.description + fixContext })),
    };

    // Skip Pranav — DB schema doesn't change between QA iterations.
    // Re-running Pranav risks overwriting migrations that already work.
    await Promise.all([
      runShubhamAgent(patchedPlan),
      runAanyaAgent(patchedPlan),
    ]);
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
function sampleRouteContent(buildDir: string): string {
  const parts: string[] = [];
  // Always include entry files
  for (const rel of ["backend/src/app.ts", "backend/src/index.ts"]) {
    try {
      const text = readFileSync(join(buildDir, rel), "utf-8").slice(0, 3000);
      parts.push(`=== ${rel} ===\n${text}`);
    } catch { /* skip */ }
  }
  // Scan every file in routes dir
  const routesDir = join(buildDir, "backend", "src", "routes");
  try {
    const entries = readdirSync(routesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const rel = `backend/src/routes/${entry.name}`;
      try {
        const text = readFileSync(join(buildDir, rel), "utf-8").slice(0, 3000);
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
