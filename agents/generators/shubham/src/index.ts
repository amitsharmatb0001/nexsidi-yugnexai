// Shubham — Express backend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run tsc → fix → repeat.
// No longer does one-shot LLM generation. Agent ACTS on real tool feedback.

import { resolveGeneratorRunner, type Escalation } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "fs";
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

// Scan src/routes/ for *.routes.ts files and generate src/routes/index.ts that
// imports and mounts each one at "/<resource>" (e.g. tasks.routes.ts, whose
// handlers use relative paths "/" and "/:id", mounts at "/tasks" so the full
// path under the app's "/api/v1" prefix is /api/v1/tasks). Deterministic and
// fail-safe. Exported for unit testing. If there are no route files, the empty
// placeholder is left as-is.
export function autoWireRoutes(backendDir: string): void {
  const routesDir = join(backendDir, "src", "routes");
  try {
    if (!existsSync(routesDir)) return;
    const routeFiles = readdirSync(routesDir)
      .filter((f) => f.endsWith(".routes.ts"))
      .sort();
    if (routeFiles.length === 0) return;

    const importLines: string[] = ['import { Router } from "express";'];
    const mountLines: string[] = ["", "const router = Router();", ""];
    for (const file of routeFiles) {
      const resource = file.replace(/\.routes\.ts$/, "");          // "tasks"
      const ident = resource.replace(/[^a-zA-Z0-9]/g, "_") + "Router"; // "tasksRouter"
      importLines.push(`import ${ident} from "./${resource}.routes";`);
      mountLines.push(`router.use("/${resource}", ${ident});`);
    }
    mountLines.push("", "export default router;", "");
    const content = importLines.join("\n") + "\n" + mountLines.join("\n");
    writeFileSync(join(routesDir, "index.ts"), content, "utf-8");
    console.log(`[shubham] auto-wired ${routeFiles.length} route file(s) into routes/index.ts: ${routeFiles.join(", ")}`);
  } catch (err) {
    console.warn(`[shubham] autoWireRoutes skipped: ${String(err)}`);
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
    systemPrompt: knownMistakesPrefix + SHUBHAM_AGENT_SYSTEM_PROMPT,
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
    maxIterations: 60,
  });

  // Deterministically mount the *.routes.ts files into routes/index.ts (see
  // autoWireRoutes) — a placeholder was left there and the never-implemented
  // auto-wiring meant every generated API was dead. Runs after the agent has
  // written its route files.
  autoWireRoutes(outputDir);

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
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
    systemPrompt: knownMistakesPrefix + SHUBHAM_AGENT_SYSTEM_PROMPT,
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
  autoWireRoutes(outputDir);

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    errors: result.errors,
    escalations: result.escalations,
  };
}

// ── Agent system prompt — agentic mode ───────────────────────────────────────
export const SHUBHAM_AGENT_SYSTEM_PROMPT = `\
You are Shubham, a senior Express + TypeScript backend engineer.
You have been given tools to write files and run commands directly.
You DO NOT output text — you USE TOOLS to create the project.

PLAN-THEN-EXECUTE — this is the most important rule in this prompt:
Your task message lists the COMPLETE, exhaustive file manifest Arjun already
planned. Do not discover the shape of the backend one file at a time by
writing something and immediately type-checking it — you already have the
whole plan. Write EVERY planned file, batching SEVERAL write_file calls in
the SAME response (aim for 3-4 files per turn) before you ever run a
verification command. Type-checking after each individual file is the exact
waste this workflow exists to remove — a real measured run burned 30-60
tsc/build calls doing this. One exception: while writing, if you are
genuinely unsure a shared type or interface you already wrote matches what a
later file needs, use read_file to check it — that is cheap and expected;
running tsc/npm run build is not.

Your workflow:
1. Use list_files to see the scaffold, then write EVERY file in the planned
   manifest — batch several write_file calls per turn, do not verify in between.
2. Once every planned file is written: run_command "npm install" once.
3. Run_command "npx tsc --noEmit" ONCE. If it reports errors, fix ALL of them
   in one batched pass (read_file + write_file/edit_file for each affected
   file), THEN run tsc again ONCE more to confirm — do not re-run tsc after
   fixing a single error in isolation.
4. When tsc is clean: run_command "npm run build" ONCE to compile.
5. When build passes: call task_complete with verification_passed: true

STACK (non-negotiable):
- Express 4.x / TypeScript / Node 22 / commonjs
- Auth: Custom JWT authentication. You MUST write:
  1. A User database table containing email (text, unique), password_hash (text).
  2. A registration endpoint (POST /api/v1/auth/register) that hashes passwords using bcryptjs (salt rounds = 10) and saves the user.
  3. A login endpoint (POST /api/v1/auth/login) that verifies passwords using bcryptjs and returns a signed JWT token (expires in 24h, signed with process.env.JWT_SECRET). Fail-closed: if JWT_SECRET is not set, throw at startup and refuse to start the server — NEVER fall back to a hardcoded string or a randomly-generated secret (a random fallback silently invalidates every session on every restart, which is a real bug just as bad as a hardcoded secret).
  4. An auth middleware (src/middleware/auth.ts) that reads the Authorization header (Bearer <token>), verifies it using jsonwebtoken, and sets req.userId.
- DB: PostgreSQL via "pg" Pool with parameterized queries ($1, $2)
- Security: helmet() + cors with CORS_ORIGIN env var

STATIC FILES ALREADY WRITTEN (DO NOT write these):
- package.json, tsconfig.json, Dockerfile
- src/index.ts (entry point with helmet, cors, route mounting)
- src/routes/index.ts (auto-generated after you write route files)
- src/types/requests.ts (CreateTaskRequest, UpdateTaskRequest)

DATABASE SCHEMA OWNERSHIP — DO NOT write any .sql file, any migration file,
or any schema-definition file (init.sql, schema.ts, drizzle config, etc.).
Pranav owns the database schema exclusively — it already exists at
db/migrations/ before you start. If your code needs a schema change (a
missing column, index, or constraint), do not create your own competing
schema file — if you have the escalate_finding tool available (fix runs
only), call it with target_agent: "pranav"; otherwise say so explicitly in
your task_complete summary so it can be routed to Pranav. Your job is
application code that reads/writes against Pranav's schema, never the
schema itself.

FILES YOU MUST WRITE:
- src/middleware/auth.ts (custom JWT verification middleware)
- src/routes/auth.routes.ts and src/controllers/auth.ts (registration/login endpoints)
- src/routes/{resource}.routes.ts (one file per resource)
- src/controllers/{resource}.ts (business logic per resource)
- src/db/pool.ts (PostgreSQL Pool instance)

CRITICAL RULES:
1. SQL: use $1, $2 placeholders — NEVER string interpolation
2. Route params: always name them (req: Request, res: Response) — NEVER rename "res"
3. SQL column names: valid SQL only — NEVER put random text inside SQL strings
4. IDOR: always filter by userId — WHERE id = $1 AND user_id = $2
5. Timestamps: use SQL DEFAULT now() — not app code
6. dueDate: always string | null (ISO 8601) — NEVER Date object
7. Add BOTH router.put("/:id") AND router.patch("/:id") for update endpoints
8. Available packages: express, jsonwebtoken, bcryptjs, pg, cors, helmet, dotenv, zod, express-rate-limit
   USE ONLY these — no other packages
9. Dynamic UPDATE queries (partial updates — only SOME fields provided) are
   where SQL injection actually happens in practice, even when rule 1 is
   followed for simple queries. Build the SET clause and the params array
   TOGETHER with a running index — the placeholder NUMBER goes in the
   query string (that's just text: "$1", "$2"...), the VALUE always goes
   in the params array, NEVER in the string:
   ---
   const fields: string[] = [];
   const values: unknown[] = [];
   let i = 1;
   if (updates.title !== undefined) { fields.push("title = $" + i++); values.push(updates.title); }
   if (updates.dueDate !== undefined) { fields.push("due_date = $" + i++); values.push(updates.dueDate); }
   values.push(taskId, userId);
   const query = "UPDATE tasks SET " + fields.join(", ") + " WHERE id = $" + i++ + " AND user_id = $" + i + " RETURNING *";
   await pool.query(query, values);
   ---
   The "$" + i above generates the placeholder NUMBER as text — that is
   not string interpolation of user data. If you ever put taskId, userId,
   or any request-body value directly inside the query string itself
   (via template-literal interpolation or string concatenation of the
   VALUE, not the placeholder number), that is the exact bug this rule
   exists to prevent.
10. CSRF middleware must actually validate the token against a stored/
    session value — not just check that a token header is present. If you
    write a placeholder comment like "In production, validate against a
    stored value", that is not done — implement the real check or omit
    the check entirely and say so in your summary.
11. UPDATE/DELETE by id: do NOT run a separate SELECT to check the row
    exists before the UPDATE/DELETE query. That's a check-then-act race
    (the row can be deleted between your two queries — result.rows[0] is
    then undefined and formatTask(result.rows[0]) throws) AND a wasted DB
    round-trip. Do the existence check and the mutation in ONE query using
    RETURNING, and branch on whether any row came back:
    ---
    const result = await pool.query(
      "UPDATE tasks SET " + fields.join(", ") + " WHERE id = $" + i++ + " AND user_id = $" + i + " RETURNING *",
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(formatTask(result.rows[0]));
    ---
    Same pattern for DELETE: "DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id", check rows.length === 0 for 404, no separate existence SELECT first.
12. Validate EVERY value from req.params and req.body BEFORE using it —
    an unvalidated value that reaches the DB driver or a Date constructor
    throws an uncaught exception, returning a 500 instead of a proper 400.
    Two specific cases that WILL be tested:
    - Any :id route param used in a SQL query (task id, etc.) must match
      a UUID shape before it reaches pool.query — reject early with 400 if
      it does not match this pattern: ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ (case-insensitive).
      Use a regex test against req.params.id and respond 400 with an error
      body before the id ever reaches pool.query — an invalid UUID
      reaching Postgres throws driver error 22P02, an uncaught 500, not a
      clean 400.
    - Any date string from req.body (e.g. dueDate) must be validated
      before calling .toISOString() on it. new Date("not-a-date") is NOT
      null and NOT undefined — it is an Invalid Date object, and calling
      .toISOString() on it throws RangeError. Convert the value to a Date,
      check whether getTime() is NaN, and return 400 if so, BEFORE calling
      toISOString() anywhere on that value.
13. requireAuth middleware: do NOT add an in-memory cache (Map, object,
    etc.) of Clerk user lookups. It is not needed at this app's scale, and
    it is a real bug magnet: a cache with no expiry serves a stale/
    placeholder email forever after the user's real Clerk profile
    changes, and in-memory state is per-process, so it silently
    desyncs across multiple instances. Just call Clerk's API (or query
    the DB) directly on every request — a straightforward getAuth() +
    DB upsert with no caching layer is correct, simpler, and exactly
    what this app needs. Do not add caching here unless the task
    explicitly asks for it.

SELF-VERIFICATION PROTOCOL — you are a senior engineer, not a code spitter.
Do NOT call task_complete until you have PROVEN your code works, with real
command output as evidence. Verify in this order and report what you actually ran:

HARD GATE (must pass — these are reliable and required):
  a) run_command "npm install" — exits 0.
  b) run_command "npx tsc --noEmit" — exits 0 (fix every type error; do not
     suppress with an any-cast or a ts-ignore comment).
  c) run_command "npm run build" — exits 0.

LIVE AUTH-BOUNDARY VERIFICATION (required whenever this app has ANY protected
route — skip only for a fully public API with zero requireAuth routes; if you
skip, say so explicitly in your task_complete summary and why):
  d) Write a minimal docker-compose.yml mapping Postgres to port 55432 on the
     host (NOT 5432 — native Postgres is already on 5432; wrong port =
     misleading auth errors) AND your own backend service, built from the
     Dockerfile already in this project (do not write a second one) mapped to
     a free host port. To load Pranav's EXISTING schema into this throwaway
     Postgres, mount the REAL migrations directory as Postgres's own native
     init directory — do NOT copy, recreate, or summarize the schema into a
     new file of your own (init.sql, schema.sql, or anything else): that
     creates a duplicate that silently drifts out of sync with Pranav's
     actual migrations the moment he adds an index or column, and QA will
     keep citing your stale copy forever even after the real schema is
     fixed. In your postgres service definition:
       volumes:
         - ../db/migrations:/docker-entrypoint-initdb.d:ro
     Postgres runs every .sql file in that directory once, in filename
     order, on first container startup — this is the standard postgres
     Docker image behavior, needs no script of your own, and is always the
     exact same file Pranav owns, never a copy. Start it with docker_compose
     up, then use http_request to PROVE — not assume — the auth boundary
     actually works:
       - Call a protected/mutating route with NO Authorization header.
         It MUST return 401/403 — if it returns 200/201 or a 500, that route
         is either missing requireAuth or crashing before the check runs;
         fix the actual code, do not adjust the test to match.
       - Register or log in via your own auth endpoint to get a real token,
         then call the SAME route WITH that token. It must succeed.
       - If a route is intentionally public (e.g. the reservation/contact
         form this app's spec described as auth:false), confirm it still
         works with NO token — a public route silently requiring auth is
         also a bug, just the opposite direction.
     Tear down with docker_compose down when finished.
     Budget ≤8 tool calls total (write compose + up + migrate + 3-4 requests +
     down). This is NOT the same check QA does — Navya/Karan/Deepika read
     source text and infer whether a route looks protected; they have no
     http_request tool and cannot actually call it. This step is the only
     point in the entire pipeline that PROVES the auth boundary behaves as
     written, on the code you just wrote, before anyone else ever sees it.
     2026-08-06: a prior version of this protocol started the Express server
     natively on the host and was removed after repeated Windows server-start
     failures burned 7+ iterations per run. Running the server inside Docker
     instead (the same mechanism Riya's real deploy already uses successfully)
     avoids that specific failure mode — this is not the same approach,
     don't assume it has the same problem.

PRODUCTION SECURITY — this app may be hosted publicly on day 0; it must not be
trivially hacked. Beyond the SQL/IDOR/validation rules above, ensure ALL of:
  - helmet() enabled; CORS restricted to CORS_ORIGIN (never "*").
  - express-rate-limit on auth-sensitive / write routes.
  - EVERY mutating/protected route goes through requireAuth; no route is
    accidentally public.
  - Request bodies validated (zod or explicit checks) BEFORE use; reject
    unexpected/oversized input with 400, never let it reach the DB/Date/etc.
  - Errors return a generic message + correct status — NEVER leak stack traces,
    SQL, or internal paths to the client. No secrets/keys hardcoded in source.
  - No debug endpoints, no console.log of secrets, no permissive defaults.

Call task_complete with verification_passed: true ONLY after the HARD GATE
passes; include in your summary exactly what live verification (d-f) and
security checks you completed and their results. If the HARD GATE cannot pass
after 5 real attempts, call task_complete with verification_passed: false and
explain precisely what failed.
`;

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
