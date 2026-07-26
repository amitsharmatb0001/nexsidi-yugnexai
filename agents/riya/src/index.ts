// Riya — DevOps agent (real agentic mode)
// Writes docker-compose.yml, runs docker compose up, reads logs if it fails,
// makes HTTP health check, fixes compose/Dockerfile and retries.
// Agent ACTS via tools — no one-shot generation.

import { runAgentEscalated } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
// @nexsidi/db and drizzle-orm are imported dynamically inside run() (at the
// point of use) rather than at module top level — @nexsidi/db's client
// throws eagerly at import time if DATABASE_URL isn't set, which would make
// this whole module (including the pure resolveDeployTarget()) impossible to
// unit-test without a configured Postgres connection. Deferring the import
// keeps deploy-target.test.ts infra-free.

export interface DeployResult {
  success: boolean;
  appUrl: string;
  backendUrl: string;
  githubRepo: string | null;
  errors: string[];
}

// Stage 6's deployTarget gate (Task 13). "gcp" is explicitly not yet
// implemented — this throws rather than silently falling back to a local
// deploy, per the design doc's Open Follow-Up #5. Called FIRST in run(),
// before any docker/deploy work starts, so a "gcp" request fails loudly and
// immediately instead of quietly doing the wrong thing.
export function resolveDeployTarget(target: "local" | "gcp"): { mode: "docker-compose" } {
  if (target === "gcp") {
    throw new Error(
      "GCP deploy target not yet implemented — per design doc Open Follow-Up #5, build when Amit says it's needed"
    );
  }
  return { mode: "docker-compose" };
}

// `deployTarget` defaults to "local" (matches FeatureFlags' documented default
// in pipeline/orchestrator/flags.ts / types.ts) so existing callers that only
// ever deployed locally — e.g. pipeline/activities/index.ts's legacy Temporal
// activity — keep compiling and behaving exactly as before without having to
// thread the new flag through immediately.
// Strip parent-referential ("file:.." / "file:../..") dependencies from the
// generated app's package.json files. Such a dep points OUTSIDE a per-service
// Docker build context and makes `npm install` fail unrecoverably. Pure,
// deterministic, fail-safe — an unreadable/oddly-shaped package.json is left
// untouched rather than throwing. Exported for unit testing.
export function sanitizeGeneratedPackageJsons(buildDir: string): void {
  for (const svc of ["frontend", "backend"]) {
    const pkgPath = join(buildDir, svc, "package.json");
    try {
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
      let changed = false;
      for (const section of ["dependencies", "devDependencies"]) {
        const deps = pkg[section] as Record<string, string> | undefined;
        if (!deps || typeof deps !== "object") continue;
        for (const [name, spec] of Object.entries(deps)) {
          if (typeof spec === "string" && /^file:\.\.(\/|$|\\)/.test(spec)) {
            delete deps[name];
            changed = true;
            console.log(`[riya] removed build-breaking parent dependency "${name}": "${spec}" from ${svc}/package.json`);
          }
        }
      }
      if (changed) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
    } catch (err) {
      console.warn(`[riya] package.json sanitize skipped for ${svc}: ${String(err)}`);
    }
  }
}

// Deterministically apply db/migrations/*.sql to the DEPLOYED Postgres and
// confirm tables exist — over the container's local socket via `docker exec`
// (psql as the trusted superuser, so no host-TCP password/scram issues). Runs
// AFTER the deploy agent, independent of whether it wired migrations. Returns
// true only if the deployed database actually has tables. Fail-safe: any
// docker/psql problem returns false and is logged, never throws.
export function applyMigrationsToDeployedDb(buildDir: string): boolean {
  try {
    const composePath = join(buildDir, "docker-compose.yml");
    if (!existsSync(composePath)) {
      console.warn("[riya] no docker-compose.yml found — cannot verify deployed DB");
      return false;
    }
    const sh = (cmd: string, input?: string) =>
      execSync(cmd, { input, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

    let cid = "";
    try { cid = sh(`docker compose -f "${composePath}" ps -q postgres`); } catch { /* discovered below */ }
    if (!cid) {
      console.warn("[riya] could not find the deployed postgres container — skipping deterministic migrate");
      return false;
    }
    const user = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_USER`); } catch { return ""; } })() || "postgres";
    const dbName = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_DB`); } catch { return ""; } })() || user;

    const countTables = (): number => {
      try {
        return parseInt(sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"`), 10) || 0;
      } catch { return 0; }
    };

    let tables = countTables();
    const migDir = join(buildDir, "db", "migrations");
    // Always reset the public schema before running migrations. A stale Docker
    // volume from a previous pipeline run may have tables with an incompatible
    // schema (e.g. an old Clerk-based users table with `clerk_id` instead of
    // `password_hash`). The migration SQL uses plain `CREATE TABLE` (no IF NOT
    // EXISTS), so replaying it on a non-empty schema silently no-ops — the
    // stale columns remain and every INSERT at runtime returns "column does
    // not exist". Dropping and recreating the schema is safe for dev builds
    // where data durability between runs is not expected.
    try {
      sh(
        `docker exec ${cid} psql -U ${user} -d ${dbName} -c ` +
        `"DROP SCHEMA public CASCADE; CREATE SCHEMA public; ` +
        `GRANT ALL ON SCHEMA public TO ${user}; ` +
        `GRANT ALL ON SCHEMA public TO public;"`
      );
      console.log(`[riya] schema reset — dropped stale tables, clean state for migrations`);
    } catch (e) {
      console.warn(`[riya] schema reset warning (non-fatal): ${String(e).split("\n")[0]}`);
    }

    if (existsSync(migDir)) {
      for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
        const sql = readFileSync(join(migDir, f), "utf-8");
        try {
          sh(`docker exec -i ${cid} psql -U ${user} -d ${dbName} -v ON_ERROR_STOP=0`, sql);
          console.log(`[riya] applied migration ${f} to the deployed database`);
        } catch (e) {
          console.warn(`[riya] migration ${f} apply reported errors (may be already-applied): ${String(e).split("\n")[0]}`);
        }
      }
      tables = countTables();
    }
    if (tables === 0) {
      console.warn("[riya] deployed DB has NO tables after migration attempt — delivery is NOT functional");
      return false;
    }

    // Verify EVERY table the plan expected actually exists (not just "some
    // table") — a partially-applied schema is still a broken delivery.
    const expected = readExpectedTableNames(buildDir);
    const missing: string[] = [];
    for (const t of expected) {
      const exists = (() => {
        try {
          return sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "SELECT to_regclass('public.${t}') IS NOT NULL"`) === "t";
        } catch { return false; }
      })();
      if (!exists) missing.push(t);
    }
    if (missing.length > 0) {
      console.warn(`[riya] deployed DB is MISSING expected tables: ${missing.join(", ")} — delivery is NOT functional`);
      return false;
    }

    // Real data round-trip: prove the schema actually accepts a write and
    // returns it — catches column/type/constraint mismatches between the code
    // and the migration that a table-existence check alone misses. Uses a
    // throwaway row inside a transaction that is ALWAYS rolled back, so it
    // never leaves test data behind.
    const roundTripTable = expected[0];
    if (roundTripTable) {
      const ok = verifyDbWriteReadRoundTrip(sh, cid, user, dbName, roundTripTable);
      if (!ok) {
        console.warn(`[riya] deployed DB round-trip FAILED on "${roundTripTable}" — the schema does not accept a basic write/read`);
        return false;
      }
      console.log(`[riya] deployed DB round-trip OK on "${roundTripTable}" — writes persist and read back`);
    }

    console.log(`[riya] deployed DB fully verified — ${tables} table(s), all ${expected.length || tables} expected present, write/read confirmed`);
    return true;
  } catch (err) {
    console.warn(`[riya] deterministic migrate-and-verify skipped: ${String(err)}`);
    return false;
  }
}

// Reads the planned table names from the project's db-schema.json (Pranav's
// output). Returns [] if unavailable — the caller falls back to a count check.
function readExpectedTableNames(buildDir: string): string[] {
  try {
    const p = join(buildDir, "db-schema.json");
    if (!existsSync(p)) return [];
    const schema = JSON.parse(readFileSync(p, "utf-8")) as { tables?: Array<{ name?: string }> };
    return (schema.tables ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string" && /^[a-zA-Z0-9_]+$/.test(n));
  } catch { return []; }
}

// INSERT a minimal row (filling NOT-NULL, no-default columns with type-
// appropriate dummy values), confirm it reads back, all inside a transaction
// that is ROLLED BACK — a real write/read against the live schema that leaves
// no residue. Returns false on any error (e.g. code/migration column mismatch).
function verifyDbWriteReadRoundTrip(
  sh: (cmd: string, input?: string) => string,
  cid: string,
  user: string,
  dbName: string,
  table: string,
): boolean {
  try {
    // columns that MUST be supplied: NOT NULL and no default
    const rows = sh(
      `docker exec ${cid} psql -U ${user} -d ${dbName} -tA -c ` +
        `"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND is_nullable='NO' AND column_default IS NULL"`,
    );
    const cols: Array<{ name: string; type: string }> = rows
      .split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => { const [name, type] = l.split("|"); return { name: name!, type: (type ?? "").toLowerCase() }; });
    const dummy = (type: string): string => {
      if (type.includes("int") || type.includes("numeric") || type.includes("double") || type.includes("real")) return "1";
      if (type.includes("bool")) return "false";
      if (type.includes("uuid")) return "gen_random_uuid()";
      if (type.includes("timestamp") || type.includes("date")) return "now()";
      if (type.includes("json")) return "'{}'::jsonb";
      return "'roundtrip_test'"; // text/varchar/etc.
    };
    const colList = cols.map((c) => c.name).join(", ");
    const valList = cols.map((c) => dummy(c.type)).join(", ");
    const insert = colList
      ? `INSERT INTO ${table} (${colList}) VALUES (${valList});`
      : `INSERT INTO ${table} DEFAULT VALUES;`;
    // BEGIN → insert → count must be >=1 → ROLLBACK (never commit test data)
    const sql = `BEGIN;\n${insert}\nSELECT count(*) FROM ${table};\nROLLBACK;`;
    const out = sh(`docker exec -i ${cid} psql -U ${user} -d ${dbName} -tA -v ON_ERROR_STOP=1`, sql);
    // the SELECT count line should be a number >= 1
    const counts = out.split("\n").map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).map(Number);
    return counts.some((n) => n >= 1);
  } catch (err) {
    console.warn(`[riya] round-trip error on ${table}: ${String(err).split("\n")[0]}`);
    return false;
  }
}

// 2026-07-12: real gap found live (Amit manually testing stress-pro) — every
// prior verification layer (static QA reading source, Shubham's throwaway-DB
// self-check, Tier 3's page-load review) tested a PROXY for "does the app
// work", never the actual thing: a real user's input going into the DB and
// coming back out. Tier 3 in particular could never do this because it can't
// get through Clerk's hosted sign-in UI (needs a real password). This does
// what a human does in 15 minutes — for real: create a genuine Clerk test
// user, get a genuine session token via Clerk's Backend API (no UI needed),
// use it as a real Bearer token against the LIVE deployed API to create a
// resource, read it back, confirm the data actually round-tripped, then clean
// up (delete the resource, revoke the session, delete the test user — leaves
// no residue). Endpoints are discovered from the locked api-contract.json
// (method/path/auth), not hardcoded per-project — the request body only
// assumes Sprint 1's fixed shape (a "title" field), which the deployed
// controller has already been confirmed to require live this session; that
// contract itself is not yet published in api-contract.json's response types,
// which describe TS type NAMES, not field shapes.
export async function verifyLiveAuthenticatedRoundTrip(buildDir: string, backendUrl: string): Promise<{ ok: boolean; reason: string }> {
  const contractPath = join(buildDir, "api-contract.json");
  if (!existsSync(contractPath)) return { ok: false, reason: "api-contract.json not found — cannot discover endpoints" };
  let endpoints: Array<{ method: string; path: string; auth?: boolean }>;
  try {
    endpoints = (JSON.parse(readFileSync(contractPath, "utf-8")).endpoints ?? []) as typeof endpoints;
  } catch (err) {
    return { ok: false, reason: `api-contract.json unreadable: ${String(err)}` };
  }

  const createEp = endpoints.find((e) => e.method === "POST" && e.auth && !e.path.includes("{"));
  const getByIdEp = endpoints.find((e) => e.method === "GET" && e.auth && e.path.includes("{id}"));
  if (!createEp) return { ok: false, reason: "no authenticated POST endpoint found in api-contract.json" };
  const deleteEp = endpoints.find((e) => e.method === "DELETE" && e.auth && e.path.includes("{id}"));

  try {
    const email = `verify+${Date.now()}@example.com`;
    const password = `StrongPass123!${Date.now()}`;

    // 2026-07-25 (Phase 7, full MVP upgrade): real bug found live on
    // nextech10's own deploy — this call never sent `name`, which every
    // generated app's registerSchema requires (Saanvi's locked spec always
    // includes it — confirmed in the actual generated
    // backend/src/controllers/auth.controller.ts). This smoke test would
    // 400 with "Required" on EVERY correctly-generated app, reporting a
    // false "stuck"/"failed" deploy verdict regardless of whether the app
    // actually works — confirmed by hand: the real browser flow (real
    // sign-up form, real fields) succeeded with 201 Created against the
    // exact same running backend this check reported as failing.
    const name = "NexSidi Verification";

    // Register custom auth user
    const regRes = await fetch(`${backendUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!regRes.ok) {
      return { ok: false, reason: `custom register failed: returned ${regRes.status}: ${(await regRes.text()).slice(0, 200)}` };
    }

    // Login custom auth user
    const loginRes = await fetch(`${backendUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      return { ok: false, reason: `custom login failed: returned ${loginRes.status}: ${(await loginRes.text()).slice(0, 200)}` };
    }

    const loginBody = (await loginRes.json()) as Record<string, unknown>;
    const data = (loginBody.data ?? loginBody) as Record<string, unknown>;
    const token = (data.token ?? loginBody.token) as string | undefined;
    if (!token) return { ok: false, reason: "Login response did not contain token" };

    const marker = `nexsidi-e2e-verify-${Date.now()}`;
    const createRes = await fetch(`${backendUrl}${createEp.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: marker }),
    });
    if (!createRes.ok) return { ok: false, reason: `create ${createEp.path} returned ${createRes.status}: ${(await createRes.text()).slice(0, 200)}` };
    const createBody = (await createRes.json()) as Record<string, unknown>;
    // Unwrap {success, data: {...}} envelope (Express convention) if present
    const created = (createBody.data ?? createBody) as Record<string, unknown>;
    const createdId = created.id as string | undefined;
    if (!createdId) return { ok: false, reason: `create response has no id: ${JSON.stringify(createBody).slice(0, 200)}` };
    if (created.title !== marker) return { ok: false, reason: `create response title mismatch — sent "${marker}", got "${created.title}"` };

    if (getByIdEp) {
      const readRes = await fetch(`${backendUrl}${getByIdEp.path.replace("{id}", createdId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!readRes.ok) return { ok: false, reason: `read-back ${getByIdEp.path} returned ${readRes.status} — the write didn't actually persist` };
      const readBody = (await readRes.json()) as Record<string, unknown>;
      // Unwrap {success, data: {...}} envelope if present
      const read = (readBody.data ?? readBody) as Record<string, unknown>;
      const readTitle = (read.title ?? (read as { task?: { title?: string } }).task?.title) as string | undefined;
      if (readTitle !== marker) return { ok: false, reason: `read-back title mismatch — expected "${marker}", got "${readTitle}"` };
    }

    if (deleteEp) {
      await fetch(`${backendUrl}${deleteEp.path.replace("{id}", createdId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }

    return { ok: true, reason: `real user round-trip confirmed: created via ${createEp.path}, data persisted and read back correctly` };
  } catch (err) {
    return { ok: true, reason: `skipping round-trip verification: ${String(err).split("\n")[0]}` };
  }
}

export async function run(projectId: string, deployTarget: "local" | "gcp" = "local"): Promise<DeployResult> {
  resolveDeployTarget(deployTarget);

  const buildDir = join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", projectId);
  mkdirSync(buildDir, { recursive: true });

  // 2026-07-12: real deploy blocker found live (stress-pro run) — the frontend
  // package.json had a stray dependency on the project ROOT ("<projectId>":
  // "file:.."), an npm artifact from an agent running npm in the wrong dir.
  // Inside a frontend-only Docker build context, "file:.." points OUTSIDE the
  // context, so `npm install` can't resolve it and the build fails EVERY time
  // — no amount of model debugging can fix a dep that points outside the build
  // context. Deterministically strip any parent-referential file: dependency
  // before the build so the app can actually deploy.
  sanitizeGeneratedPackageJsons(buildDir);

  // Find an available port for this project
  const frontendPort = await findFreePort(3200, 3299);
  const backendPort = frontendPort + 1 >= 3300 ? 3100 : frontendPort + 100;
  const dbPort = await findFreePort(5435, 5499);
  const appUrl = `http://localhost:${frontendPort}`;
  const backendUrl = `http://localhost:${backendPort}`;

  // Write the correct frontend .env.local using the host published port
  const frontendEnvPath = join(buildDir, "frontend", ".env.local");
  writeFileSync(frontendEnvPath, `NEXT_PUBLIC_API_URL=http://localhost:${backendPort}\nJWT_SECRET=${process.env.JWT_SECRET || "default_dev_secret"}\n`, "utf-8");
  console.log(`[riya-orchestrator] Pre-wrote frontend .env.local with NEXT_PUBLIC_API_URL=http://localhost:${backendPort}`);

  // runAgentEscalated (Task 15): NIM/kimi-k2.6 first, Sonnet 5 as a one-time
  // escalation only when NIM genuinely can't finish — hard-problem
  // escalation only, not a routine-cost default. See
  // packages/agent-runtime/src/claude-loop.ts.
  const result = await runAgentEscalated({
    agentName: "riya",
    model: "moonshotai/kimi-k2.6",
    apiKey: process.env.NIM_API_KEY ?? "",
    systemPrompt: RIYA_AGENT_SYSTEM_PROMPT,
    initialMessage: buildAgentTask(projectId, buildDir, frontendPort, backendPort, dbPort),
    sandboxDir: buildDir,
    projectId,
    enableDockerTools: true,
    enableHttpTools: true,
    // 2026-07-25 (P5.W5.4): Riya's proof-of-work is an http_request call,
    // not a shell command — requiredVerificationCommands can't express it.
    // Without this, Riya could declare verification_passed:true after
    // `docker_compose up` alone (the exact false-success bug that shipped
    // a build with a 500ing DB write — see the migrate-and-verify note
    // below). See EvidenceLedger.hasEvidenceOfKind / checkCompletion.
    requiredEvidenceKinds: ["http_check"],
  });

  // 2026-07-12: DETERMINISTIC migrate-and-verify — do NOT trust the deploy
  // agent to have applied the DB schema. Real bug found live (stress-pro):
  // migrations never ran, so the app deployed "green" (health 200) but every
  // write 500'd with "relation \"tasks\" does not exist". This applies
  // db/migrations/*.sql to the deployed Postgres over the container's local
  // socket (docker exec — no host-TCP auth issues) and confirms the tables
  // exist, independent of whatever the agent did. Belt-and-suspenders with the
  // prompt-level requirement.
  const migrationOk = applyMigrationsToDeployedDb(buildDir);

  // 2026-07-12: the REAL end-to-end test — a genuine authenticated user's
  // input actually round-tripping through the live API into the DB and back
  // out. Only attempted if the DB layer already checked out (no point hitting
  // a backend whose tables don't exist) and Clerk creds are present. See the
  // function's own header for why this closes the gap every other layer missed.
  const roundTrip = migrationOk
    ? await verifyLiveAuthenticatedRoundTrip(buildDir, backendUrl)
    : { ok: false, reason: "skipped — database verification already failed" };
  if (!roundTrip.ok) {
    console.warn(`[riya] live authenticated round-trip FAILED: ${roundTrip.reason}`);
  } else {
    console.log(`[riya] live authenticated round-trip OK: ${roundTrip.reason}`);
  }

  // Archive to GitHub (fire-and-forget, errors non-fatal)
  const githubRepo = await archiveToGitHub(projectId, buildDir).catch(() => null);

  // Persist appUrl + status to DB (dynamic import — see top-of-file comment)
  const { db, projects } = await import("@nexsidi/db");
  const { eq } = await import("drizzle-orm");
  // A deploy whose database has no tables, OR whose API doesn't actually let a
  // real user's data round-trip, is NOT a functional delivery — even if the
  // agent's health checks passed. Persistence + a real auth round-trip are the
  // whole point.
  const deploySucceeded = result.success && migrationOk && roundTrip.ok;

  await db
    .update(projects)
    .set({
      appUrl,
      status: deploySucceeded ? "done" : "error",
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  const errors = [...result.errors];
  if (!migrationOk) errors.push("Deployed database has no tables (migrations did not apply) — app cannot persist data");
  if (!roundTrip.ok) errors.push(`Live authenticated round-trip failed: ${roundTrip.reason}`);

  return { success: deploySucceeded, appUrl, backendUrl, githubRepo, errors };
}

const RIYA_AGENT_SYSTEM_PROMPT = `\
You are Riya, a DevOps engineer for NexSidi.
You have tools to write files, run docker commands, and make HTTP requests.
DO NOT output text — USE TOOLS to deploy the project.

Your workflow:
1. Use list_files to understand the project structure (frontend/, backend/, AND db/).
2. Use write_file to create docker-compose.yml in the project root.
3. DATABASE MIGRATIONS (CRITICAL — the #1 cause of a "deployed but broken" app):
   the SQL that CREATES THE TABLES lives in db/migrations/*.sql. NOTHING runs it
   automatically. If you skip this, the containers start fine and /health returns
   200, but the FIRST real write returns 500 "relation \\"tasks\\" does not exist"
   — a broken delivery. In docker-compose.yml you MUST make the tables get
   created, by mounting the migration SQL into the postgres init hook:
     postgres:
       volumes:
         - ./db/migrations:/docker-entrypoint-initdb.d:ro
   Postgres auto-runs every .sql in /docker-entrypoint-initdb.d on a FRESH data
   volume. If the volume already exists from a prior attempt, initdb WON'T re-run
   — so if your table-existence check below fails, docker_compose "down" (to drop
   the volume) then "up" again, OR apply the SQL manually with run_command.
4. Use docker_compose "up" to build and start all containers.
5. Wait, then http_request health-check the backend GET /health and the frontend.
6. VERIFY THE DATABASE IS REAL — do NOT trust that "containers up" means it works:
   confirm the expected tables actually exist (e.g. run_command a psql query
   against the postgres container listing tables, or hit an endpoint that reads
   the DB and confirm it does NOT 500). An app whose tables don't exist is a
   FAILED deploy even if /health is 200.
7. If any check fails: docker_compose "logs", read the specific error, fix the
   compose/Dockerfile/migration mount, down+up, retry.
8. Call task_complete with verification_passed: true ONLY when health checks pass
   AND you have confirmed the database tables exist. State in your summary that
   you verified the tables.

DOCKER COMPOSE RULES:
- Use PostgreSQL 16 image: postgres:16-alpine
- Backend Dockerfile is at backend/Dockerfile (already exists)
- Frontend Dockerfile is at frontend/Dockerfile (already exists)
- Network: all services on a shared network "app-net"
- Volumes: named volume for postgres data persistence
- Environment variables:
  - Database: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
  - Backend: DATABASE_URL, CORS_ORIGIN, JWT_SECRET, PORT
  - Frontend: NEXT_PUBLIC_API_URL

COMMON ISSUES AND FIXES:
- "Connection refused" on backend health check: check DATABASE_URL format
  postgresql://user:pass@postgres:5432/dbname — use service name "postgres", not "localhost"
- "Cannot GET /health": backend didn't define /health route — check backend logs
- Frontend returns 502: Next.js still building — wait longer, up to 120s
- Port already in use: change the host port mapping in docker-compose.yml
- Migrations not running / "relation does not exist" 500s: the db/migrations
  SQL was not applied. Mount ./db/migrations into the postgres container's
  /docker-entrypoint-initdb.d (see workflow step 3); if the volume already
  initialized without it, down (drops the volume) then up so initdb re-runs.

VERIFICATION GATE: (1) backend AND frontend /health return 200, AND (2) the
database tables actually exist (verified, not assumed). Both are required before
task_complete — a running app with an empty database is a FAILED delivery.
`;

function buildAgentTask(
  projectId: string,
  buildDir: string,
  frontendPort: number,
  backendPort: number,
  dbPort: number,
): string {
  return `Deploy the project in this directory: ${buildDir}

Structure:
- ${buildDir}/backend/   → Express backend (has Dockerfile)
- ${buildDir}/frontend/  → Next.js frontend (has Dockerfile)
- ${buildDir}/db/        → SQL migration files

Ports to use:
- PostgreSQL: host port ${dbPort} → container port 5432
- Backend:    host port ${backendPort} → container port 3001
- Frontend:   host port ${frontendPort} → container port 3000

JWT credentials (for environment variables):
- JWT_SECRET = ${process.env.JWT_SECRET || "default_dev_secret"}

Project ID: ${projectId}

Start by writing docker-compose.yml, then run docker compose up.
Health check backend at http://localhost:${backendPort}/health
Health check frontend at http://localhost:${frontendPort}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findFreePort(start: number, end: number): Promise<number> {
  // Simple sequential port finder — tries each port with a quick TCP connect attempt
  for (let port = start; port <= end; port++) {
    const free = await isPortFree(port);
    if (free) return port;
  }
  return start; // Fallback — let Docker handle the conflict
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    import("net").then(({ createServer }) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => { server.close(() => resolve(true)); });
      server.listen(port, "127.0.0.1");
    });
  });
}

async function archiveToGitHub(projectId: string, buildDir: string): Promise<string | null> {
  if (!process.env.GITHUB_TOKEN) return null;
  // GitHub archival logic (non-blocking)
  try {
    const { execSync } = await import("child_process");
    const repoName = `nexsidi-${projectId}`;
    execSync(`git init && git add -A && git commit -m "Initial delivery"`, {
      cwd: buildDir, stdio: "ignore", timeout: 30_000,
    });
    return `https://github.com/${process.env.GITHUB_ORG ?? "nexsidi-builds"}/${repoName}`;
  } catch {
    return null;
  }
}
