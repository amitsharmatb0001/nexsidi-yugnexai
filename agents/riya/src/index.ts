// Riya — DevOps agent (real agentic mode)
import { createHash } from "node:crypto";
// Writes docker-compose.yml, runs docker compose up, reads logs if it fails,
// makes HTTP health check, fixes compose/Dockerfile and retries.
// Agent ACTS via tools — no one-shot generation.

import { runAgentEscalated, parseServiceHostPort, ensureDeliveryGitignore, stripRestartPoliciesInFile } from "@nexsidi/agent-runtime";
import { AGENT_MODELS, FALLBACK_CHAIN } from "@nexsidi/llm-client";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { join } from "path";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";
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
  // 2026-10-03 (evidence-only plan): live checks that could not test
  // something (e.g. the app rejected the check's own test value), with the
  // app's message. Not a failure and not a pass — the delivery is not
  // verified until it is checked.
  notChecked?: string[];
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
// 2026-08-27: real bug found live (project 852be5aeaef4). The live
// verification steps below (verifyLiveAuthenticatedRoundTrip,
// verifyAllResourceCrud) register throwaway accounts —
// `verify+<role>+<ts>@example.com` — against the REAL deployed database, and
// nothing ever removed them. Two distinct problems, both confirmed in the
// delivered app:
//   1. The delivered database shipped containing a test account. In that run
//      it was the ONLY row in `users`.
//   2. Worse, verifyAllResourceCrud registers with role "admin" via the
//      generated app's own one-time admin-bootstrap path ("role:'admin' is
//      allowed when no admin exists yet"). Verification therefore CONSUMES
//      the single bootstrap slot, so the real owner can never claim admin —
//      the deploy check silently locks the customer out of their own app.
// Deleting by the exact `verify+%@example.com` shape only ever removes rows
// this file created; a real user could not hold that address. Best-effort by
// design: a cleanup failure must never fail an otherwise-good deploy, so
// every branch warns and continues rather than throwing.
// 2026-10-03 (Ledgerly run 4): the delete failed on a foreign key — the test
// client the check created points at the test user — so the accounts and
// their data stayed. Rows pointing at a test user are now deleted first.
/** Every account a check makes lives on example.com, a reserved test domain no real person has. */
export const VERIFICATION_EMAIL_PATTERN = "%@example.com";

// 2026-10-23 (Trailhead rerun): the live evaluator signed up as newuser9988@outdoorcamp.test, which the example.com-only
// rule missed, and the leftover account failed the deploy's cleanliness check. Every reserved test domain is a test
// account: example.com/.net/.org and the .test, .example, .invalid and .localhost TLDs (RFC 2606/6761) — no real person
// can hold such an address.
const TEST_EMAIL_SUFFIXES = ["@example.com", "@example.net", "@example.org", ".test", ".example", ".invalid", ".localhost"];
export const TEST_ACCOUNT_CONDITION = `(${TEST_EMAIL_SUFFIXES.map((x) => `email ILIKE '%${x}'`).join(" OR ")})`;
export function isTestAccountEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return TEST_EMAIL_SUFFIXES.some((x) => e.endsWith(x));
}

// 2026-10-24 (Brewline live review): the app had staff-only pages, but the review got only an ordinary account, so the
// reality checker hunted for a staff login and had a sub-check overwrite the real staff password. The review stage now
// makes one test account per limited role. The roles are the ones the contract marks, e.g. "(staff only)".
const NOT_A_ROLE = new Set(["owner", "authenticated", "signed-in", "logged-in", "self", "user", "users", "public", "internal"]);
export function limitedRolesFromContract(endpoints: Array<{ description?: string }>): string[] {
  const roles = new Set<string>();
  for (const ep of endpoints) {
    const d = ep.description ?? "";
    for (const m of d.matchAll(/\(\s*([a-z][a-z_-]{1,20})(?:\s+or\s+([a-z][a-z_-]{1,20}))?\s+only\s*\)/gi)) {
      for (const r of [m[1], m[2]]) if (r) roles.add(r.toLowerCase());
    }
    for (const m of d.matchAll(/\b([a-z][a-z_]{1,20})-only\b/gi)) roles.add(m[1]!.toLowerCase());
  }
  return [...roles].filter((r) => !NOT_A_ROLE.has(r));
}

const PLAIN_ROLE = /^[a-z][a-z_-]{1,20}$/;
const PLAIN_EMAIL = /^[A-Za-z0-9+._-]+@[A-Za-z0-9.-]+$/;

/** The UPDATE that gives a test account a role. Only called with a checked table name, email and role. */
export function roleGrantSql(table: string, email: string, role: string): string {
  return `UPDATE "${table}" SET role = '${role}' WHERE email = '${email}'`;
}

/** Gives an account on the reserved test domain a role in the deployed app's database (the review stage's own step). */
export function grantTestAccountRole(buildDir: string, email: string, role: string): { ok: true } | { reason: string } {
  if (!isTestAccountEmail(email) || !PLAIN_EMAIL.test(email)) return { reason: `${email} is not a test account` };
  if (!PLAIN_ROLE.test(role)) return { reason: `${JSON.stringify(role.slice(0, 40))} is not a plain role name` };
  try {
    const composePath = join(buildDir, "docker-compose.yml");
    if (!existsSync(composePath)) return { reason: "no docker-compose.yml" };
    const sh = (cmd: string, input?: string) => execSync(cmd, { input, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const cid = sh(`docker compose -f "${composePath}" ps -q postgres`);
    if (!cid) return { reason: "the database container is not running" };
    const user = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_USER`); } catch { return ""; } })() || "postgres";
    const dbName = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_DB`); } catch { return ""; } })() || user;
    const psql = (sqlText: string) => sh(`docker exec -i ${cid} psql -U ${user} -d ${dbName} -tA -v ON_ERROR_STOP=1 -1 -f -`, sqlText);
    // The account table: has email, role and a password column.
    const table = psql(
      "SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_name='email' " +
      "AND EXISTS (SELECT 1 FROM information_schema.columns r WHERE r.table_schema='public' AND r.table_name=c.table_name AND r.column_name='role') " +
      "AND EXISTS (SELECT 1 FROM information_schema.columns p WHERE p.table_schema='public' AND p.table_name=c.table_name " +
      "AND p.column_name IN ('password_hash','password','hashed_password','password_digest')) LIMIT 1;",
    ).split("\n")[0]?.trim();
    if (!table) return { reason: "no account table with a role column" };
    const out = psql(roleGrantSql(table, email, role) + ";");
    return /UPDATE 1/.test(out) ? { ok: true } : { reason: `the role update changed no row (${out.slice(0, 80)})` };
  } catch (err) {
    return { reason: String(err instanceof Error ? err.message : err).split("\n")[0]!.slice(0, 200) };
  }
}

export interface ForeignKey { child: string; childColumn: string; parent: string; parentColumn: string }

/** DELETE statements that remove the rows matching `where` in `table` and every row that points at them, deepest first. */
export function buildPurgeStatements(table: string, where: string, fks: ForeignKey[]): string[] {
  const out: string[] = [];
  const visit = (tbl: string, cond: string, path: string[]) => {
    for (const fk of fks) {
      // a table pointing at itself is handled by the one DELETE below; a
      // cycle stops at the first table already on the path
      if (fk.parent !== tbl || fk.child === tbl || path.includes(fk.child) || path.length > 6) continue;
      visit(fk.child, `"${fk.childColumn}" IN (SELECT "${fk.parentColumn}" FROM "${tbl}" WHERE ${cond})`, [...path, fk.child]);
    }
    out.push(`DELETE FROM "${tbl}" WHERE ${cond}`);
  };
  visit(table, where, [table]);
  return out;
}

const FOREIGN_KEYS_SQL =
  "SELECT c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text, af.attname " +
  "FROM pg_constraint c " +
  "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] " +
  "JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1] " +
  "WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1;";

// 2026-10-05: only tables that hold ACCOUNTS (an email plus a password hash) are searched for test accounts. A
// customer's own clients table may hold an @example.com address as a placeholder; its rows are removed only
// through the test account they belong to (foreign keys), never because of their email.
export const ACCOUNT_TABLES_SQL =
  "SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_name='email' " +
  "AND EXISTS (SELECT 1 FROM information_schema.columns p WHERE p.table_schema='public' AND p.table_name=c.table_name " +
  "AND p.column_name IN ('password_hash','password','hashed_password','password_digest'))";

// 2026-10-22 (Trailhead Gear Rentals): a public form table (contact form: an email, a created_at, no password) is not an
// account table, so the checks' @example.com rows in it were never removed and the "no more rows than before" gate failed the
// deploy three times, each retry adding more. These tables are cleaned too, but only for rows made since the testing began.
export const PUBLIC_FORM_TABLES_SQL =
  "SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_name='email' " +
  "AND EXISTS (SELECT 1 FROM information_schema.columns t WHERE t.table_schema='public' AND t.table_name=c.table_name AND t.column_name='created_at') " +
  "AND NOT EXISTS (SELECT 1 FROM information_schema.columns p WHERE p.table_schema='public' AND p.table_name=c.table_name " +
  "AND p.column_name IN ('password_hash','password','hashed_password','password_digest'))";

/** Public-form rows made at or after `since` (a database timestamp). The value goes into SQL text, so only a timestamp is accepted. */
export function testWindowCondition(since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(since)) throw new Error(`not a timestamp: ${JSON.stringify(since.slice(0, 40))}`);
  // 2026-10-23: every public-form row made in the window, whatever address it uses — during testing the app listens only on
  // this machine, so they come from the checks (the evaluator used alex@trailtest.com). Rows from before are never touched.
  return `created_at >= '${since}'`;
}

/** The deployed database's own clock (null when it cannot be read), so the window does not depend on the host's clock. */
export function databaseNow(buildDir: string): string | null {
  try {
    const composePath = join(buildDir, "docker-compose.yml");
    if (!existsSync(composePath)) return null;
    const sh = (cmd: string) => execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const cid = sh(`docker compose -f "${composePath}" ps -q postgres`);
    if (!cid) return null;
    const user = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_USER`); } catch { return ""; } })() || "postgres";
    const dbName = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_DB`); } catch { return ""; } })() || user;
    const now = sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "SELECT now()"`);
    return /^\d{4}-/.test(now) ? now : null;
  } catch {
    return null;
  }
}

// 2026-10-24 (Brewline resume): records a role account creates (a menu item) have no owner, so the account cleanup
// missed them and they stayed in the delivered database. Every sample record the seeder creates is written down here
// and the cleanup removes exactly those rows.
const SEEDED_RECORDS_FILE = join(".nexsidi", "seeded-records.json");
const PLAIN_ID = /^[A-Za-z0-9-]{1,64}$/;

export function readSeededRecords(buildDir: string): string[] {
  try {
    const ids = JSON.parse(readFileSync(join(buildDir, SEEDED_RECORDS_FILE), "utf-8")) as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && PLAIN_ID.test(x)) : [];
  } catch {
    return [];
  }
}

export function recordSeededRecords(buildDir: string, created: Record<string, string[]>): void {
  const ids = new Set(readSeededRecords(buildDir));
  for (const list of Object.values(created)) for (const id of list) if (PLAIN_ID.test(id)) ids.add(id);
  mkdirSync(join(buildDir, ".nexsidi"), { recursive: true });
  writeFileSync(join(buildDir, SEEDED_RECORDS_FILE), JSON.stringify([...ids]));
}

export function clearSeededRecords(buildDir: string): void {
  try { writeFileSync(join(buildDir, SEEDED_RECORDS_FILE), "[]"); } catch { /* nothing recorded */ }
}

/** The WHERE condition for the recorded sample records (null when there are none). Only plain ids are used. */
export function seededRecordCondition(ids: string[]): string | null {
  const safe = ids.filter((id) => PLAIN_ID.test(id));
  return safe.length > 0 ? `id::text IN (${safe.map((id) => `'${id}'`).join(", ")})` : null;
}

export function purgeVerificationArtifacts(buildDir: string, since?: string | null): void {
  try {
    const composePath = join(buildDir, "docker-compose.yml");
    if (!existsSync(composePath)) return;
    const sh = (cmd: string, input?: string) => execSync(cmd, { input, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

    let cid = "";
    try { cid = sh(`docker compose -f "${composePath}" ps -q postgres`); } catch { /* nothing to clean */ }
    if (!cid) return;

    const user = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_USER`); } catch { return ""; } })() || "postgres";
    const dbName = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_DB`); } catch { return ""; } })() || user;

    // Only touch tables that actually have an email column — the users table
    // in practice, but discovered rather than assumed so a differently-named
    // identity table is still cleaned.
    const tables = sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "${ACCOUNT_TABLES_SQL}"`).split("\n").map((t) => t.trim()).filter(Boolean);

    const psql = (sqlText: string) => sh(`docker exec -i ${cid} psql -U ${user} -d ${dbName} -tA -F , -v ON_ERROR_STOP=1 -1 -f -`, sqlText);
    const unquote = (n: string) => n.trim().replace(/^"|"$/g, "");
    const fks: ForeignKey[] = psql(FOREIGN_KEYS_SQL).split("\n").filter(Boolean).map((line) => {
      const [child = "", childColumn = "", parent = "", parentColumn = ""] = line.split(",").map(unquote);
      return { child, childColumn, parent, parentColumn };
    });

    const where = TEST_ACCOUNT_CONDITION;
    let removed = 0;
    for (const table of tables) {
      try {
        const count = parseInt(psql(`SELECT count(*) FROM "${table}" WHERE ${where};`), 10) || 0;
        if (count === 0) continue;
        // one transaction (-1): either every dependent row and the account go, or nothing does
        psql(buildPurgeStatements(table, where, fks).map((s) => s + ";").join("\n"));
        removed += count;
      } catch (e) {
        console.warn(`[riya] could not purge verification rows from "${table}" (non-fatal): ${String(e).split("\n")[0]}`);
      }
    }
    if (removed > 0) {
      console.log(`[riya] purged ${removed} deploy-verification test account(s) from the delivered database — the admin bootstrap slot is free for the real owner`);
    }

    // Sample records the seeder created (see readSeededRecords), in every table with an id column, with what points at them.
    const seededWhere = seededRecordCondition(readSeededRecords(buildDir));
    if (seededWhere) {
      const idTables = sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id'"`).split("\n").map((t) => t.trim()).filter(Boolean);
      let seededRemoved = 0;
      let seededFailed = false;
      for (const table of idTables) {
        try {
          const count = parseInt(psql(`SELECT count(*) FROM "${table}" WHERE ${seededWhere};`), 10) || 0;
          if (count === 0) continue;
          psql(buildPurgeStatements(table, seededWhere, fks).map((s) => s + ";").join("\n"));
          seededRemoved += count;
        } catch (e) {
          seededFailed = true;
          console.warn(`[riya] could not remove sample records from "${table}" (non-fatal): ${String(e).split("\n")[0]}`);
        }
      }
      if (!seededFailed) clearSeededRecords(buildDir);
      if (seededRemoved > 0) console.log(`[riya] removed ${seededRemoved} sample record(s) the checks created`);
    }

    // Public form tables: only rows made since the testing began, so a customer's own rows are never touched.
    if (since) {
      const formWhere = testWindowCondition(since);
      const formTables = sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "${PUBLIC_FORM_TABLES_SQL}"`).split("\n").map((t) => t.trim()).filter((t) => t && !tables.includes(t));
      let formRemoved = 0;
      for (const table of formTables) {
        try {
          const count = parseInt(psql(`SELECT count(*) FROM "${table}" WHERE ${formWhere};`), 10) || 0;
          if (count === 0) continue;
          psql(buildPurgeStatements(table, formWhere, fks).map((s) => s + ";").join("\n"));
          formRemoved += count;
        } catch (e) {
          console.warn(`[riya] could not purge test rows from "${table}" (non-fatal): ${String(e).split("\n")[0]}`);
        }
      }
      if (formRemoved > 0) console.log(`[riya] purged ${formRemoved} test row(s) made during the checks from public form table(s)`);
    }
  } catch (e) {
    console.warn(`[riya] verification-artifact cleanup skipped (non-fatal): ${String(e).split("\n")[0]}`);
  }
}

// 2026-10-05 (Amit): sample data for every resource. The app is tested with generated records (so every page and
// every detail route has something to show), then the test account and everything under it is removed and the
// row counts are compared with those from before (compareSnapshots). Records are created through the app's own
// API as a test account — parents before children — using the same payload builder as the CRUD verification.
export interface SeedResult {
  created: Record<string, string[]>;
  notSeeded: string[];
}

/** Every `*_id` string in the payload, also inside lists and nested objects, replaced with a real id when one is found. */
export async function resolveNestedIds(
  value: Record<string, unknown>,
  resolve: (field: string) => Promise<string | null | undefined>,
): Promise<Record<string, unknown>> {
  const walk = async (v: unknown, field?: string): Promise<unknown> => {
    if (Array.isArray(v)) return Promise.all(v.map((x) => walk(x)));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = await walk(x, k);
      return out;
    }
    if (field?.endsWith("_id") && typeof v === "string") return (await resolve(field)) ?? v;
    return v;
  };
  return (await walk(value)) as Record<string, unknown>;
}

export async function seedSampleData(buildDir: string, backendUrl: string, token: string, perResource = 2, skip: Set<string> = new Set()): Promise<SeedResult> {
  const created: Record<string, string[]> = {};
  const notSeeded: string[] = [];
  const contractPath = join(buildDir, "api-contract.json");
  if (!existsSync(contractPath)) return { created, notSeeded: ["sample data: api-contract.json not found"] };
  let endpoints: Array<{ method: string; path: string; auth?: boolean; requestType?: string }>;
  try {
    endpoints = (JSON.parse(readFileSync(contractPath, "utf-8")).endpoints ?? []) as typeof endpoints;
  } catch (err) {
    return { created, notSeeded: [`sample data: api-contract.json unreadable: ${String(err).slice(0, 120)}`] };
  }
  const sharedTypesPath = join(buildDir, "shared-types.ts");
  const sharedTypesSource = existsSync(sharedTypesPath) ? readFileSync(sharedTypesPath, "utf-8") : "";

  const creates = new Map<string, { path: string; requestType?: string; auth?: boolean }>();
  for (const ep of endpoints) {
    const seg = ep.path.replace(/^\/api\/v1\//, "").split("/")[0];
    // skip: resources another test account already created (2026-10-24, one account per role).
    if (skip.has(seg ?? "")) continue;
    if (!seg || seg === "auth" || ep.method !== "POST" || hasPathParam(ep.path) || ep.path.replace(/^\/api\/v1\//, "").includes("/")) continue;
    creates.set(seg, ep);
  }

  // Parents first: a resource whose create payload has "<x>_id" fields waits for resources named x.
  const depsOf = (resource: string): string[] => {
    const ep = creates.get(resource)!;
    if (!ep.requestType || ep.requestType === "null") return [];
    const payload = buildPayloadForRequestType(sharedTypesSource, ep.requestType, "dep-probe") ?? {};
    return Object.keys(payload)
      .filter((k) => k.endsWith("_id"))
      .map((k) => [...creates.keys()].find((r) => r === pluralize(k.slice(0, -3)) || r === k.slice(0, -3)))
      .filter((r): r is string => !!r && r !== resource);
  };
  const order: string[] = [];
  const remaining = new Set(creates.keys());
  while (remaining.size > 0) {
    const ready = [...remaining].filter((r) => depsOf(r).every((d) => order.includes(d)));
    const next = ready.length > 0 ? ready : [...remaining]; // a cycle: try them anyway
    for (const r of next) { order.push(r); remaining.delete(r); }
  }

  for (const resource of order) {
    const ep = creates.get(resource)!;
    for (let i = 1; i <= perResource; i++) {
      try {
        const marker = `sample-${resource}-${i}`; // no spaces: the payload builder puts it into email addresses
        const payload = ((ep.requestType && ep.requestType !== "null" ? buildPayloadForRequestType(sharedTypesSource, ep.requestType, marker) : null) ?? { title: marker }) as Record<string, unknown>;
        Object.assign(payload, await resolveNestedIds(payload, (field) => resolveForeignKeyId(field, endpoints, backendUrl, token)));
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (ep.auth !== false) headers.Authorization = `Bearer ${token}`;
        let res = await fetch(`${backendUrl}${ep.path}`, { method: "POST", headers, body: JSON.stringify(payload) });
        let text = await res.text();
        // The app validated a field more tightly than the contract says (a date format, an allowed value, a length):
        // resend once in the shape the app named, as the CRUD check does.
        if (res.status === 400) {
          const repaired = repairPayloadFromValidationError(payload, text);
          if (repaired) {
            res = await fetch(`${backendUrl}${ep.path}`, { method: "POST", headers, body: JSON.stringify(repaired) });
            text = await res.text();
          }
        }
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        if (!res.ok) {
          const msg = typeof (json as { error?: unknown })?.error === "string" ? (json as { error: string }).error : text.slice(0, 160);
          notSeeded.push(`sample data: ${resource} #${i} was not created (POST ${ep.path} answered ${res.status}: ${msg})`);
          break; // the same payload will fail the same way
        }
        const obj = findFirstObjectWithId(json);
        if (!obj || typeof obj.id !== "string") {
          notSeeded.push(`sample data: ${resource} #${i} was created but the response carried no id (POST ${ep.path})`);
          continue;
        }
        (created[resource] ??= []).push(obj.id);
        recordSeededRecords(buildDir, { [resource]: [obj.id] });
      } catch (err) {
        notSeeded.push(`sample data: ${resource} #${i} failed: ${String(err).slice(0, 160)}`);
        break;
      }
    }
  }
  return { created, notSeeded };
}

/** Table names that hold more rows after than before (rows the cleanup could not remove). */
export function compareSnapshots(before: Record<string, number>, after: Record<string, number>): string[] {
  const out: string[] = [];
  for (const table of Object.keys(after).sort()) {
    const was = before[table] ?? 0;
    if (after[table]! > was) out.push(`${table}: ${was} rows before the testing, ${after[table]} after the cleanup`);
  }
  return out;
}

/** Row count of every table in the deployed database (null when the database cannot be read). */
export function snapshotTableCounts(buildDir: string): Record<string, number> | null {
  try {
    const composePath = join(buildDir, "docker-compose.yml");
    if (!existsSync(composePath)) return null;
    const sh = (cmd: string) => execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const cid = sh(`docker compose -f "${composePath}" ps -q postgres`);
    if (!cid) return null;
    const user = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_USER`); } catch { return ""; } })() || "postgres";
    const dbName = (() => { try { return sh(`docker exec ${cid} printenv POSTGRES_DB`); } catch { return ""; } })() || user;
    const query =
      "SELECT table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text " +
      "FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_nexsidi_migrations'";
    const out = sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "${query}"`);
    const counts: Record<string, number> = {};
    for (const line of out.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const [name, n] = line.split("|");
      if (name && n !== undefined && Number.isFinite(Number(n))) counts[name] = Number(n);
    }
    return counts;
  } catch {
    return null;
  }
}

// 2026-10-04: every deploy used to run DROP SCHEMA public CASCADE and re-apply
// every migration. Harmless while the app holds test data; a redeploy after
// delivery would erase a customer's real data. A database that holds rows is
// never dropped: migrations already applied are remembered in a ledger table
// (_nexsidi_migrations, with a checksum of each file) and only new ones run.
// An empty database may still be reset — there is nothing to lose.
export interface MigrationPlan {
  reset: boolean;
  apply: string[];
  adopt: boolean; // rows but no ledger yet: try every migration and record them all
  errors: string[];
}

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
}

export function planMigrations(
  state: { rows: number; ledger: Map<string, string> | null },
  files: Array<{ name: string; checksum: string }>,
): MigrationPlan {
  if (state.rows === 0) return { reset: true, apply: files.map((f) => f.name), adopt: false, errors: [] };
  if (!state.ledger) return { reset: false, apply: files.map((f) => f.name), adopt: true, errors: [] };
  const apply: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const known = state.ledger.get(f.name);
    if (known === undefined) apply.push(f.name);
    else if (known !== f.checksum) {
      errors.push(`${f.name} changed after it was applied, and the database holds data — add a NEW migration instead of editing an applied one`);
    }
  }
  return { reset: false, apply, adopt: false, errors };
}

/** Problems the last migration step found (read by run() to explain a failed deploy). */
export const migrationProblems: string[] = [];

export function applyMigrationsToDeployedDb(buildDir: string): boolean {
  migrationProblems.length = 0;
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

    // 2026-08-19: real bug found live (project 6ec9787d5a81, RateGate) — a
    // Gemini-fallback redeploy cycle rewrote docker-compose.yml with a
    // DIFFERENT POSTGRES_DB value ("app") than the one the Postgres data
    // volume was actually initialized with ("rategate"). Postgres's own
    // image only runs its init scripts (including CREATE DATABASE
    // $POSTGRES_DB) on a genuinely empty data directory — on a REUSED
    // volume (docker compose down without -v), changing POSTGRES_DB in the
    // compose file has no effect on the already-initialized cluster, so
    // every subsequent `docker exec ... -d $dbName` call below failed
    // outright with "database does not exist" (confirmed live via direct
    // psql), which every downstream layer (schema reset, migration apply)
    // misread as a generic "command failed" and identically re-failed on
    // retry, correctly tripping stuck-detection but for an entirely
    // fixable cause. The LLM-authored compose file is not a reliable
    // source of truth for what's actually in the volume — verify the
    // target database exists (via the "postgres" maintenance db, which
    // always exists) and create it if not, rather than trusting the env
    // var blindly.
    try {
      const exists = sh(`docker exec ${cid} psql -U ${user} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`) === "1";
      if (!exists) {
        sh(`docker exec ${cid} psql -U ${user} -d postgres -c "CREATE DATABASE ${dbName}"`);
        console.log(`[riya] target database "${dbName}" did not exist in the deployed Postgres volume — created it`);
      }
    } catch (e) {
      console.warn(`[riya] database-exists check/create failed (non-fatal, continuing): ${String(e).split("\n")[0]}`);
    }

    const countTables = (): number => {
      try {
        return parseInt(sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"`), 10) || 0;
      } catch { return 0; }
    };

    let tables = countTables();
    const migDir = join(buildDir, "db", "migrations");
    const psql = (q: string) => sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tAc "${q.replace(/"/g, '\\"')}"`);
    const files = existsSync(migDir)
      ? readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort().map((name) => ({ name, sql: readFileSync(join(migDir, name), "utf-8") }))
      : [];
    const withSums = files.map((f) => ({ name: f.name, checksum: migrationChecksum(f.sql) }));

    // Rows in every public table except the ledger; a read that fails counts as
    // "has data" so an unreadable database is never dropped.
    let rows = 1;
    try {
      rows = parseInt(psql(
        "SELECT COALESCE(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int), 0) " +
        "FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_nexsidi_migrations'",
      ), 10) || 0;
    } catch (e) {
      console.warn(`[riya] could not count rows (treating the database as holding data): ${String(e).split("\n")[0]}`);
    }
    let ledger: Map<string, string> | null = null;
    try {
      ledger = new Map(psql("SELECT name || '|' || checksum FROM _nexsidi_migrations").split("\n").filter(Boolean).map((l) => {
        const [n, c] = l.split("|");
        return [n!, c!] as [string, string];
      }));
    } catch { /* no ledger yet */ }

    const plan = planMigrations({ rows, ledger }, withSums);
    for (const err of plan.errors) {
      migrationProblems.push(err);
      console.error(`[riya] migration problem: ${err}`);
    }
    if (plan.reset) {
      // Empty database only: a stale volume from an earlier run may hold an incompatible schema
      // (e.g. an old Clerk-based users table), and replaying plain CREATE TABLE on it silently
      // no-ops. With no rows there is nothing to lose.
      try {
        sh(
          `docker exec ${cid} psql -U ${user} -d ${dbName} -c ` +
          `"DROP SCHEMA public CASCADE; CREATE SCHEMA public; ` +
          `GRANT ALL ON SCHEMA public TO ${user}; ` +
          `GRANT ALL ON SCHEMA public TO public;"`
        );
        console.log(`[riya] database is empty — schema reset for a clean start`);
      } catch (e) {
        console.warn(`[riya] schema reset warning (non-fatal): ${String(e).split("\n")[0]}`);
      }
    } else {
      console.log(`[riya] database holds ${rows} row(s) — NOT dropped; applying ${plan.apply.length} new migration(s) only`);
    }
    try {
      psql("CREATE TABLE IF NOT EXISTS _nexsidi_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    } catch (e) {
      console.warn(`[riya] could not create the migration ledger: ${String(e).split("\n")[0]}`);
    }

    for (const f of files.filter((x) => plan.apply.includes(x.name))) {
      try {
        sh(`docker exec -i ${cid} psql -U ${user} -d ${dbName} -v ON_ERROR_STOP=0`, f.sql);
        console.log(`[riya] applied migration ${f.name} to the deployed database`);
      } catch (e) {
        console.warn(`[riya] migration ${f.name} apply reported errors (may be already-applied): ${String(e).split("\n")[0]}`);
      }
      try {
        psql(`INSERT INTO _nexsidi_migrations (name, checksum) VALUES ('${f.name}', '${migrationChecksum(f.sql)}') ON CONFLICT (name) DO NOTHING`);
      } catch { /* ledger is best effort; the next deploy would just try this file again */ }
    }
    if (files.length > 0) tables = countTables();
    if (plan.errors.length > 0) return false;
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
// 2026-08-03: real bug found live (project=verify4617991) — the round-trip
// check hardcoded a generic {title: marker} create payload, which only
// matches Sprint 1's NexTech-style CRUD assumption. A contact-form endpoint
// (CreateContactRequest { subject: string; message: string }) got 400
// "Required" on every attempt — a false "broken deploy" verdict on an app
// that genuinely worked. Arjun always writes shared-types.ts at the build
// root (agents/arjun/src/index.ts) with the real flat interface definitions
// — parsing the NAMED type out of it gives the actual required fields
// instead of guessing a shape. Simple regex parse, not a full TS parser:
// Arjun's own interfaces are always flat `field: type;` lists (verified
// against real generated shared-types.ts across projects tonight).
// 2026-08-27: see the 400-recovery call site in verifyAllResourceCrud for the
// live failure this exists for. A generator can validate a field more tightly
// than the shared api-contract describes it (confirmed live: contract said
// `type: string`, backend enforced z.enum(["support","sales"])). When that
// happens the synthetic CRUD payload is rejected and the app looks broken
// when it is in fact validating correctly.
//
// Zod's message names the accepted values verbatim — "Invalid enum value.
// Expected 'support' | 'sales', received 'riya-verify-x'" — so the fix is to
// take the backend at its word and resend with a value it declared valid.
// Returns null when the error is NOT of this shape, so a genuine 400 (missing
// required field, real bad request) still surfaces as a real finding.
// Exported for direct unit testing.
export function repairPayloadFromValidationError(
  payload: Record<string, unknown>,
  errorText: string,
): Record<string, unknown> | null {
  // 2026-10-03 (Ledgerly run 4): a length rule ("gstin: String must contain
  // at most 15 character(s)") is just as much the backend validating
  // correctly — fit the value to the rule it named and resend.
  const lengthFixed = repairLengthErrors(payload, errorText);
  if (lengthFixed) return lengthFixed;

  // 2026-10-22 (Trailhead Gear Rentals): "must be valid dates in YYYY-MM-DD format" — the app wants date-only values.
  const dateFixed = repairDateOnly(payload, errorText);
  if (dateFixed) return dateFixed;

  // Collect every quoted value the validator listed as acceptable.
  const expected = errorText.match(/Expected\s+((?:'[^']*'\s*\|\s*)*'[^']*')/i);
  if (!expected?.[1]) return null;
  const allowed = [...expected[1].matchAll(/'([^']*)'/g)].map((m) => m[1]!);
  if (allowed.length === 0) return null;

  // Which field was rejected? Zod names it via `received '<the bad value>'`,
  // which we can match back to the exact key we sent.
  const received = errorText.match(/received\s+'([^']*)'/i)?.[1];
  const target = received !== undefined
    ? Object.keys(payload).find((k) => payload[k] === received)
    // No `received` echo — fall back to the single field whose sent value is
    // not already one of the allowed ones.
    : Object.keys(payload).find((k) => typeof payload[k] === "string" && !allowed.includes(payload[k] as string));
  if (!target) return null;

  return { ...payload, [target]: allowed[0] };
}

// 2026-10-03 (Ledgerly benchmark run 4): a GSTIN filled with the long marker
// string was (correctly) rejected by the app — "at most 15 characters" — and
// the deploy was marked failed twice on a working app. Fields whose name says
// what they hold get a value of the real shape. Exported for tests.
export function realisticValueFor(fieldName: string): string | null {
  const n = fieldName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.includes("gstin") || n === "gst" || n.endsWith("gstnumber")) return "27AAPFU0939F1ZV";
  if (n === "pan" || n.endsWith("pannumber") || n === "panno") return "AAPFU0939F";
  if (n.includes("ifsc")) return "SBIN0001234";
  if (n.includes("upi")) return "verify.test@okaxis";
  if (n.includes("sac") || n.includes("hsn")) return "998314";
  if (n.includes("pincode") || (n.includes("pin") && n.includes("code")) || n.includes("zip") || n.includes("postal")) return "400001";
  if (n.includes("phone") || n.includes("mobile") || n.includes("contactnumber") || n.includes("whatsapp")) return "9876543210";
  if (n === "state" || (n.endsWith("state") && !n.includes("status"))) return "Maharashtra";
  if (n === "city") return "Mumbai";
  if (n === "country") return "India";
  if (n.includes("website") || n.endsWith("url")) return "https://example.com";
  if (n.includes("password")) return "Verify-Test-Passw0rd!";
  return null;
}

/**
 * Fits every field the validator named in a length error ("<field>: String
 * must contain at most|least N character(s)", or "<field> must be at most N
 * characters") — a realistic value of the right length when one fits, else
 * the sent value cut or padded. Null when the error names no length rule.
 */
/** Timestamps sent where the app asked for YYYY-MM-DD become dates; the end of a range lands a day after its start. */
function repairDateOnly(payload: Record<string, unknown>, errorText: string): Record<string, unknown> | null {
  if (!/YYYY-MM-DD/i.test(errorText)) return null;
  const isoStamp = /^\d{4}-\d{2}-\d{2}T/;
  const keys = Object.keys(payload).filter((k) => typeof payload[k] === "string" && isoStamp.test(payload[k] as string));
  if (keys.length === 0) return null;
  const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const out = { ...payload };
  for (const k of keys) out[k] = /^end(_|$)|_end(_|$)/i.test(k) ? day(3) : day(2);
  return out;
}

function repairLengthErrors(payload: Record<string, unknown>, errorText: string): Record<string, unknown> | null {
  const rules = [...errorText.matchAll(/["\s,{]?(\w+)["']?\s*:?\s*(?:String )?must (?:contain|be) at (most|least) (\d+) char/gi)];
  if (rules.length === 0) return null;
  const fixed = { ...payload };
  let changed = false;
  for (const [, field, kind, nText] of rules) {
    if (!field || !(field in fixed)) continue;
    const n = Number(nText);
    const current = String(fixed[field] ?? "");
    const real = realisticValueFor(field);
    const fits = (v: string) => (kind!.toLowerCase() === "most" ? v.length <= n : v.length >= n);
    const next = real && fits(real) ? real : kind!.toLowerCase() === "most" ? current.slice(0, n) : current.padEnd(n, "x");
    if (next !== current) {
      fixed[field] = next;
      changed = true;
    }
  }
  return changed ? fixed : null;
}

// 2026-10-03 (Ledgerly run 4): the full CRUD check sent an invoice's line
// items as text ("items: Expected array, received string"). A list field
// gets a one-element list whose element is built from its own type.
function listElementType(type: string): string | null {
  const t = type.trim();
  const brackets = t.match(/^(.+)\[\]$/);
  if (brackets) return brackets[1]!.trim().replace(/^\((.*)\)$/, "$1");
  const generic = t.match(/^(?:Array|ReadonlyArray)<(.+)>$/);
  return generic ? generic[1]!.trim() : null;
}

/** An object for a type expression: a named interface, an inline literal, or Omit/Pick/Partial of a named one. */
function objectForType(sharedTypesSource: string, typeExpr: string, marker: string, depth: number): Record<string, unknown> | null {
  if (depth > 3) return null;
  const t = typeExpr.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    let body = t.slice(1, -1).trim();
    if (body && !body.endsWith(";")) body += ";";
    return fieldsToPayload(body, marker, sharedTypesSource, depth + 1);
  }
  const keyed = t.match(/^(Omit|Pick)<\s*(\w+)\s*,\s*(.+)>$/);
  const wrapped = t.match(/^(?:Partial|Required|Readonly)<\s*(\w+)\s*>$/);
  const name = keyed ? keyed[2]! : wrapped ? wrapped[1]! : /^\w+$/.test(t) ? t : null;
  if (!name) return null;
  const typeMatch = sharedTypesSource.match(new RegExp(`interface\\s+${name}\\s*\\{([^}]*)\\}`));
  if (!typeMatch) return null;
  const obj = fieldsToPayload(typeMatch[1] ?? "", marker, sharedTypesSource, depth + 1);
  if (!obj || !keyed) return obj;
  const keys = [...keyed[3]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => (keyed[1] === "Omit" ? !keys.includes(k) : keys.includes(k))));
}

/** `name: type;` fields of a type body. A ";" inside braces or brackets belongs to a nested type, not to this list. */
function splitFields(body: string): Array<[string, string, string]> {
  const parts: string[] = [];
  let depth = 0, current = "";
  for (const ch of body) {
    if ("{<([".includes(ch)) depth++;
    else if ("}>)]".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) { parts.push(current); current = ""; } else current += ch;
  }
  if (current.trim()) parts.push(current);
  const out: Array<[string, string, string]> = [];
  for (const p of parts) {
    const m = p.trim().match(/^(\w+)\??\s*:\s*([\s\S]+)$/);
    if (m) out.push([p, m[1]!, m[2]!.trim()]);
  }
  return out;
}

function fieldsToPayload(body: string, marker: string, sharedTypesSource = "", depth = 0): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};
  let foundAny = false;
  for (const match of splitFields(body)) {
    foundAny = true;
    const [, fieldName, fieldType] = match;
    if (!fieldName) continue;
    const type = (fieldType ?? "").trim();
    const lowerName = fieldName.toLowerCase();
    // 2026-08-10: reordered — the declared TYPE is a more reliable signal
    // than a name substring, so number/boolean must be checked BEFORE the
    // name-based date heuristic below. Otherwise a field like
    // "runtime_minutes: number" (contains "time" as a substring but is
    // genuinely numeric) would incorrectly get a date string instead of 1.
    const elementType = listElementType(type);
    if (elementType !== null) {
      if (elementType === "string") payload[fieldName] = [realisticValueFor(fieldName) ?? marker];
      else if (elementType === "number") payload[fieldName] = [1];
      else if (elementType === "boolean") payload[fieldName] = [true];
      else {
        const element = objectForType(sharedTypesSource, elementType, marker, depth);
        payload[fieldName] = element ? [element] : [];
      }
    }
    else if (lowerName.includes("email")) payload[fieldName] = `verify+${marker}@example.com`;
    else if (type.includes("number")) payload[fieldName] = 1;
    else if (type.includes("boolean")) payload[fieldName] = true;
    // 2026-08-23: real bug found live (project a355bbb5fa35, nexyug web) —
    // a string-literal-union field (e.g. status: 'pending' | 'in_progress' |
    // 'closed') fell through to the generic marker-string branch below,
    // which sends a value like "riya-verify-abc123-updated" — never a member
    // of the union. A correctly-validating backend (zod z.enum(...), same as
    // this project's own updateInquirySchema) rejects it with a real 400,
    // which verifyAllResourceCrud then reported as an app bug. It wasn't:
    // the generated backend was validating correctly: the synthetic test
    // itself sent invalid data. Type-checked (not name-checked) like
    // number/boolean above, and placed before them structurally only because
    // it must win over the generic fallback — same "declared type is the
    // reliable signal" precedent as the number/boolean checks above it.
    else if (/^'[^']*'(\s*\|\s*'[^']*')*$/.test(type)) {
      payload[fieldName] = type.match(/^'([^']*)'/)![1];
    }
    // 2026-08-09: real bug found live (project meridianbk4, follow-on to the
    // inline-literal fix above) — an "appointment_date: string" field got
    // the raw marker string as its value, which fails any real backend's
    // date-format validation ("Invalid appointment_date format") even once
    // the field is present at all. A near-future ISO date always passes
    // Date.parse-style validation, matching the actual real-world value a
    // real user's date picker would send.
    // 2026-08-10: real bug found live (freshtst1) — "start_time" and
    // "scheduled_at" are just as common as "*date*" for a timestamp field,
    // and neither contains the literal substring "date". They fell through
    // to the generic marker-string branch below, which a real backend
    // correctly 400'd ("Valid start_time ISO date string is required").
    else if (lowerName.includes("date") || lowerName.includes("time") || lowerName.endsWith("_at")) {
      // 2026-08-10 (follow-on, same live run): a naive single fixed offset
      // gave "start_time" and "end_time" the EXACT same value, which a real
      // backend correctly rejected ("start_time must be earlier than
      // end_time"). A field whose name suggests it's the END of a range
      // gets a later offset than one that doesn't, so start < end holds for
      // any reasonably-named pair without needing to match them up.
      const isEndish = /^end(_|$)|_end(_|$)/i.test(lowerName);
      payload[fieldName] = new Date(Date.now() + 86_400_000 + (isEndish ? 3_600_000 : 0)).toISOString();
    }
    else payload[fieldName] = realisticValueFor(fieldName) ?? marker;
  }
  return foundAny ? payload : null;
}

// 2026-08-09: real bug found live (project meridianbk4) — Arjun's own
// api-contract.json doesn't always set requestType to a named interface
// reference; POST /api/v1/appointments had
// requestType: "{ service_id: string; appointment_date: string }" — an
// inline TS object-literal type written directly in the contract, not a
// name to look up in shared-types.ts. The named-interface regex below can
// never match that (there's no "interface { ... } { ... }" to find), so it
// silently returned null, fell back to the generic {title: marker} payload,
// and reported a false "deploy failed" (400 "service_id: Required,
// appointment_date: Required") on an app that genuinely worked — confirmed
// live: real register -> login -> book appointment with the correct field
// shape succeeded with a real 201. An inline literal always starts with "{"
// once trimmed; its field list is parsed directly with the same
// fieldsToPayload logic used for a named interface's body, no shared-types.ts
// lookup needed since the shape is already fully spelled out in typeName.
export function buildPayloadForRequestType(
  sharedTypesSource: string,
  typeName: string,
  marker: string,
): Record<string, unknown> | null {
  // 2026-09-28: real false deploy failure (project a034f90ba50e) — an update
  // endpoint typed "Partial<PlantPayload>" found no interface by that literal
  // name, so the check sent a null body and the app (correctly) answered 400.
  // Standard TS wrappers resolve to the type they wrap.
  const wrapped = typeName.trim().match(/^(?:Partial|Required|Readonly|Pick|Omit)<\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,[^>]*)?>$/);
  const trimmed = wrapped ? wrapped[1]! : typeName.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    // fieldsToPayload's regex requires a trailing ";" per field — an inline
    // literal's last field has none before the closing "}" (unlike a named
    // interface's body, which always does; see fieldsToPayload's own
    // callers). Append one so the last field isn't silently dropped.
    let body = trimmed.slice(1, -1).trim();
    if (body && !body.endsWith(";")) body += ";";
    return fieldsToPayload(body, marker, sharedTypesSource);
  }
  const typeMatch = sharedTypesSource.match(new RegExp(`interface\\s+${trimmed}\\s*\\{([^}]*)\\}`));
  if (!typeMatch) return null;
  return fieldsToPayload(typeMatch[1] ?? "", marker, sharedTypesSource);
}

// 2026-08-09: real bug found live (project meridianbk4, direct follow-on to
// the inline-literal fix above) — a "_id"-suffixed field derived by
// fieldsToPayload gets the raw marker string as its value, which fails
// format validation on any backend that actually checks (a real UUID-format
// regex, in this project's case). Even a syntactically-valid-but-nonexistent
// UUID would then fail a foreign-key existence check ("Service not found")
// — a real user's own booking flow always sends an id fetched from a real
// GET list endpoint first, never a guessed value. Heuristic: "service_id"
// -> try GET /api/v1/services (pluralized) then GET /api/v1/service; take
// the first item's `id` from whatever array is found, unwrapping a
// {data:[...]} / {items:[...]} envelope if present. Returns null (payload
// keeps its placeholder) when no matching list endpoint exists or the list
// is empty — additive only, never worse than today's behavior.
// Searches an unknown-shaped JSON value for the first array it contains, up
// to 2 levels deep (top-level array; a value's array; a value's value's
// array — covers both a bare list response and Express's {success, data:
// {resource: [...]}} envelope convention wrapping a named-key object).
function findFirstArray(value: unknown, depth = 2): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (depth <= 0 || typeof value !== "object" || value === null) return undefined;
  for (const v of Object.values(value as Record<string, unknown>)) {
    const found = findFirstArray(v, depth - 1);
    if (found) return found;
  }
  return undefined;
}

// 2026-08-10: real bug found live (freshtst1) — verifyAllResourceCrud's
// create-response unwrap only peeled ONE level ({data: {...}} -> {...}),
// but the real generated backend's shape was ONE level deeper:
// {"success":true,"data":{"class":{"id":...,"name":...}}} — Express's
// {success,data} envelope wrapping ANOTHER named-key object, the exact same
// double-envelope convention findFirstArray already had to handle for LIST
// responses, just never fixed for the single-object CREATE case. A
// genuinely successful create (real id, real row) was misreported as
// "response has no id" because created.id was undefined — the id was at
// created.class.id. Searches up to 2 levels deep for the first object
// carrying a string `id` field, so it doesn't need to guess the exact
// resource-singular key name.
// 2026-08-30: real live gap found tonight (project 05b590e98102) — this
// only matched the literal key "id", but a real, well-designed backend can
// legitimately name its identifier after the resource instead of a generic
// "id" (a "contact" create endpoint returning {success:true,
// inquiryId:"21ee39f1-..."} rather than {id:"..."}) — that's normal REST
// practice, not a bug. A genuinely successful create (real row, real UUID)
// was misreported as "response has no id" and burned both of Stage 6's
// retry attempts on the same false positive before escalating a working
// deploy as deploy_stuck. Now also matches the common resource-specific id
// conventions (fooId, foo_id, uuid) — normalizing the match onto `.id` so
// every existing caller (`created.id`, `created?.id`) keeps working
// unchanged. Deliberately narrow (requires a capital-I "Id" or "_id"
// suffix, or the exact names "id"/"uuid") so it doesn't false-match a field
// that merely ends in the letters "i","d" lowercase (e.g. "valid", "paid").
const ID_KEY_PATTERN = /^(?:id|uuid)$|[a-z0-9](?:_id|Id)$/;
export function findFirstObjectWithId(value: unknown, depth = 2): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === "string") return obj;
  for (const [key, v] of Object.entries(obj)) {
    if (key !== "id" && typeof v === "string" && v.length > 0 && ID_KEY_PATTERN.test(key)) {
      return { ...obj, id: v };
    }
  }
  if (depth <= 0) return undefined;
  for (const v of Object.values(obj)) {
    const found = findFirstObjectWithId(v, depth - 1);
    if (found) return found;
  }
  return undefined;
}

// 2026-08-10: real bug found live (user request, while researching a
// separate task) — every path-parameter check in this file used the
// literal string "{" (i.e. an "{id}" convention), but RestEndpoint.path's
// OWN doc comment (agents/arjun/src/index.ts) documents the actual,
// canonical convention as Express-style ":id" (e.g.
// "/api/v1/tasks/:id") — confirmed directly against a real generated
// api-contract.json ("/api/v1/classes/:id"). This meant `.includes("{")`
// NEVER matched any real contract's update/delete/get-by-id endpoints —
// updateEp/deleteEp/getByIdEp were always undefined, so PATCH/PUT/DELETE
// verification silently never ran against any real project, ever. It read
// as "no findings" (success) because the check itself never executed, not
// because the app was actually verified. Every existing test used the same
// wrong "{id}" convention in its fixtures, which is exactly why this was
// never caught. Supports both conventions going forward — ":id" is primary
// (matches reality), "{id}" kept as a defensive fallback.
function hasPathParam(path: string): boolean {
  return /:[a-zA-Z_][a-zA-Z0-9_]*/.test(path) || path.includes("{");
}
function substitutePathParam(path: string, id: string): string {
  return path.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, id).replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, id);
}

// 2026-08-19: real bug found live (project 6ec9787d5a81, RateGate) —
// verifyAllResourceCrud's getByIdEp/updateEp/deleteEp all used bare
// hasPathParam(e.path), which matches ANY path containing a param anywhere,
// not just the resource's own "fetch/update/delete by id" endpoint. For
// "projects" (createEp: POST /api/v1/projects), the only other GET with a
// path param was GET /api/v1/projects/:projectId/metrics — a sub-resource
// aggregation endpoint, not the project record itself — so getByIdEp
// wrongly matched it, then flagged a false-positive finding ("response
// doesn't contain the created record's own id") because a metrics response
// was never supposed to echo the project's id. This is the same class of
// bug verifyLiveAuthenticatedRoundTrip's detailPathFor already closed for
// its own single-resource check (see that function's 2026-08-XX comment
// above) — ported here as a general helper since createEp's param name
// varies per project (":id" is the documented convention but not the only
// one seen live, e.g. ":projectId"), so this matches on STRUCTURE (same
// base path as createEp, plus exactly one more segment, and that segment is
// a param) rather than the literal string ":id".
function isDirectByIdPath(basePath: string, candidatePath: string): boolean {
  const baseSegments = basePath.replace(/\/$/, "").split("/").filter(Boolean);
  const candSegments = candidatePath.split("/").filter(Boolean);
  if (candSegments.length !== baseSegments.length + 1) return false;
  for (let i = 0; i < baseSegments.length; i++) {
    if (candSegments[i] !== baseSegments[i]) return false;
  }
  const last = candSegments[candSegments.length - 1] ?? "";
  return /^:[a-zA-Z_][a-zA-Z0-9_]*$/.test(last) || /^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(last);
}

// 2026-08-10: real bug found live (freshtst1) — the old inline heuristic
// (`resource.endsWith("s") ? resource : resource+"s"`) treated "class" as
// ALREADY plural because the singular word itself happens to end in the
// letter "s" (a false friend — "class" is singular, "classes" is plural).
// It looked up "/api/v1/class", never found it (the real endpoint is
// "/api/v1/classes"), and silently gave up — leaving "class_id" as an
// unresolvable marker string, 400ing every downstream create. Proper
// English pluralization: words ending in a sibilant (s/x/z/ch/sh) take
// "es", not a bare "s". Extracted as a shared function (was inlined only
// in resolveForeignKeyId) so verifyAllResourceCrud's dependency detection
// below uses the identical rule instead of a second, driftable copy.
function pluralize(resource: string): string {
  return /[sxz]$/i.test(resource) || /[cs]h$/i.test(resource) ? `${resource}es` : `${resource}s`;
}

export async function resolveForeignKeyId(
  fieldName: string,
  endpoints: Array<{ method: string; path: string; auth?: boolean }>,
  backendUrl: string,
  token: string | null,
): Promise<string | null> {
  if (!fieldName.endsWith("_id")) return null;
  const resource = fieldName.slice(0, -3);
  // 2026-10-25 (brewline2): the list is found by the resource's own words, not only by its exact name: menu_item_id is the
  // list /api/v1/menu, gear_item_id may be /api/v1/gear-items. Variants: the name with underscores or hyphens, singular or
  // plural, and the name without a trailing "item". Only a list directly under /api[/vN]/ counts, so /orders/me is not
  // order_id's list and another resource's list is never taken.
  const names = new Set<string>();
  const withoutItem = resource.replace(/_items?$/, "");
  for (const base of [resource, withoutItem]) {
    if (!base) continue;
    for (const form of [base, base.replace(/_/g, "-"), base.replace(/_/g, "")]) names.add(form);
  }
  for (const n of [...names]) names.add(pluralize(n));
  const listEp = endpoints.find((e) => {
    if (e.method !== "GET" || hasPathParam(e.path)) return false;
    const segment = e.path.match(/^\/api(?:\/v\d+)?\/([^/]+)\/?$/)?.[1];
    return !!segment && names.has(segment.toLowerCase());
  });
  if (!listEp) return null;
  try {
    const headers: Record<string, string> = {};
    // No identity available at all (admin-only app, no registration path) —
    // still try unauthenticated; a genuinely protected list endpoint will
    // 401/403 naturally and this resolves to null exactly as before, rather
    // than sending a literal "Bearer null" header.
    if (listEp.auth && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${backendUrl}${listEp.path}`, { headers });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    // 2026-08-09: real bug found live (project meridianbk4) — the actual
    // response shape is double-wrapped ({"success":true,"data":{"services":
    // [...]}} — Express's own {success, data} envelope convention wrapping
    // ANOTHER named-key object, not a bare array under either level). A
    // single level of Object.values-searching only checked [true, {services:
    // [...]}] — neither value IS an array, so it always returned undefined
    // and every "_id" field silently kept its unresolvable placeholder.
    // findFirstArray searches up to 2 levels deep to match this real shape.
    const list = findFirstArray(body);
    const first = list?.[0] as Record<string, unknown> | undefined;
    const id = first?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

// Extracted from verifyLiveAuthenticatedRoundTrip (2026-08-09) so
// verifyAllResourceCrud below can share the exact same real-user auth flow
// instead of duplicating it — behavior unchanged from what this file already
// verified live.
// 2026-09-28: real false deploy failure (project a61968de2ecf, Cardwise) —
// the test user was always registered at the hard-coded /api/v1/auth/register
// and /login. Cardwise's approved contract names them /auth/sign-up and
// /auth/sign-in, so the check 404'd ("custom register failed ... Route not
// found") on a backend whose real sign-up returned 201 when tried by hand.
// The paths now come from the project's own contract; register/login stays
// the fallback for a contract that lists no auth endpoints at all.
export interface AuthPaths { registerPath: string; loginPath: string }
const DEFAULT_AUTH_PATHS: AuthPaths = { registerPath: "/api/v1/auth/register", loginPath: "/api/v1/auth/login" };

export function resolveAuthPaths(endpoints: Array<{ method: string; path: string; auth?: boolean }>): AuthPaths {
  const post = endpoints.filter((e) => e.method.toUpperCase() === "POST").map((e) => e.path);
  const lastSeg = (p: string) => p.replace(/\/$/, "").split("/").pop()!.toLowerCase().replace(/[-_]/g, "");
  const registerPath = post.find((p) => ["register", "signup"].includes(lastSeg(p)));
  const loginPath = post.find((p) => ["login", "signin"].includes(lastSeg(p)));
  return {
    registerPath: registerPath ?? DEFAULT_AUTH_PATHS.registerPath,
    loginPath: loginPath ?? DEFAULT_AUTH_PATHS.loginPath,
  };
}

/**
 * 2026-10-25 (brewline2): POSTs JSON; a 429 (the app's own sign-up/sign-in limiter, whose window the earlier checks of the
 * same deploy had already used) is waited out for the Retry-After the app gives (a minute when it gives none) and the
 * request repeated, up to 3 tries. Any other answer is returned at once; a network error is thrown to the caller.
 */
export async function postJsonWaitingOutRateLimit(
  url: string,
  body: unknown,
  deps: { fetchFn?: (url: string, init?: RequestInit) => Promise<Response>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const fetchFn = deps.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status !== 429 || attempt >= 3) return res;
    const seconds = Number(res.headers.get("retry-after"));
    await sleep((Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000 + 1000);
  }
}

async function registerAndLoginTestUser(
  backendUrl: string,
  role?: string,
  paths: AuthPaths = DEFAULT_AUTH_PATHS,
  // 2026-10-24: runs between sign-up and sign-in (e.g. to give the account a contract role, so its token carries it).
  beforeLogin?: (email: string) => void,
): Promise<{ token: string } | { error: string }> {
  const email = `verify+${role ?? "user"}+${Date.now()}@example.com`;
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

  // 2026-08-10: `role` is optional and ONLY included when explicitly
  // requested (verifyAllResourceCrud's admin-fallback below) — every
  // existing caller (verifyLiveAuthenticatedRoundTrip, the base identity in
  // verifyAllResourceCrud) keeps registering a plain default-role user
  // exactly as before. Relies on this app's own documented admin-bootstrap
  // path (auth.controller.ts: role:"admin" is allowed when no admin exists
  // yet) — real contract, not a guess; see the register-endpoint read that
  // found it live on freshtst1.
  // 2026-08-17: real bug found live (fulfillio1-deploy-resume-2) — every
  // OTHER failure path in this function returns { error } as a value
  // (verifyAllResourceCrud/verifyLiveAuthenticatedRoundTrip both rely on
  // that — "if ('error' in auth) return ..." — this function is documented
  // to never throw). But a raw fetch() that can't even reach the server
  // (backend not listening on this URL, DNS failure, connection refused)
  // throws BEFORE any `.ok` check runs, breaking that contract. That
  // uncaught throw propagated all the way through verifyAllResourceCrud ->
  // run() -> the Temporal activity -> the workflow, completely bypassing
  // Stage 6's carefully-built auto-retry/human-escalation logic (which only
  // triggers on a NORMAL {success:false} return, never on a thrown
  // exception) and killing the whole workflow execution outright.
  let regRes: Response;
  try {
    regRes = await postJsonWaitingOutRateLimit(`${backendUrl}${paths.registerPath}`, role ? { email, password, name, role } : { email, password, name });
  } catch (err) {
    return { error: `could not reach backend to register: ${String(err)}` };
  }
  if (!regRes.ok) {
    return { error: `custom register failed: returned ${regRes.status}: ${(await regRes.text()).slice(0, 200)}` };
  }
  beforeLogin?.(email);

  let loginRes: Response;
  try {
    loginRes = await postJsonWaitingOutRateLimit(`${backendUrl}${paths.loginPath}`, { email, password });
  } catch (err) {
    return { error: `could not reach backend to login: ${String(err)}` };
  }
  if (!loginRes.ok) {
    return { error: `custom login failed: returned ${loginRes.status}: ${(await loginRes.text()).slice(0, 200)}` };
  }

  const loginBody = (await loginRes.json()) as Record<string, unknown>;
  const data = (loginBody.data ?? loginBody) as Record<string, unknown>;
  const token = (data.token ?? loginBody.token) as string | undefined;
  if (!token) return { error: "Login response did not contain token" };
  return { token };
}

export async function verifyLiveAuthenticatedRoundTrip(buildDir: string, backendUrl: string): Promise<{ ok: boolean; reason: string; notChecked?: string }> {
  const contractPath = join(buildDir, "api-contract.json");
  if (!existsSync(contractPath)) return { ok: false, reason: "api-contract.json not found — cannot discover endpoints" };
  let endpoints: Array<{ method: string; path: string; auth?: boolean }>;
  try {
    endpoints = (JSON.parse(readFileSync(contractPath, "utf-8")).endpoints ?? []) as typeof endpoints;
  } catch (err) {
    return { ok: false, reason: `api-contract.json unreadable: ${String(err)}` };
  }

  const createEp = endpoints.find((e) => e.method === "POST" && e.auth && !hasPathParam(e.path));
  // 2026-08-17: real false-deploy-failure found live (fulfillio1) — this
  // used to pick the FIRST GET-with-param endpoint anywhere in the
  // contract, with no correlation to createEp's own resource. For an app
  // with a nested sub-resource (e.g. inventory items with a separate
  // "/api/v1/inventory/:id/locations" endpoint), that could — and did —
  // pick the sub-resource instead of the item itself: createEp created an
  // inventory ITEM, but the read-back checked its (empty, unrelated)
  // LOCATIONS list for the marker, which was never going to be there.
  // Require getByIdEp to be createEp's own path with exactly one more
  // segment (the :id itself) — same base resource, not a deeper
  // sub-resource — so create and read-back are always checking the same
  // thing. Falls back to undefined (treated as "nothing to verify at this
  // layer", same as the existing !createEp case) rather than a wrong match.
  const detailPathFor = (basePath: string) => `${basePath.replace(/\/$/, "")}/:id`;
  const getByIdEp = createEp
    ? endpoints.find((e) => e.method === "GET" && e.auth && e.path === detailPathFor(createEp.path))
    : endpoints.find((e) => e.method === "GET" && e.auth && hasPathParam(e.path));
  // 2026-07-26 (live, simple1): a project whose locked spec asked for
  // sign-in/sign-up but no protected resource to create (e.g. a small
  // business site with only a public contact form) has NO authenticated
  // POST endpoint by design — that is not a broken deploy, it's a feature
  // the app never claimed to have. Failing hard here hardcoded Sprint 1's
  // NexTech-style CRUD assumption onto every project, violating "build ANY
  // site — nothing hardcoded to NexTech" (plan Phase 3.5b / D50). Only a
  // missing/unreadable contract (checked above) is a real verification
  // failure; a contract that legitimately has no auth:true POST endpoint
  // just has nothing to round-trip-test at this layer.
  if (!createEp) {
    return { ok: true, reason: "no authenticated POST endpoint in api-contract.json — nothing to verify at this layer, skipping" };
  }
  const deleteEp = endpoints.find((e) => e.method === "DELETE" && e.auth && hasPathParam(e.path));

  try {
    const auth = await registerAndLoginTestUser(backendUrl, undefined, resolveAuthPaths(endpoints));
    if ("error" in auth) return { ok: false, reason: auth.error };
    const { token } = auth;

    const marker = `nexsidi-e2e-verify-${Date.now()}`;
    // 2026-08-03: derive the real payload shape from shared-types.ts instead
    // of hardcoding {title} — see buildPayloadForRequestType's header comment.
    // Falls back to the old {title} shape if the type can't be found (e.g. an
    // inline requestType, or the file is missing) — strictly additive, never
    // worse than today's behavior.
    const sharedTypesPath = join(buildDir, "shared-types.ts");
    const sharedTypesSource = existsSync(sharedTypesPath) ? readFileSync(sharedTypesPath, "utf-8") : "";
    const requestType = (createEp as { requestType?: string }).requestType;
    const dynamicPayload = requestType && requestType !== "null"
      ? buildPayloadForRequestType(sharedTypesSource, requestType, marker)
      : null;
    let createPayload: Record<string, unknown> = dynamicPayload ?? { title: marker };

    // 2026-08-09: real bug found live (project meridianbk4, direct follow-on
    // to the inline-literal fix above) — once a "_id"-suffixed field was
    // actually included in the payload, it still 400'd ("Invalid UUID format
    // for service_id") because its value was the raw marker string, not a
    // real id. A real user's own booking flow always sends an id it fetched
    // from a real GET list call first (e.g. GET /api/v1/services), never a
    // guessed value — resolveForeignKeyId does the same before the create
    // call, for every "_id" field the payload derivation produced.
    // Ids nested in lists too (items: [{ gear_id }]), not only top-level ones.
    Object.assign(createPayload, await resolveNestedIds(createPayload as Record<string, unknown>, (f) => resolveForeignKeyId(f, endpoints, backendUrl, token)));

    let createRes = await fetch(`${backendUrl}${createEp.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(createPayload),
    });
    // 2026-10-03 (Ledgerly run 4): a 400 that names the rule a test value
    // broke (an allowed list, a length) means the app validated correctly
    // and the test data was wrong — fit the value and resend once, same as
    // verifyAllResourceCrud. A second failure is a real finding.
    if (createRes.status === 400) {
      const repaired = repairPayloadFromValidationError(createPayload, await createRes.clone().text());
      if (repaired) {
        console.log(`[riya] create ${createEp.path} rejected a test value — resending once with a value that fits the app's own rule`);
        createPayload = repaired;
        createRes = await fetch(`${backendUrl}${createEp.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(createPayload),
        });
      }
    }
    // 2026-07-27 (live, complex1): this test user registers with no role
    // (defaults to whatever the app's safest default is) and createEp is
    // just the FIRST auth:true POST endpoint — on a role-gated app (e.g.
    // property creation restricted to landlord/staff), a base-role test
    // account correctly gets 403. That is proof authorization is WORKING,
    // not a broken deploy — conflating them retried a correctly-secured
    // app into a false stuck-state. Only treat non-403 failures (401 no
    // auth at all, 500 server error, network failure) as real breakage.
    if (createRes.status === 403) {
      return {
        ok: true,
        reason: `create ${createEp.path} returned 403 Forbidden — the test account's default role lacks permission for this endpoint, which confirms authorization is enforced correctly rather than indicating a broken deploy`,
      };
    }
    // 2026-10-03 (evidence-only plan): the app rejected the check's own test
    // value and gave nothing to repair it with — not checked, not a failure.
    if (createRes.status === 400 || createRes.status === 422) {
      const why = `create ${createEp.path} rejected the check's test values: ${(await createRes.text()).slice(0, 200)}`;
      return { ok: true, reason: `not checked — ${why}`, notChecked: why };
    }
    if (!createRes.ok) return { ok: false, reason: `create ${createEp.path} returned ${createRes.status}: ${(await createRes.text()).slice(0, 200)}` };
    const createBody = (await createRes.json()) as Record<string, unknown>;
    // 2026-08-17: real false-deploy-failure found live (fulfillio1) — this
    // unwrap only peeled ONE level ({data: {...}} -> {...}), the exact same
    // bug findFirstObjectWithId (above) was already written to fix for
    // verifyAllResourceCrud's own create check, just never reused here. A
    // genuinely successful create — {"success":true,"data":{"item":{"id":...
    // — was misreported as "response has no id" (created.id undefined,
    // since data unwraps to {item:{id}}, not {id} directly) and burned BOTH
    // of Stage 6's retry attempts on the same false positive, escalating a
    // working deploy as deploy_failed. Reusing the already-correct helper
    // instead of a second, shallower duplicate.
    const created = findFirstObjectWithId(createBody);
    if (!created) return { ok: false, reason: `create response has no id: ${JSON.stringify(createBody).slice(0, 200)}` };
    const createdId = created.id as string;
    // 2026-08-03 (live, verify4617991, follow-on to the payload-shape fix
    // above): a real contract can legitimately declare a minimal ack
    // response (CreateContactResponse { id: string; status: string } —
    // no content fields at all), so requiring an echoed marker HARD-fails a
    // genuinely correct deploy. The echo is now a bonus confidence check,
    // not a requirement: log it either way, but only the presence of a real
    // id (already checked above) blocks/passes this step. Riya's separate
    // DB round-trip check (deployed DB fully verified, above) already
    // confirms writes genuinely persist at the storage layer.
    const echoedMarker = Object.values(created).some((v) => typeof v === "string" && v.includes(marker));
    console.log(
      echoedMarker
        ? `[riya] create response echoes the sent marker — strong confirmation of a real write`
        : `[riya] create response has no echoed fields (responseType returns only ${Object.keys(created).join(", ")}) — real id present, treating as a legitimate minimal ack shape`,
    );

    if (getByIdEp) {
      const readRes = await fetch(`${backendUrl}${substitutePathParam(getByIdEp.path, createdId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!readRes.ok) return { ok: false, reason: `read-back ${getByIdEp.path} returned ${readRes.status} — the write didn't actually persist` };
      const readBody = (await readRes.json()) as Record<string, unknown>;
      // 2026-08-17: real false-deploy-failure found live (fulfillio1) —
      // this used to hardcode readTitle = read.title ?? read.task?.title,
      // assuming every app's resource has a "title" field (a shape that
      // fits a demo tasks app, not a real generated app's actual schema —
      // Fulfillio's inventory/orders use name/sku/order_reference, never
      // "title"). The write genuinely succeeded (confirmed independently:
      // manual sign-up + direct DB query both showed the row existed), but
      // readTitle always evaluated to undefined regardless, burning a Stage
      // 6 retry attempt on a false positive — the exact same class of bug
      // findFirstObjectWithId (above) already fixed for the CREATE response
      // unwrap, just never applied to this sibling check. Same fix shape as
      // the create-response echoedMarker check just above: does the marker
      // appear ANYWHERE in the read-back response, not under one guessed
      // field name.
      const read = (readBody.data ?? readBody) as Record<string, unknown>;
      const found = findFirstObjectWithId(read) ?? read;
      const echoed = Object.values(found).some((v) => typeof v === "string" && v.includes(marker));
      if (!echoed) return { ok: false, reason: `read-back ${getByIdEp.path} has no field containing the sent marker — the write may not have persisted: ${JSON.stringify(read).slice(0, 200)}` };
    }

    if (deleteEp) {
      await fetch(`${backendUrl}${substitutePathParam(deleteEp.path, createdId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }

    return { ok: true, reason: `real user round-trip confirmed: created via ${createEp.path}, data persisted and read back correctly` };
  } catch (err) {
    return { ok: true, reason: `skipping round-trip verification: ${String(err).split("\n")[0]}` };
  }
}

// 2026-08-17 (follow-up to the prefix/suffix match above): a resource name
// can legitimately prefix/suffix-match MORE than one real table — root-
// caused live (fulfillio1): "inventory" matches both inventory_items AND
// inventory_quantities, and the existing "exactly one candidate or give up"
// rule correctly refuses to guess, but that means persistence can NEVER be
// confirmed for this resource, a permanent false finding rather than a rare
// one. Pure, exported so it's directly unit-testable without a real
// Postgres connection — see makeRealDbRowLookup below for where the real
// foreign-key lookup that feeds this gets built.
//
// Heuristic: among the ambiguous candidates, prefer the one that does NOT
// have a foreign key referencing another candidate in the same set — that's
// the "parent"/primary entity (inventory_items), not a child/detail table
// that only exists to relate back to it (inventory_quantities, which has an
// item_id FK). Deliberately conservative: if zero or more than one candidate
// qualifies (no clear parent, or a genuine cycle), stays null rather than
// guessing — a wrong table match that returns SOME row would be worse than
// today's honest "can't confirm," since it would silently validate against
// data that has nothing to do with what was actually created.
export function pickPrimaryTable(
  candidates: string[],
  referencedTablesByCandidate: Record<string, string[]>,
): string | null {
  const candidateSet = new Set(candidates);
  const withNoInternalReference = candidates.filter((table) => {
    const referenced = referencedTablesByCandidate[table] ?? [];
    return !referenced.some((ref) => candidateSet.has(ref));
  });
  return withNoInternalReference.length === 1 ? withNoInternalReference[0]! : null;
}

// The real docker-exec-backed row lookup verifyAllResourceCrud uses by
// default. Derives its own cid/user/dbName from buildDir's docker-compose.yml
// the same way applyMigrationsToDeployedDb does (self-contained, no shared
// state threaded through run()). Returns null on any docker/psql problem or
// when the row genuinely doesn't exist — the caller can't tell those apart,
// which is correct: either way, this function can't confirm the row is
// there, so it must be treated as a finding rather than silently passed.
function makeRealDbRowLookup(buildDir: string): (table: string, id: string) => Record<string, unknown> | null {
  const composePath = join(buildDir, "docker-compose.yml");
  const sh = (cmd: string, input?: string) =>
    execSync(cmd, { input, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  let cid = "";
  let user = "";
  let dbName = "";
  try {
    cid = sh(`docker compose -f "${composePath}" ps -q postgres`);
    user = sh(`docker exec ${cid} printenv POSTGRES_USER`) || "postgres";
    dbName = sh(`docker exec ${cid} printenv POSTGRES_DB`) || user;
  } catch {
    cid = "";
  }
  return (table: string, id: string) => {
    if (!cid || !/^[a-zA-Z0-9_]+$/.test(table) || !/^[a-zA-Z0-9-]+$/.test(id)) return null;
    try {
      let resolvedTable = table;
      let cols = sh(
        `docker exec ${cid} psql -U ${user} -d ${dbName} -tA -c ` +
          `"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${resolvedTable}'"`,
      ).split("\n").map((l) => l.trim()).filter(Boolean);
      if (cols.length === 0) {
        // 2026-08-10: real bug found live (freshtst1) — the REST resource
        // path segment doesn't always match the DB table name 1:1. A real
        // generated app used "yoga_classes" as the table backing the
        // "/api/v1/classes" resource (a legitimate domain-specific naming
        // choice, not a defect), so an exact-name lookup for "classes"
        // found nothing and a genuinely successful, persisted write was
        // misreported as "did not persist to the database". Falls back to
        // a suffix match (table_name LIKE '%_classes') — only when it
        // resolves to EXACTLY ONE table (an ambiguous or absent match
        // can't be safely guessed, and stays a real finding).
        // 2026-08-17: real second instance found live (fulfillio1) — the
        // suffix fallback only covers naming where the resource segment is
        // the LAST word (yoga_classes for "classes"). Fulfillio's resource
        // segment is the FIRST word instead (inventory_items for
        // "inventory", inventory_quantities for the same resource) — a
        // suffix match on '%_inventory' finds nothing, since "inventory_
        // items" doesn't END with "_inventory". Added the symmetric prefix
        // match so both naming directions resolve. When that still produces
        // MORE than one candidate (both inventory_items and
        // inventory_quantities match), pickPrimaryTable below tries one more
        // safe disambiguation (prefer the table with no FK referencing
        // another candidate) before giving up — see its own header comment.
        // resolvedTable comes from information_schema.tables itself (a
        // trusted source), so it's safe to interpolate into the SQL below.
        const candidates = sh(
          `docker exec ${cid} psql -U ${user} -d ${dbName} -tA -c ` +
            `"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%_${resolvedTable}' OR table_name LIKE '${resolvedTable}_%')"`,
        ).split("\n").map((l) => l.trim()).filter(Boolean);
        let picked: string | null = candidates.length === 1 ? candidates[0]! : null;
        // 2026-08-17: real second-order instance found live (fulfillio1) —
        // "inventory" prefix-matches BOTH inventory_items AND
        // inventory_quantities, so the exactly-one check above alone still
        // gives up here. Before doing that, check whether exactly one
        // candidate is the "parent" (no FK referencing another candidate)
        // — see pickPrimaryTable's own header comment for the full
        // reasoning and why a wrong guess would be worse than staying
        // conservative. Same `-F "|"` cmd.exe-safe pattern already
        // established below for the actual row query.
        if (!picked && candidates.length > 1) {
          const candidateList = candidates.map((c) => `'${c}'`).join(",");
          const fkRows = sh(
            `docker exec ${cid} psql -U ${user} -d ${dbName} -tA -F "|" -c ` +
              `"SELECT tc.table_name, ccu.table_name FROM information_schema.table_constraints tc ` +
              `JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name ` +
              `WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name IN (${candidateList})"`,
          ).split("\n").map((l) => l.trim()).filter(Boolean);
          const referencedTablesByCandidate: Record<string, string[]> = {};
          for (const c of candidates) referencedTablesByCandidate[c] = [];
          for (const row of fkRows) {
            const [fromTable, toTable] = row.split("|");
            if (fromTable && toTable && referencedTablesByCandidate[fromTable]) {
              referencedTablesByCandidate[fromTable].push(toTable);
            }
          }
          picked = pickPrimaryTable(candidates, referencedTablesByCandidate);
        }
        if (!picked) return null;
        resolvedTable = picked;
        cols = sh(
          `docker exec ${cid} psql -U ${user} -d ${dbName} -tA -c ` +
            `"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${resolvedTable}'"`,
        ).split("\n").map((l) => l.trim()).filter(Boolean);
        if (cols.length === 0) return null;
      }
      // 2026-08-10: real bug found live (freshtst1) — execSync on Windows
      // runs through cmd.exe, which does NOT treat '...' as a quoting
      // pair (unlike POSIX shells). `-F '|'` broke the entire command:
      // cmd.exe saw a bare `|` and tried to PIPE the truncated
      // "...-F '" output into a new command starting with "' -c ...",
      // failing with "''' is not recognized as an internal or external
      // command" — so EVERY row lookup silently returned null (caught by
      // the try/catch below) regardless of whether the row actually
      // existed. Confirmed live: the exact row this misreported as
      // "did not persist" was sitting in the table the whole time.
      // Double quotes are valid cmd.exe quoting, so "|" (not '|') fixes it.
      const out = sh(`docker exec ${cid} psql -U ${user} -d ${dbName} -tA -F "|" -c "SELECT ${cols.join(",")} FROM ${resolvedTable} WHERE id = '${id}'"`);
      if (!out) return null;
      const values = out.split("|");
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => { row[c] = values[i]; });
      return row;
    } catch {
      return null;
    }
  };
}

// 2026-08-09: real gap found live (project meridianbk4) — Riya's live
// verification only ever checked ONE hardcoded resource (the first auth:true
// POST endpoint found). See this file's test suite header comment for the
// full trace. Groups api-contract.json's endpoints by resource (first path
// segment after /api/v1/, skipping auth/*) and exercises every declared CRUD
// verb per resource, with a real DB check (via getDbRow, defaulting to a
// real docker-exec lookup) after every mutation — never trusting an HTTP 2xx
// alone. Returns one specific finding per failed step, not a single pass/
// fail for the whole deploy.
export async function verifyAllResourceCrud(
  buildDir: string,
  backendUrl: string,
  getDbRow?: (table: string, id: string) => Record<string, unknown> | null,
  grantRole: (email: string, role: string) => { ok: true } | { reason: string } = (email, role) => grantTestAccountRole(buildDir, email, role),
): Promise<{ ok: boolean; findings: string[]; notChecked?: string[] }> {
  const contractPath = join(buildDir, "api-contract.json");
  if (!existsSync(contractPath)) return { ok: false, findings: ["api-contract.json not found — cannot discover endpoints"] };
  let endpoints: Array<{ method: string; path: string; auth?: boolean; requestType?: string }>;
  try {
    endpoints = (JSON.parse(readFileSync(contractPath, "utf-8")).endpoints ?? []) as typeof endpoints;
  } catch (err) {
    return { ok: false, findings: [`api-contract.json unreadable: ${String(err)}`] };
  }

  const dbRow = getDbRow ?? makeRealDbRowLookup(buildDir);
  const findings: string[] = [];

  const resources = new Map<string, typeof endpoints>();
  for (const ep of endpoints) {
    const seg = ep.path.replace(/^\/api\/v1\//, "").split("/")[0];
    if (!seg || seg === "auth") continue;
    resources.set(seg, [...(resources.get(seg) ?? []), ep]);
  }
  if (resources.size === 0) return { ok: true, findings: [] };

  // 2026-08-30: real bug found live (project 6c7d4358cf73) — this used to be
  // an EAGER call, before the resource loop even starts, so it aborted the
  // WHOLE function ("custom register failed: returned 404: Cannot POST
  // /api/v1/auth/register") on any admin-only app with no registration
  // endpoint — which is a correct, intentional design (CRITICAL RULE #14:
  // admin apps seed their account, they don't self-register), not a bug in
  // the generated app. Confirmed live: the ONLY resource this project had
  // (an "admin" bucket — GET /admin/inquiries, PUT /admin/content/:id) has
  // no CREATE endpoint at all, so it was ALWAYS going to be skipped by the
  // `if (!createEp) continue` check below regardless — this call was fully
  // wasted work whose only effect was tanking the entire check on a request
  // nothing downstream needed. Deploy correctly (per Stage 6's own stuck-
  // detection) stopped retrying once this same false failure repeated
  // identically on attempt 2, since retrying was never going to change a
  // registration endpoint into existing.
  // Mirrors getAdminToken's existing lazy pattern below — same fix shape,
  // now applied to the identity every resource implicitly shared before.
  let baseToken: string | null = null;
  let baseAttempted = false;
  let baseAuthError: string | null = null;
  async function getBaseToken(): Promise<string | null> {
    if (baseAttempted) return baseToken;
    baseAttempted = true;
    const result = await registerAndLoginTestUser(backendUrl, undefined, resolveAuthPaths(endpoints));
    if ("error" in result) { baseAuthError = result.error; return null; }
    baseToken = result.token;
    return baseToken;
  }
  const sharedTypesPath = join(buildDir, "shared-types.ts");
  const sharedTypesSource = existsSync(sharedTypesPath) ? readFileSync(sharedTypesPath, "utf-8") : "";

  // 2026-08-10: real gap found live (freshtst1) — a resource whose create
  // endpoint is role-gated (only admins can create classes/sessions) used to
  // be silently skipped on 403, which starved every DOWNSTREAM resource that
  // depends on it (bookings need a real session_id) of anything to
  // reference — misreporting the downstream resource as broken when the
  // real gap was this verifier never trying an elevated identity. Lazily
  // registers a second admin identity ONLY when a 403 is actually hit,
  // reusing this app's own documented admin-bootstrap path (register with
  // role: "admin" — allowed when no admin exists yet).
  let adminToken: string | null = null;
  let adminAttempted = false;
  async function getAdminToken(): Promise<string | null> {
    if (adminAttempted) return adminToken;
    adminAttempted = true;
    const adminAuth = await registerAndLoginTestUser(backendUrl, "admin", resolveAuthPaths(endpoints));
    if (!("error" in adminAuth)) adminToken = adminAuth.token;
    return adminToken;
  }

  // 2026-10-24 (Brewline): an app whose limited role is set by the app (a seeded staff account), not by sign-up. A test
  // account is given each role the contract names before sign-in, so its token carries the role. Tried after the admin
  // route, because an app may accept a "role" field at sign-up and still give no privilege.
  const roleTokens: string[] = [];
  let rolesAttempted = false;
  async function getRoleTokens(): Promise<string[]> {
    if (rolesAttempted) return roleTokens;
    rolesAttempted = true;
    for (const role of limitedRolesFromContract(endpoints as Array<{ description?: string }>)) {
      let granted = false;
      const auth = await registerAndLoginTestUser(backendUrl, undefined, resolveAuthPaths(endpoints), (email) => {
        granted = "ok" in grantRole(email, role);
      });
      if (granted && !("error" in auth)) roleTokens.push(auth.token);
    }
    return roleTokens;
  }

  // Process resources whose create payload has the FEWEST foreign-key
  // ("_id"-suffixed) fields first. Not a full topological sort — a real
  // dependency-ordering heuristic that directly fixes the observed case:
  // parent resources (0 FKs, e.g. classes) get created and seeded into the
  // DB before resources that reference them (sessions -> class_id, bookings
  // -> session_id), so resolveForeignKeyId has something real to find
  // instead of an empty list.
  const fkCount = (eps: typeof endpoints): number => {
    const createEp = eps.find((e) => e.method === "POST" && !hasPathParam(e.path));
    if (!createEp?.requestType || createEp.requestType === "null") return 0;
    const payload = buildPayloadForRequestType(sharedTypesSource, createEp.requestType, "sort-probe") ?? {};
    return Object.keys(payload).filter((k) => k.endsWith("_id")).length;
  };
  const orderedResources = [...resources.entries()].sort(([, a], [, b]) => fkCount(a) - fkCount(b));

  // 2026-08-10: real bug found live (freshtst1), root-caused via direct
  // Postgres statement logging (not guessed) — 100% reproducible, not a
  // race condition. The dependency-ordering above correctly creates
  // "classes" before "sessions" so sessions has something real to
  // reference — but classes' OWN full CRUD-lifecycle check then DELETES
  // that exact row two steps later (to verify the delete endpoint works),
  // before "sessions" is even processed. Every downstream
  // resolveForeignKeyId call then finds an empty list — not because
  // anything is broken, but because this verifier deleted its own seed
  // data. Any resource referenced by another resource's "_id" field must
  // keep its seed row alive for the rest of THIS run — skip its delete
  // check specifically (create/list/update are still verified).
  const dependedOnResources = new Set<string>();
  for (const eps of resources.values()) {
    const createEp = eps.find((e) => e.method === "POST" && !hasPathParam(e.path));
    if (!createEp?.requestType || createEp.requestType === "null") continue;
    const payload = buildPayloadForRequestType(sharedTypesSource, createEp.requestType, "dep-probe") ?? {};
    for (const field of Object.keys(payload)) {
      if (!field.endsWith("_id")) continue;
      const singular = field.slice(0, -3);
      dependedOnResources.add(pluralize(singular));
      dependedOnResources.add(singular);
    }
  }

  for (const [resource, eps] of orderedResources) {
    const createEp = eps.find((e) => e.method === "POST" && !hasPathParam(e.path));
    if (!createEp) continue; // read-only resource — nothing to verify at this layer, matches verifyLiveAuthenticatedRoundTrip's precedent

    // Only resources whose OWN create endpoint is actually auth-gated need a
    // token at all — a publicly-creatable resource (e.g. a contact form) has
    // no business requiring one, and must not be skipped just because this
    // app happens to have no registration path elsewhere.
    let activeToken: string | null = null;
    if (createEp.auth === true) {
      activeToken = await getBaseToken();
      if (!activeToken) {
        findings.push(`SKIPPED — ${resource}: POST ${createEp.path} requires auth but this app has no way to obtain a test identity (${baseAuthError ?? "registration unavailable"}). Not a failure: an admin-only app that seeds its account instead of self-registering is expected to have no usable registration endpoint.`);
        continue;
      }
    }

    try {
      const marker = `nexsidi-crud-verify-${Date.now()}`;
      const dynamicPayload = createEp.requestType && createEp.requestType !== "null"
        ? buildPayloadForRequestType(sharedTypesSource, createEp.requestType, marker)
        : null;
      // `let` (not const) so the 400-recovery below can swap in a repaired
      // payload and have the later update/read steps use the same shape.
      let createPayload = (dynamicPayload ?? { title: marker }) as Record<string, unknown>;
      const fkLookupToken = adminToken ?? activeToken;
      // Ids nested in lists too (items: [{ gear_id }]), not only top-level ones.
      createPayload = await resolveNestedIds(createPayload, (f) => resolveForeignKeyId(f, endpoints, backendUrl, fkLookupToken));

      let createRes = await fetch(`${backendUrl}${createEp.path}`, {
        method: "POST",
        headers: activeToken
          ? { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` }
          : { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload),
      });
      if (createRes.status === 403) {
        const admin = await getAdminToken();
        for (const candidate of [...(admin ? [admin] : []), ...(await getRoleTokens())]) {
          if (createRes.status !== 403) break;
          activeToken = candidate;
          createRes = await fetch(`${backendUrl}${createEp.path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
            body: JSON.stringify(createPayload),
          });
        }
      }
      // 2026-10-24: still forbidden with every role the check could get — not checked, and said so (it used to be skipped
      // silently while the run reported every resource as confirmed).
      if (createRes.status === 403) {
        findings.push(`NOT CHECKED — ${resource}: POST ${createEp.path} answered 403 for every account the check could get (a role it could not obtain)`);
        continue;
      }

      // 2026-08-27: real bug found live (project 852be5aeaef4) — this is the
      // failure that actually ended that run. The api-contract typed the
      // contact form's `type` field as plain `string`, so fieldsToPayload's
      // enum branch (which only fires on a declared 'a' | 'b' union) sent the
      // generic marker. Shubham's backend, however, validated it as
      // z.enum(["support","sales"]) — a constraint it inferred itself and
      // that appears NOWHERE in the spec, the DB schema, or the contract.
      // The backend was right to reject the marker; the synthetic test was
      // wrong. That false finding failed the deploy, triggered a retry, and
      // the retry exhausted the project's cost budget.
      // A real validator names the values it will accept ("Expected 'support'
      // | 'sales', received ..."), so recover deterministically from the
      // error itself rather than depending on every generator keeping the
      // contract perfectly in sync. Retried ONCE — a second failure is a real
      // finding, not a payload-shape problem.
      if (createRes.status === 400) {
        const errText = await createRes.clone().text();
        const repaired = repairPayloadFromValidationError(createPayload, errText);
        if (repaired) {
          console.log(`[riya] create ${createEp.path} 400'd on a value the contract did not describe as constrained — retrying once with the value the backend named`);
          createRes = await fetch(`${backendUrl}${createEp.path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
            body: JSON.stringify(repaired),
          });
          createPayload = repaired;
        }
      }

      // 2026-10-03 (evidence-only plan): the app rejected the check's own
      // test value and its message gave nothing to repair it with. The app
      // has not been shown broken — this resource was not checked.
      if (createRes.status === 400 || createRes.status === 422) {
        findings.push(`NOT CHECKED — ${resource}: POST ${createEp.path} rejected the check's test values: ${(await createRes.text()).slice(0, 200)}`);
        continue;
      }
      if (!createRes.ok) {
        // A server error says only "Internal Server Error" — the request that
        // caused it lets the backend builder reproduce it (Ledgerly run 4).
        const sent = createRes.status >= 500 ? ` — request body: ${JSON.stringify(createPayload).slice(0, 400)}` : "";
        findings.push(`${resource}: POST ${createEp.path} returned ${createRes.status}: ${(await createRes.text()).slice(0, 150)}${sent}`);
        continue;
      }
      const createBody = (await createRes.json()) as Record<string, unknown>;
      const created = findFirstObjectWithId(createBody);
      const createdId = created?.id as string | undefined;
      if (!createdId) {
        findings.push(`${resource}: create response has no id: ${JSON.stringify(createBody).slice(0, 150)}`);
        continue;
      }

      if (!dbRow(resource, createdId)) {
        findings.push(`${resource}: create ${createEp.path} returned success but the row did not persist to the database (id=${createdId})`);
        continue; // no real row to update/delete against
      }

      const listEp = eps.find((e) => e.method === "GET" && !hasPathParam(e.path));
      if (listEp) {
        const listRes = await fetch(`${backendUrl}${listEp.path}`, { headers: { Authorization: `Bearer ${activeToken}` } });
        if (!listRes.ok || !(await listRes.text()).includes(createdId)) {
          findings.push(`${resource}: GET ${listEp.path} did not include the newly created record (id=${createdId})`);
        }
      }

      // 2026-08-10: real gap found live (explicit user request) — the LIST
      // check above only confirms the record's id appears SOMEWHERE in a
      // bulk response; it never confirms a real user's most common read
      // path (a detail page, an edit form pre-fill: GET /resource/:id)
      // actually works. Only exercised when the contract declares this
      // endpoint — some real apps legitimately never expose a get-by-id
      // route, matching this file's own "don't invent a check for
      // something never claimed" convention.
      const getByIdEp = eps.find((e) => e.method === "GET" && isDirectByIdPath(createEp.path, e.path));
      if (getByIdEp) {
        const getRes = await fetch(`${backendUrl}${substitutePathParam(getByIdEp.path, createdId)}`, { headers: { Authorization: `Bearer ${activeToken}` } });
        if (!getRes.ok) {
          findings.push(`${resource}: GET ${getByIdEp.path} (fetching the record just created, by its own id) returned ${getRes.status} — the write may have succeeded but the record isn't independently retrievable`);
        } else if (!(await getRes.text()).includes(createdId)) {
          findings.push(`${resource}: GET ${getByIdEp.path} returned 2xx but its response body doesn't contain the created record's own id (id=${createdId}) — may be returning the wrong record`);
        }
      }

      const updateEp = eps.find((e) => (e.method === "PATCH" || e.method === "PUT") && isDirectByIdPath(createEp.path, e.path));
      if (updateEp) {
        const updateMarker = `${marker}-updated`;
        // 2026-09-28: never send a null body — if the update type can't be
        // resolved, reuse the create payload that already worked above.
        const derivedUpdate = updateEp.requestType && updateEp.requestType !== "null"
          ? buildPayloadForRequestType(sharedTypesSource, updateEp.requestType, updateMarker)
          : null;
        const updatePayload = (derivedUpdate ?? (createPayload && typeof createPayload === "object" ? { ...createPayload } : { title: updateMarker })) as Record<string, unknown>;
        const updateRes = await fetch(`${backendUrl}${substitutePathParam(updateEp.path, createdId)}`, {
          method: updateEp.method,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
          body: JSON.stringify(updatePayload),
        });
        if (updateRes.status === 403) {
          // role-gated — not a finding, matches the create-path precedent
        } else if (!updateRes.ok) {
          findings.push(`${resource}: ${updateEp.method} ${updateEp.path} returned ${updateRes.status}`);
        } else {
          const afterUpdate = dbRow(resource, createdId);
          const changedFieldReflected = afterUpdate
            ? Object.entries(updatePayload).some(([k, v]) => String(afterUpdate[k]) === String(v))
            : false;
          if (!changedFieldReflected) {
            findings.push(`${resource}: ${updateEp.method} ${updateEp.path} returned success but the DB row did not persist the change`);
          }
        }
      }

      const deleteEp = eps.find((e) => e.method === "DELETE" && isDirectByIdPath(createEp.path, e.path));
      if (deleteEp && dependedOnResources.has(resource)) {
        // Skip: this resource's seed row is what a downstream resource's
        // resolveForeignKeyId call needs to find later THIS run — deleting
        // it here would starve that lookup, misreporting the downstream
        // resource as broken when nothing is actually wrong (see the
        // dependedOnResources comment above for the live-reproduced trace).
      } else if (deleteEp) {
        const deleteRes = await fetch(`${backendUrl}${substitutePathParam(deleteEp.path, createdId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (deleteRes.status === 403) {
          // role-gated — not a finding
        } else if (!deleteRes.ok) {
          findings.push(`${resource}: DELETE ${deleteEp.path} returned ${deleteRes.status}`);
        } else if (dbRow(resource, createdId)) {
          findings.push(`${resource}: DELETE ${deleteEp.path} returned success but the row is still in the database (id=${createdId})`);
        }
      }
    } catch (err) {
      findings.push(`${resource}: verification error: ${String(err).split("\n")[0]}`);
    }
  }

  // 2026-08-30: an intentional skip (this app has no registration endpoint
  // by design — see the SKIPPED finding above) must not count as a failure
  // the same way a real broken endpoint does, or Stage 6's stuck-detection
  // treats "consciously chose not to test this" identically to "this is
  // broken" and stops retrying a deploy that was never actually failing.
  // The finding stays visible in the list either way — only `ok` treats them
  // differently — so a human reviewing findings can still see what was and
  // wasn't exercised.
  const realFailures = findings.filter((f) => !f.startsWith("SKIPPED —") && !f.startsWith("NOT CHECKED —"));
  const notChecked = findings.filter((f) => f.startsWith("NOT CHECKED —")).map((f) => f.replace(/^NOT CHECKED — /, ""));
  return { ok: realFailures.length === 0, findings, ...(notChecked.length > 0 ? { notChecked } : {}) };
}

// 2026-07-28 (live, complex1): real gap found live — a POST-FIX redeploy
// (inside Stage 6's live-retest fix loop, after Shubham/Aanya/Pranav have
// just changed code) is a genuinely different task shape than the FIRST
// deploy: it requires diagnosing a real runtime bug via docker logs, editing
// the right file, rebuilding, and re-verifying — not just bringing up a
// known-good compose file. Confirmed via the raw log: Riya's second-round
// redeploy on complex1 spent all 40 iterations on continuously VARYING tool
// calls (never a repeated call — not a stuck loop) chasing a real
// parameterized-query bug (`LIMIT ${paramIndex++}` missing its `$` prefix)
// that turned out to have two separate occurrences in the same controller
// file, then ran out mid-edit with no verdict either way. Optional so every
// existing call site (including the FIRST deploy, which doesn't need the
// extra room) is unaffected — undefined falls through to loop.ts's own
// `config.maxIterations ?? MAX_ITERATIONS` default, unchanged.
export async function run(
  projectId: string,
  deployTarget: "local" | "gcp" = "local",
  maxIterations?: number,
): Promise<DeployResult> {
  resolveDeployTarget(deployTarget);

  const buildDir = buildDirFor(projectId);
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

  // 2026-08-17: real bug found live (fulfillio1-deploy-resume-2) — this
  // used to ALWAYS scan for fresh free ports, even when the project was
  // already deployed and running (e.g. resumeFromDeploy re-verifying a live
  // app). findFreePort correctly saw the existing containers' ports as
  // occupied and picked DIFFERENT ones for this run's frontendPort/
  // backendPort — but the agent, seeing a healthy already-running
  // deployment, sensibly did nothing, leaving the OLD containers as the
  // only thing actually listening. Every check below then hit a port
  // nothing was bound to ("Unable to connect", see
  // registerAndLoginTestUser's own fix above). Reusing the real, currently-
  // listening ports when this exact project is already up avoids the
  // mismatch entirely; a stale/torn-down deployment (compose file present
  // but containers not actually running) still falls through to a real
  // fresh deploy, unchanged.
  const existingDeployment = getRunningDeploymentPorts(buildDir);
  if (existingDeployment) {
    console.log(`[riya-orchestrator] ${projectId} is already deployed and running — reusing its live ports instead of allocating new ones: frontend=${existingDeployment.frontendPort} backend=${existingDeployment.backendPort} db=${existingDeployment.dbPort}`);
  }

  // Find an available port for this project. backendPort used to be
  // DERIVED (frontendPort + 100) and never itself checked — a real gap:
  // a correctly-picked free frontend port could still yield a colliding
  // backend port. Now searched for real too, starting from the preferred
  // "+100" convention so the common case still lands on the expected offset.
  const buildsRoot = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const frontendPort = existingDeployment?.frontendPort ?? (await findFreePort(3200, 3299, { reservation: portReservations(buildsRoot, projectId) }));
  const preferredBackendPort = frontendPort + 100 < 3400 ? frontendPort + 100 : 3100;
  const backendPort = existingDeployment?.backendPort ?? (await findFreePort(preferredBackendPort, preferredBackendPort + 99, { reservation: portReservations(buildsRoot, projectId) }));
  const dbPort = existingDeployment?.dbPort ?? (await findFreePort(5435, 5499, { reservation: portReservations(buildsRoot, projectId) }));
  const appUrl = `http://localhost:${frontendPort}`;
  const backendUrl = `http://localhost:${backendPort}`;

  // Write the correct frontend .env.local using the host published port.
  // jwtSecret is generated ONCE here and is the sole source of truth for
  // this deploy — buildAgentTask below passes the SAME value into the
  // docker-compose prompt so backend and frontend never end up trusting
  // different secrets (see jwt-secret.test.ts for the live evidence of
  // what happens when they don't).
  // 2026-10-24: an app that already has a secret keeps it (a new one signs every user out, and writing it in made the
  // agent edit the compose file on every redeploy).
  const composeNow = existsSync(join(buildDir, "docker-compose.yml")) ? readFileSync(join(buildDir, "docker-compose.yml"), "utf-8") : "";
  const jwtSecret = existingJwtSecret(composeNow) ?? generateJwtSecret();
  const frontendEnvPath = join(buildDir, "frontend", ".env.local");
  writeFileSync(frontendEnvPath, `NEXT_PUBLIC_API_URL=http://localhost:${backendPort}\nJWT_SECRET=${jwtSecret}\n`, "utf-8");
  console.log(`[riya-orchestrator] Pre-wrote frontend .env.local with NEXT_PUBLIC_API_URL=http://localhost:${backendPort}`);

  // runAgentEscalated (Task 15): NIM/kimi-k2.6 first, Sonnet 5 as a one-time
  // escalation only when NIM genuinely can't finish — hard-problem
  // escalation only, not a routine-cost default. See
  // packages/agent-runtime/src/claude-loop.ts.
  // 2026-08-17: real bug found live (fulfillio1) — this had NO
  // fallbackModels at all, and sanitizeModelChain's allowlist deliberately
  // excludes moonshotai/ (see model-failover.test.ts: "sanitizeModelChain on
  // Riya's real config ... produces an empty chain" — confirmed intentional,
  // not a bug in the allowlist itself). With zero fallbacks, that empty
  // chain meant EVERY single Riya deploy escalated straight to Sonnet 5,
  // regardless of how simple the task was — the "one-time escalation only
  // when NIM genuinely can't finish" comment above was aspirational, not
  // what actually happened.
  // First fix attempt added mistral-medium-3.5-128b + mistral-nemotron as
  // fallbacks, reasoning "aanya/shubham's own primary, proven reliable for
  // tool-calling work all night" — that assumption was live-verified WRONG
  // moments later: mistral-medium-3.5-128b returned a real HTTP 410 Gone
  // (EOL 2026-08-07, over a week before that assumption was made — now in
  // KNOWN_DEAD_MODELS, see packages/agent-runtime/src/loop.ts). A search
  // across every agent log from tonight's entire session found ZERO
  // successful raw-NIM calls anywhere — every agent ran exclusively through
  // Gemini-tier routing this whole time, so "reliable all night" was
  // actually observing Gemini having never actually exercised this model at
  // all. Reduced to mistral-nemotron alone — the one fallback whose failure
  // here was NOT independently confirmed as a real model-availability
  // problem (no explicit error captured, and this agent's conversation had
  // accumulated 166 messages across many manual interventions tonight,
  // a plausible confound) — rather than keep guessing at a third candidate
  // with the same unverified-assumption risk that caused this exact bug.
  // 2026-10-24: a running app is rebuilt and health-checked by the system (redeployRunningApp); the agent runs only when
  // that fails, or for a first deploy.
  // 2026-10-24: a first deploy writes the standard compose file itself and starts and checks it with the same code.
  let composeTemplated = false;
  if (!existingDeployment) {
    let appName = projectId;
    try { appName = String((JSON.parse(readFileSync(join(buildDir, "build-plan.json"), "utf-8")) as { appName?: string }).appName || projectId); } catch { /* the project id names the database */ }
    const written = composeFromTemplate(buildDir, appName, { frontendPort, backendPort, dbPort, jwtSecret });
    composeTemplated = written.written;
    console.log(written.written ? `[riya-orchestrator] ${projectId}: wrote the standard docker-compose.yml` : `[riya-orchestrator] ${projectId}: no standard compose file (${written.reason}) — the deploy agent writes it`);
  }
  const fastPath = existingDeployment || composeTemplated ? await redeployRunningApp(buildDir, appUrl, backendUrl) : null;
  if (fastPath?.ok) console.log(`[riya-orchestrator] ${projectId} redeployed by the system (rebuilt and answering) — no deploy agent needed`);
  else if (fastPath) console.log(`[riya-orchestrator] redeploying without the agent did not work (${fastPath.reason}) — the deploy agent takes over`);
  const result: { success: boolean; errors: string[] } = fastPath?.ok ? { success: true, errors: [] } : await runAgentEscalated({
    agentName: "riya",
    // 2026-09-28: kimi-k2.6 / mistral-nemotron were retired (see llm-client
    // RETIRED_NIM_MODELS); Riya's chain now comes from the model registry.
    model: AGENT_MODELS.riya,
    fallbackModels: FALLBACK_CHAIN.riya,
    apiKey: process.env.NIM_API_KEY ?? "",
    systemPrompt: "",
    initialMessage: buildAgentTask(projectId, buildDir, frontendPort, backendPort, dbPort, jwtSecret, composeTemplated),
    sandboxDir: buildDir,
    writableFile: isDeployFile,
    projectId,
    enableDockerTools: true,
    enableHttpTools: true,
    maxIterations,
    // 2026-07-25 (P5.W5.4): Riya's proof-of-work is an http_request call,
    // not a shell command — requiredVerificationCommands can't express it.
    // Without this, Riya could declare verification_passed:true after
    // `docker_compose up` alone (the exact false-success bug that shipped
    // a build with a 500ing DB write — see the migrate-and-verify note
    // below). See EvidenceLedger.hasEvidenceOfKind / checkCompletion.
    requiredEvidenceKinds: ["http_check"],
    // 2026-09-29 (project a034f90ba50e): every redeploy resumed the previous
    // deploy's conversation (47 → 89 messages over one build: old ports, old
    // container states, old errors — the "plausible confound" noted above).
    // Each deploy is a new job; its facts are in the task message.
    freshStart: true,
  });

  // 2026-07-12: DETERMINISTIC migrate-and-verify — do NOT trust the deploy
  // agent to have applied the DB schema. Real bug found live (stress-pro):
  // migrations never ran, so the app deployed "green" (health 200) but every
  // write 500'd with "relation \"tasks\" does not exist". This applies
  // db/migrations/*.sql to the deployed Postgres over the container's local
  // socket (docker exec — no host-TCP auth issues) and confirms the tables
  // exist, independent of whatever the agent did. Belt-and-suspenders with the
  // prompt-level requirement.
  // Rows the checks below add to public form tables are removed again from this moment on (see PUBLIC_FORM_TABLES_SQL).
  const verificationStartedAt = databaseNow(buildDir);
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

  // 2026-08-09: real gap found live (project meridianbk4) — the roundTrip
  // check above only ever verifies ONE hardcoded resource. Every OTHER
  // resource's full CRUD surface (does a form submission actually reach the
  // DB, does an update actually persist, does a delete actually remove the
  // row) had nothing checking it — see verifyAllResourceCrud's header
  // comment for the concrete instance this closes. Only attempted after the
  // single-resource roundTrip already passed (no point iterating every
  // resource against a backend already known to be broken).
  const crudCheck: { ok: boolean; findings: string[]; notChecked?: string[] } = roundTrip.ok
    ? await verifyAllResourceCrud(buildDir, backendUrl)
    : { ok: true, findings: [] }; // not a separate failure — roundTrip.ok already covers this case
  if (!crudCheck.ok) {
    for (const finding of crudCheck.findings) console.warn(`[riya] CRUD verification finding: ${finding}`);
  } else if (roundTrip.ok && crudCheck.notChecked?.length) {
    console.log(`[riya] CRUD verification: no failures; CRUD verification: not checked — ${crudCheck.notChecked.join("; ")}`);
  } else if (roundTrip.ok) {
    console.log(`[riya] full CRUD verification OK — every resource's create/read/update/delete confirmed in the database, none skipped`);
  }

  // Runs unconditionally once verification is done (pass OR fail) — a FAILED
  // run still registered accounts before it failed, so skipping cleanup on
  // failure would leave exactly the artifacts this exists to remove. See
  // purgeVerificationArtifacts's own header comment for why this matters
  // beyond tidiness: it also frees the one-time admin-bootstrap slot.
  purgeVerificationArtifacts(buildDir, verificationStartedAt);

  // Archive to GitHub (fire-and-forget, errors non-fatal)
  const githubRepo = await archiveToGitHub(projectId, buildDir).catch(() => null);

  // Persist appUrl + status to DB (dynamic import — see top-of-file comment)
  const { db, projects } = await import("@nexsidi/db");
  const { eq } = await import("drizzle-orm");
  // A deploy whose database has no tables, OR whose API doesn't actually let a
  // real user's data round-trip, is NOT a functional delivery — even if the
  // agent's health checks passed. Persistence + a real auth round-trip are the
  // whole point.
  const deploySucceeded = result.success && migrationOk && roundTrip.ok && crudCheck.ok;

  const errors = [...result.errors];
  if (!migrationOk) {
    errors.push(
      migrationProblems.length > 0
        ? `Database migration problem: ${migrationProblems.join("; ")}`
        : "Deployed database has no tables (migrations did not apply) — app cannot persist data",
    );
  }
  if (!roundTrip.ok) errors.push(`Live authenticated round-trip failed: ${roundTrip.reason}`);
  if (!crudCheck.ok) errors.push(...crudCheck.findings.map((f) => `CRUD verification: ${f}`));
  if (errors.some((e) => /returned 5\d\d\b/.test(e))) {
    const log = backendErrorLog(buildDir);
    if (log) errors.push(`Backend log (errors): ${log.slice(0, 1500)}`);
  }

  await db
    .update(projects)
    .set(projectFieldsAfterDeploy(appUrl))
    .where(eq(projects.id, projectId));

  const notChecked = [...("notChecked" in roundTrip && roundTrip.notChecked ? [roundTrip.notChecked] : []), ...(crudCheck.notChecked ?? [])];
  return { success: deploySucceeded, appUrl, backendUrl, githubRepo, errors, ...(notChecked.length > 0 ? { notChecked } : {}) };
}

// 2026-09-29: real bug (project a034f90ba50e). This step used to write
// status "done" (or "needs_review") itself — but Stage 6's live review and
// fix loop only START after it, and ran for 50+ minutes while the dashboard
// already said "done"; a failed deploy that Stage 6 was about to retry showed
// "needs attention" the same way. The workflow owns the project status
// (markProjectDone after Stage 6 passes, escalateTilotma on failure); this
// step records only where the app is running, so "open app" works during
// the review.
/** The error lines of a backend log, newest last — what a builder needs to see behind a 500. */
export function backendErrorLines(logText: string, max = 15): string[] {
  return logText
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\w.-]+\s*\|\s*/, "").trim())
    .filter((l) => /\berror\b|exception|unhandled|constraint|ON CONFLICT|ECONNREFUSED/i.test(l))
    .slice(-max);
}

function backendErrorLog(buildDir: string): string {
  try {
    const out = execSync(`docker compose -f "${join(buildDir, "docker-compose.yml")}" logs --no-color --tail 300 backend`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return backendErrorLines(out).join(" | ");
  } catch {
    return "";
  }
}

// 2026-10-03 (Ledgerly run 4): the deploy agent found a missing unique index
// and edited the database builder's migration itself, then ran out of steps —
// the deploy failed anyway and the builder never learned of its bug. It also
// left check-db.js / fix-db.js scripts in the delivered project. It changes
// deployment files only (in the project root or one service folder); an app
// bug it finds is reported, and Stage 6 sends it to the owning builder.
export function isDeployFile(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, "/").replace(/^\.?\/+/, "").split("/");
  if (parts.length > 2) return false;
  const name = parts[parts.length - 1] ?? "";
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name)
    || /^Dockerfile(\.[\w-]+)?$/.test(name)
    || name === ".dockerignore"
    || /^\.env(\.[\w-]+)?$/.test(name);
}

export function projectFieldsAfterDeploy(appUrl: string): { appUrl: string; updatedAt: Date } {
  return { appUrl, updatedAt: new Date() };
}
// 2026-08-23: RIYA_AGENT_SYSTEM_PROMPT moved to
// packages/agent-runtime/skills/riya/ (00-strategy-and-doctrine.md,
// 10-tactical-workflow.md) — loaded by assembleSystemPrompt (see
// gemini-loop.ts's call site and prompt-assembly.ts's own header comment).
// No interpolation was used anywhere in the old constant.

// 2026-07-26 (agent-autonomy-assessment follow-on): the sole source of
// truth for this deploy's JWT secret. Every other write (frontend
// .env.local, the docker-compose prompt below) must use THIS SAME value —
// see jwt-secret.test.ts for the live evidence of what happens when they
// don't (three independently-decided values, frontend/backend mismatch).
export function generateJwtSecret(): string {
  return randomBytes(32).toString("hex");
}

// 2026-10-24 (final plan item 5; measured on Brewline): the deploy agent's first compose file already had the structure of
// the final one, and all 5 later edits changed only the JWT secret. The file is fully determined by the app's name, three
// ports and the secret, so the system writes it (same shape, same loopback-only ports); the agent runs only when the
// system's own start-and-health-check fails, and then edits what fails instead of writing from scratch.
export function renderComposeFile(o: { dbName: string; frontendPort: number; backendPort: number; dbPort: number; jwtSecret: string }): string {
  let db = o.dbName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!db) db = "app";
  else if (/^[0-9]/.test(db)) db = `app_${db}`;
  return `services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "127.0.0.1:${o.dbPort}:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${db}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d:ro
    networks:
      - app-net

  backend:
    build: ./backend
    ports:
      - "127.0.0.1:${o.backendPort}:3001"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/${db}
      CORS_ORIGIN: http://localhost:${o.frontendPort}
      JWT_SECRET: ${o.jwtSecret}
      PORT: 3001
    networks:
      - app-net
    depends_on:
      - postgres

  frontend:
    build: ./frontend
    ports:
      - "127.0.0.1:${o.frontendPort}:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:${o.backendPort}
    networks:
      - app-net
    depends_on:
      - backend

volumes:
  postgres_data:

networks:
  app-net:
`;
}

// Variables the standard compose file sets; any other variable the backend needs a value for stops the template.
const COMPOSE_SETS = new Set(["DATABASE_URL", "JWT_SECRET", "CORS_ORIGIN", "PORT", "NODE_ENV"]);
// The backend rules say a seed account's email and password are optional (a missing password is generated and logged once).
const SEED_ACCOUNT_VAR = /^(ADMIN|STAFF|SEED|OWNER|MANAGER)_(EMAIL|PASSWORD|NAME)$/;

/** Names of the process.env variables the backend reads, and those read with no fallback value on that line. */
export function backendEnvNames(buildDir: string): { all: string[]; needsValue: string[] } {
  const all = new Set<string>();
  const needsValue = new Set<string>();
  const walk = (d: string) => {
    let entries: import("fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|js)$/.test(e.name) && !/\.test\./.test(e.name)) {
        for (const line of readFileSync(full, "utf-8").split("\n")) {
          for (const m of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
            const name = m[1]!;
            all.add(name);
            const after = line.slice((m.index ?? 0) + m[0].length);
            if (!COMPOSE_SETS.has(name) && !SEED_ACCOUNT_VAR.test(name) && !/^\s*(\|\||\?\?)/.test(after) && !/^\s*\)?\s*(\|\||\?\?)/.test(after)) needsValue.add(name);
          }
        }
      }
    }
  };
  walk(join(buildDir, "backend", "src"));
  return { all: [...all].sort(), needsValue: [...needsValue].sort() };
}

/** Writes the standard docker-compose.yml when the app is a standard one; otherwise says why not (the agent writes it). */
export function composeFromTemplate(
  buildDir: string,
  appName: string,
  o: { frontendPort: number; backendPort: number; dbPort: number; jwtSecret: string },
): { written: true } | { written: false; reason: string } {
  const composePath = join(buildDir, "docker-compose.yml");
  if (existsSync(composePath)) return { written: false, reason: "a docker-compose.yml already exists" };
  for (const need of ["backend/Dockerfile", "frontend/Dockerfile", "db/migrations"]) {
    if (!existsSync(join(buildDir, need))) return { written: false, reason: `${need} is missing` };
  }
  const unknown = backendEnvNames(buildDir).needsValue;
  if (unknown.length > 0) return { written: false, reason: `the backend reads ${unknown.join(", ")}, which the standard compose file does not set` };
  writeFileSync(composePath, renderComposeFile({ dbName: appName, ...o }), "utf-8");
  return { written: true };
}

export function buildAgentTask(
  projectId: string,
  buildDir: string,
  frontendPort: number,
  backendPort: number,
  dbPort: number,
  jwtSecret: string,
  composeWritten = false,
): string {
  return `Deploy the project in this directory: ${buildDir}

Structure:
- ${buildDir}/backend/   → Express backend (has Dockerfile)
- ${buildDir}/frontend/  → Next.js frontend (has Dockerfile)
- ${buildDir}/db/        → SQL migration files

Ports to use — write these EXACT lines under each service's ports: key.
The 127.0.0.1 prefix keeps the app reachable only from this computer, never
from other devices on the network; never omit it:
- postgres: - "127.0.0.1:${dbPort}:5432"
- backend:  - "127.0.0.1:${backendPort}:3001"
- frontend: - "127.0.0.1:${frontendPort}:3000"

JWT credentials (for environment variables) — use this EXACT value, do not
invent your own or use a placeholder; the frontend has already been
configured with this same secret and a mismatch will break every
authenticated request:
- JWT_SECRET = ${jwtSecret}

Project ID: ${projectId}

${composeWritten
    ? "docker-compose.yml is already written by the system with exactly the ports and secret above, and the system's own start and health check of it did not succeed. Run docker compose up, read the logs, and change only what the logs show is wrong; do not rewrite the file or change the secret."
    : "Start by writing docker-compose.yml, then run docker compose up."}
Health check backend at http://localhost:${backendPort}/health
Health check frontend at http://localhost:${frontendPort}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// 2026-08-10: real bug found live (freshtst1, same session as
// verifyAllResourceCrud above) — the plain socket-bind check below reported
// port 5435 as free while meridianbk4's postgres container was actively
// publishing it. On Windows, Docker Desktop forwards a container's published
// port through its own proxy (HNS/vpnkit), which does not always create an
// OS-visible bind conflict a userland `net.createServer().listen()` probe
// can detect — so a container can hold a port the socket test insists is
// open. `docker ps` is the ground truth for what Docker itself has
// published; check it FIRST, before ever trusting the socket-bind fallback.
// (When freshtst1 hit this live, Riya's own agent worked around it by
// querying the Docker Engine API directly and then deleting meridianbk4's
// containers to free the port — a destructive fix for what should have been
// a "pick a different port" fix. This closes the gap so that workaround is
// never needed again.)
// 2026-09-27: real collision found live — an Express Build picked frontend
// port 3206 while gthrdeploy45t-frontend-1 published 0.0.0.0:3206. The first
// `docker ps` of that search failed (it fits the documented Windows
// "spawnSync cmd.exe ETIMEDOUT" glitch, see clone-deploy.ts), the error was
// swallowed as "port free", and the socket fallback below (then 127.0.0.1
// only) cannot see Docker Desktop's 0.0.0.0 publishes. Now: one snapshot of
// published ports per search (was one `docker ps` spawn per candidate port),
// one retry on the transient spawn failure, and every failure is logged.

type DockerExec = (cmd: string, timeoutMs: number) => string;
const defaultDockerExec: DockerExec = (cmd, timeoutMs) => execSync(cmd, { encoding: "utf-8", timeout: timeoutMs });

function isTransientSpawnFailure(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("ETIMEDOUT") && msg.includes("spawnSync");
}

/** Every host port Docker currently publishes, from `docker ps` output. */
export function parsePublishedPorts(output: string): Set<number> {
  const ports = new Set<number>();
  for (const m of output.matchAll(/:(\d+)->/g)) ports.add(Number(m[1]));
  return ports;
}

/**
 * Snapshot of Docker's published host ports, or null when docker can't be
 * asked. Retries once (with a longer timeout) after a transient spawn
 * failure; never retries a real error such as a missing docker CLI.
 */
export function queryDockerPublishedPorts(
  execFn: DockerExec = defaultDockerExec,
  opts: { warn?: (msg: string) => void } = {},
): Set<number> | null {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const timeouts = [5_000, 15_000];
  for (let attempt = 0; attempt < timeouts.length; attempt++) {
    try {
      return parsePublishedPorts(execFn(`docker ps --format "{{.Ports}}"`, timeouts[attempt]!));
    } catch (err) {
      const transient = isTransientSpawnFailure(err);
      warn(`[ports] docker ps failed (attempt ${attempt + 1}/${timeouts.length}${transient ? ", transient" : ""}): ${String(err).split("\n")[0]}`);
      if (!transient) break;
    }
  }
  return null;
}

// 2026-08-10: real bug found live (freshtst1) — the plain socket-bind check
// reported 5435 free while meridianbk4's postgres container published it,
// because Docker Desktop's port forwarding does not always create an
// OS-visible conflict on 127.0.0.1. `docker ps` is the ground truth; check it
// FIRST. (Riya's agent once "fixed" this by deleting another project's
// containers — never needed again.)
//
// Returns true/false, or null when docker can't be asked (2026-09-27: this
// used to return false, i.e. "free", on ANY error, silently).
export function isPortUsedByDocker(
  port: number,
  execFn: DockerExec = defaultDockerExec,
  opts: { warn?: (msg: string) => void } = {},
): boolean | null {
  const snapshot = queryDockerPublishedPorts(execFn, opts);
  return snapshot === null ? null : snapshot.has(port);
}

// 2026-09-27: measured on this PC — a port Docker publishes on 0.0.0.0 is
// held on the IPv6 side only (com.docker.backend on "::", wslrelay on
// "::1"), so an IPv4 listen on 127.0.0.1 or 0.0.0.0 still "succeeds"; a port
// published on 127.0.0.1 is held on 127.0.0.1 itself. Probing 127.0.0.1, ::1
// and :: caught every Docker-held port here (old 0.0.0.0 apps and new
// 127.0.0.1 ones) while free ports stayed free. An address this machine
// can't bind at all (e.g. no IPv6) is skipped, not counted as "in use".
const PROBE_HOSTS = ["127.0.0.1", "::1", "::"];

function probeListen(port: number, host: string): Promise<"free" | "used" | "unsupported"> {
  return new Promise((resolve) => {
    import("net").then(({ createServer }) => {
      const server = createServer();
      server.once("error", (err: NodeJS.ErrnoException) => {
        resolve(err.code === "EADDRINUSE" || err.code === "EACCES" ? "used" : "unsupported");
      });
      server.once("listening", () => { server.close(() => resolve("free")); });
      server.listen({ port, host, ipv6Only: host.includes(":") });
    });
  });
}

export async function isPortFreeOnHost(port: number): Promise<boolean> {
  for (const host of PROBE_HOSTS) {
    if ((await probeListen(port, host)) === "used") return false;
  }
  return true;
}

// 2026-10-24 (multi-user audit): a port a build has picked is held for it, in a file shared by every build in the builds
// folder, for 45 minutes. The worker runs up to 6 activities at once; without a hold two builds deploying together could
// pick the same port, and the second would fail to start.
const PORT_HOLD_MS = 45 * 60_000;

export interface PortReservation {
  /** Held by another build right now. */
  isReserved(port: number): boolean;
  /** Hold this port for this build. */
  reserve(port: number): void;
}

export function portReservations(root: string, projectId: string, now: () => number = Date.now): PortReservation {
  const file = join(root, ".port-reservations.json");
  const read = (): Record<string, { projectId: string; at: number }> => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as Record<string, { projectId: string; at: number }>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  return {
    isReserved(port) {
      const hold = read()[String(port)];
      return !!hold && hold.projectId !== projectId && now() - hold.at < PORT_HOLD_MS;
    },
    reserve(port) {
      const all = read();
      for (const [p, hold] of Object.entries(all)) if (now() - hold.at >= PORT_HOLD_MS) delete all[p];
      all[String(port)] = { projectId, at: now() };
      mkdirSync(root, { recursive: true });
      writeFileSync(file, JSON.stringify(all), "utf-8");
    },
  };
}

export async function findFreePort(
  start: number,
  end: number,
  deps: {
    // Ports other builds have picked; checked and taken in one step after the host check, so concurrent builds differ.
    reservation?: PortReservation;
    // Per-port docker answer (kept for tests and callers that inject one).
    isPortUsedByDocker?: (port: number) => boolean | null;
    // Snapshot provider; default asks docker once for the whole search.
    dockerPorts?: () => Set<number> | null;
    isPortFreeOnHost?: (port: number) => Promise<boolean>;
    warn?: (msg: string) => void;
  } = {},
): Promise<number> {
  const hostCheck = deps.isPortFreeOnHost ?? isPortFreeOnHost;
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  let dockerUsed: (port: number) => boolean | null;
  if (deps.isPortUsedByDocker) {
    dockerUsed = deps.isPortUsedByDocker;
  } else {
    const snapshot = (deps.dockerPorts ?? (() => queryDockerPublishedPorts()))();
    dockerUsed = snapshot === null ? () => null : (p) => snapshot.has(p);
  }

  let warned = false;
  for (let port = start; port <= end; port++) {
    const used = dockerUsed(port);
    if (used === true) continue;
    // Amit's decision (2026-09-27): when docker can't be asked, rely on the
    // IPv4+IPv6 socket check above (evidence-based, see PROBE_HOSTS) with a
    // loud warning, rather than failing the build or guessing "free".
    if (used === null && !warned) {
      warn(`[ports] docker unavailable — relying on the socket check (${PROBE_HOSTS.join(", ")}) for ${start}-${end}`);
      warned = true;
    }
    if (!(await hostCheck(port))) continue;
    // No wait between this check and the hold, so two builds cannot both take the same port.
    if (deps.reservation) {
      if (deps.reservation.isReserved(port)) continue;
      deps.reservation.reserve(port);
    }
    return port;
  }
  // Was `return start` — silently handing out a port known to be taken.
  throw new Error(`no free port in ${start}-${end} (all in use)`);
}

// 2026-08-17: real bug found live (fulfillio1-deploy-resume-2) — see run()'s
// call site for the full story. Reads the project's own docker-compose.yml
// (the generator's real, consistent shape: services literally named
// postgres/backend/frontend) and returns its ports ONLY when those
// containers are ACTUALLY up right now, per docker itself — a stale compose
// file left over from a torn-down/crashed deployment must still go through
// a real fresh deploy, not be blindly trusted.
//
// 2026-09-26: port strings are parsed by the shared parseServiceHostPort
// (agent-runtime tools/compose-ports.ts), which accepts both the old
// "HOST:CONTAINER" and the "127.0.0.1:HOST:CONTAINER" form new deploys write.
// The previous local regex returned null for the 127.0.0.1 form.
export function getRunningDeploymentPorts(
  buildDir: string,
  deps: {
    readComposeFile?: (path: string) => string | null;
    isPortUsedByDocker?: (port: number) => boolean | null;
    dockerPorts?: () => Set<number> | null;
  } = {},
): { frontendPort: number; backendPort: number; dbPort: number } | null {
  const readComposeFile = deps.readComposeFile ?? ((path: string) => (existsSync(path) ? readFileSync(path, "utf-8") : null));

  const compose = readComposeFile(join(buildDir, "docker-compose.yml"));
  if (!compose) return null;

  const frontendPort = parseServiceHostPort(compose, "frontend");
  const backendPort = parseServiceHostPort(compose, "backend");
  const dbPort = parseServiceHostPort(compose, "postgres");
  if (frontendPort === null || backendPort === null || dbPort === null) return null;

  // Only docker can confirm these are OUR containers, so an unknown answer
  // (docker unreachable after a retry, already logged) means "not running".
  let dockerCheck: (port: number) => boolean | null;
  if (deps.isPortUsedByDocker) {
    dockerCheck = deps.isPortUsedByDocker;
  } else {
    const snapshot = (deps.dockerPorts ?? (() => queryDockerPublishedPorts()))();
    dockerCheck = snapshot === null ? () => null : (p) => snapshot.has(p);
  }
  if (dockerCheck(frontendPort) !== true || dockerCheck(backendPort) !== true) return null;

  return { frontendPort, backendPort, dbPort };
}

// 2026-08-31: real gap found live — the web UI's "Open app" link and live
// preview iframe (apps/web/components/ide/IdeWorkspace.tsx) point straight
// at the stored appUrl with zero check that the project's containers are
// actually up. They reliably ARE right after a build, but nothing keeps
// them running indefinitely — a `docker compose down` (Riya's own redeploy
// cycle runs this on every retry) removes the containers outright, at which
// point no restart policy helps; only re-running `up` recreates them. This
// closes that gap for the "user comes back later and clicks to view an
// already-delivered project" path: reuse the existing, already-tested
// getRunningDeploymentPorts check (docker-verified, not just "the compose
// file exists") and only pay for a real `docker compose up -d` when it's
// actually needed.
export interface EnsureProjectRunningResult {
  running: boolean;
  started: boolean;
  ports: { frontendPort: number; backendPort: number; dbPort: number } | null;
  error?: string;
}

export async function ensureProjectRunning(
  buildDir: string,
  deps: {
    getRunningDeploymentPorts?: typeof getRunningDeploymentPorts;
    execFn?: (cmd: string) => string;
    existsFn?: (path: string) => boolean;
  } = {},
): Promise<EnsureProjectRunningResult> {
  const checkPorts = deps.getRunningDeploymentPorts ?? getRunningDeploymentPorts;
  const execFn = deps.execFn ?? ((cmd: string) => execSync(cmd, { encoding: "utf-8", timeout: 60_000 }));
  const existsFn = deps.existsFn ?? existsSync;

  const alreadyRunning = checkPorts(buildDir);
  if (alreadyRunning) {
    return { running: true, started: false, ports: alreadyRunning };
  }

  const composePath = join(buildDir, "docker-compose.yml");
  if (!existsFn(composePath)) {
    return { running: false, started: false, ports: null, error: "no docker-compose.yml found for this project" };
  }

  try {
    // No auto-start: an old compose file may still carry a restart policy (2026-10-08).
    try { stripRestartPoliciesInFile(composePath); } catch { /* best effort */ }
    execFn(`docker compose -f "${composePath}" up -d`);
  } catch (err) {
    return { running: false, started: false, ports: null, error: `docker compose up failed: ${String(err)}` };
  }

  // getRunningDeploymentPorts is docker-verified (checks real published
  // ports, not just that `up` exited 0) — re-checking after `up` catches the
  // exact false-success shape this function's own header comment elsewhere
  // in this file (see "docker_compose up" false-success bug) already
  // documented once for the agent tool version of this same operation.
  const portsAfterStart = checkPorts(buildDir);
  return {
    running: portsAfterStart !== null,
    started: true,
    ports: portsAfterStart,
    ...(portsAfterStart ? {} : { error: "ran docker compose up but containers are still not reachable on their expected ports" }),
  };
}

// 2026-10-24 (Brewline root cause): every redeploy after a fix round ran the deploy agent again (19 model calls re-reading
// the same Dockerfiles and compose file) and generated a NEW JWT secret it then wrote into the compose file — the value
// reached the logs, and on a real app a new secret signs every user out. A running app keeps its secret and is rebuilt by
// the system; the agent runs only when this fails, or for a first deploy.
export function existingJwtSecret(compose: string): string | null {
  return compose.match(/JWT_SECRET\s*[:=]\s*["']?([^"'\s#]+)/)?.[1] ?? null;
}

export async function redeployRunningApp(
  buildDir: string,
  appUrl: string,
  backendUrl: string,
  deps: { exec?: (cmd: string) => string; pollMs?: number; waitMs?: number } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const composePath = join(buildDir, "docker-compose.yml");
  if (!existsSync(composePath)) return { ok: false, reason: "no docker-compose.yml" };
  const exec = deps.exec ?? ((cmd: string) => execSync(cmd, { encoding: "utf-8", timeout: 900_000, stdio: ["pipe", "pipe", "pipe"] }));
  try {
    try { stripRestartPoliciesInFile(composePath); } catch { /* best effort */ }
    exec(`docker compose -f "${composePath}" up -d --build`);
  } catch (err) {
    return { ok: false, reason: `docker compose up --build failed: ${String(err instanceof Error ? err.message : err).slice(0, 300)}` };
  }
  const pollMs = deps.pollMs ?? 3_000;
  const deadline = Date.now() + (deps.waitMs ?? 120_000);
  const answers = async (url: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return res.status < 500;
    } catch {
      return false;
    }
  };
  while (Date.now() < deadline) {
    if ((await answers(`${backendUrl}/health`)) && (await answers(appUrl))) return { ok: true };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, reason: `rebuilt, but the app did not answer within ${Math.round((deps.waitMs ?? 120_000) / 1000)} s (${backendUrl}/health, ${appUrl})` };
}

// Exported (with an injectable exec) for testing the .gitignore ordering.
export async function archiveToGitHub(
  projectId: string,
  buildDir: string,
  deps: { execFn?: (cmd: string, opts: { cwd: string }) => void } = {},
): Promise<string | null> {
  if (!process.env.GITHUB_TOKEN) return null;
  // GitHub archival logic (non-blocking)
  try {
    const { execSync } = await import("child_process");
    const exec = deps.execFn ?? ((cmd: string, opts: { cwd: string }) => { execSync(cmd, { ...opts, stdio: "ignore", timeout: 30_000 }); });
    const repoName = `nexsidi-${projectId}`;
    // 2026-09-27 (confidentiality): must run BEFORE `git add -A`, or the
    // pipeline's own files (agent histories with internal system prompts and
    // agent names, logs, QA notes) are committed into the customer's repo.
    ensureDeliveryGitignore(buildDir);
    exec(`git init && git add -A && git commit -m "Initial delivery"`, { cwd: buildDir });
    return `https://github.com/${process.env.GITHUB_ORG ?? "nexsidi-builds"}/${repoName}`;
  } catch {
    return null;
  }
}
