// Riya — DevOps agent (real agentic mode)
// Writes docker-compose.yml, runs docker compose up, reads logs if it fails,
// makes HTTP health check, fixes compose/Dockerfile and retries.
// Agent ACTS via tools — no one-shot generation.

import { runAgentEscalated } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
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
function fieldsToPayload(body: string, marker: string): Record<string, unknown> | null {
  const fieldRegex = /(\w+)\??\s*:\s*([^;]+);/g;
  const payload: Record<string, unknown> = {};
  let match: RegExpExecArray | null;
  let foundAny = false;
  while ((match = fieldRegex.exec(body)) !== null) {
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
    if (lowerName.includes("email")) payload[fieldName] = `verify+${marker}@example.com`;
    else if (type.includes("number")) payload[fieldName] = 1;
    else if (type.includes("boolean")) payload[fieldName] = true;
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
    else payload[fieldName] = marker;
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
  const trimmed = typeName.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    // fieldsToPayload's regex requires a trailing ";" per field — an inline
    // literal's last field has none before the closing "}" (unlike a named
    // interface's body, which always does; see fieldsToPayload's own
    // callers). Append one so the last field isn't silently dropped.
    let body = trimmed.slice(1, -1).trim();
    if (body && !body.endsWith(";")) body += ";";
    return fieldsToPayload(body, marker);
  }
  const typeMatch = sharedTypesSource.match(new RegExp(`interface\\s+${typeName}\\s*\\{([^}]*)\\}`));
  if (!typeMatch) return null;
  return fieldsToPayload(typeMatch[1] ?? "", marker);
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
function findFirstObjectWithId(value: unknown, depth = 2): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === "string") return obj;
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
  token: string,
): Promise<string | null> {
  if (!fieldName.endsWith("_id")) return null;
  const resource = fieldName.slice(0, -3);
  const pluralResource = pluralize(resource);
  const candidatePaths = new Set([`/api/v1/${pluralResource}`, `/api/v1/${resource}`]);
  const listEp = endpoints.find((e) => e.method === "GET" && !hasPathParam(e.path) && candidatePaths.has(e.path));
  if (!listEp) return null;
  try {
    const headers: Record<string, string> = {};
    if (listEp.auth) headers.Authorization = `Bearer ${token}`;
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
async function registerAndLoginTestUser(backendUrl: string, role?: string): Promise<{ token: string } | { error: string }> {
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
    regRes = await fetch(`${backendUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(role ? { email, password, name, role } : { email, password, name }),
    });
  } catch (err) {
    return { error: `could not reach backend to register: ${String(err)}` };
  }
  if (!regRes.ok) {
    return { error: `custom register failed: returned ${regRes.status}: ${(await regRes.text()).slice(0, 200)}` };
  }

  let loginRes: Response;
  try {
    loginRes = await fetch(`${backendUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
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

export async function verifyLiveAuthenticatedRoundTrip(buildDir: string, backendUrl: string): Promise<{ ok: boolean; reason: string }> {
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
    const auth = await registerAndLoginTestUser(backendUrl);
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
    const createPayload = dynamicPayload ?? { title: marker };

    // 2026-08-09: real bug found live (project meridianbk4, direct follow-on
    // to the inline-literal fix above) — once a "_id"-suffixed field was
    // actually included in the payload, it still 400'd ("Invalid UUID format
    // for service_id") because its value was the raw marker string, not a
    // real id. A real user's own booking flow always sends an id it fetched
    // from a real GET list call first (e.g. GET /api/v1/services), never a
    // guessed value — resolveForeignKeyId does the same before the create
    // call, for every "_id" field the payload derivation produced.
    for (const [fieldName, value] of Object.entries(createPayload)) {
      if (!fieldName.endsWith("_id") || typeof value !== "string") continue;
      const resolved = await resolveForeignKeyId(fieldName, endpoints, backendUrl, token);
      if (resolved) (createPayload as Record<string, unknown>)[fieldName] = resolved;
    }

    const createRes = await fetch(`${backendUrl}${createEp.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(createPayload),
    });
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
): Promise<{ ok: boolean; findings: string[] }> {
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

  const auth = await registerAndLoginTestUser(backendUrl);
  if ("error" in auth) return { ok: false, findings: [auth.error] };
  const { token } = auth;
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
    const adminAuth = await registerAndLoginTestUser(backendUrl, "admin");
    if (!("error" in adminAuth)) adminToken = adminAuth.token;
    return adminToken;
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

    try {
      const marker = `nexsidi-crud-verify-${Date.now()}`;
      const dynamicPayload = createEp.requestType && createEp.requestType !== "null"
        ? buildPayloadForRequestType(sharedTypesSource, createEp.requestType, marker)
        : null;
      const createPayload = (dynamicPayload ?? { title: marker }) as Record<string, unknown>;
      const fkLookupToken = adminToken ?? token;
      for (const [fieldName, value] of Object.entries(createPayload)) {
        if (!fieldName.endsWith("_id") || typeof value !== "string") continue;
        const resolved = await resolveForeignKeyId(fieldName, endpoints, backendUrl, fkLookupToken);
        if (resolved) createPayload[fieldName] = resolved;
      }

      let activeToken = token;
      let createRes = await fetch(`${backendUrl}${createEp.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
        body: JSON.stringify(createPayload),
      });
      if (createRes.status === 403) {
        const admin = await getAdminToken();
        if (admin) {
          activeToken = admin;
          createRes = await fetch(`${backendUrl}${createEp.path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
            body: JSON.stringify(createPayload),
          });
        }
      }
      if (createRes.status === 403) continue; // still forbidden even as admin (or no admin available) — genuinely role-gated, not broken
      if (!createRes.ok) {
        findings.push(`${resource}: POST ${createEp.path} returned ${createRes.status}: ${(await createRes.text()).slice(0, 150)}`);
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
      const getByIdEp = eps.find((e) => e.method === "GET" && hasPathParam(e.path));
      if (getByIdEp) {
        const getRes = await fetch(`${backendUrl}${substitutePathParam(getByIdEp.path, createdId)}`, { headers: { Authorization: `Bearer ${activeToken}` } });
        if (!getRes.ok) {
          findings.push(`${resource}: GET ${getByIdEp.path} (fetching the record just created, by its own id) returned ${getRes.status} — the write may have succeeded but the record isn't independently retrievable`);
        } else if (!(await getRes.text()).includes(createdId)) {
          findings.push(`${resource}: GET ${getByIdEp.path} returned 2xx but its response body doesn't contain the created record's own id (id=${createdId}) — may be returning the wrong record`);
        }
      }

      const updateEp = eps.find((e) => (e.method === "PATCH" || e.method === "PUT") && hasPathParam(e.path));
      if (updateEp) {
        const updateMarker = `${marker}-updated`;
        const updatePayload = (updateEp.requestType && updateEp.requestType !== "null"
          ? buildPayloadForRequestType(sharedTypesSource, updateEp.requestType, updateMarker)
          : { title: updateMarker }) as Record<string, unknown>;
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

      const deleteEp = eps.find((e) => e.method === "DELETE" && hasPathParam(e.path));
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

  return { ok: findings.length === 0, findings };
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

  const buildDir = join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId);
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
  const frontendPort = existingDeployment?.frontendPort ?? (await findFreePort(3200, 3299));
  const preferredBackendPort = frontendPort + 100 < 3400 ? frontendPort + 100 : 3100;
  const backendPort = existingDeployment?.backendPort ?? (await findFreePort(preferredBackendPort, preferredBackendPort + 99));
  const dbPort = existingDeployment?.dbPort ?? (await findFreePort(5435, 5499));
  const appUrl = `http://localhost:${frontendPort}`;
  const backendUrl = `http://localhost:${backendPort}`;

  // Write the correct frontend .env.local using the host published port.
  // jwtSecret is generated ONCE here and is the sole source of truth for
  // this deploy — buildAgentTask below passes the SAME value into the
  // docker-compose prompt so backend and frontend never end up trusting
  // different secrets (see jwt-secret.test.ts for the live evidence of
  // what happens when they don't).
  const jwtSecret = generateJwtSecret();
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
  const result = await runAgentEscalated({
    agentName: "riya",
    model: "moonshotai/kimi-k2.6",
    fallbackModels: ["mistralai/mistral-nemotron"],
    apiKey: process.env.NIM_API_KEY ?? "",
    systemPrompt: RIYA_AGENT_SYSTEM_PROMPT,
    initialMessage: buildAgentTask(projectId, buildDir, frontendPort, backendPort, dbPort, jwtSecret),
    sandboxDir: buildDir,
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

  // 2026-08-09: real gap found live (project meridianbk4) — the roundTrip
  // check above only ever verifies ONE hardcoded resource. Every OTHER
  // resource's full CRUD surface (does a form submission actually reach the
  // DB, does an update actually persist, does a delete actually remove the
  // row) had nothing checking it — see verifyAllResourceCrud's header
  // comment for the concrete instance this closes. Only attempted after the
  // single-resource roundTrip already passed (no point iterating every
  // resource against a backend already known to be broken).
  const crudCheck = roundTrip.ok
    ? await verifyAllResourceCrud(buildDir, backendUrl)
    : { ok: true, findings: [] }; // not a separate failure — roundTrip.ok already covers this case
  if (!crudCheck.ok) {
    for (const finding of crudCheck.findings) console.warn(`[riya] CRUD verification finding: ${finding}`);
  } else if (roundTrip.ok) {
    console.log(`[riya] full CRUD verification OK — every resource's create/read/update/delete confirmed against the real database`);
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
  const deploySucceeded = result.success && migrationOk && roundTrip.ok && crudCheck.ok;

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
  if (!crudCheck.ok) errors.push(...crudCheck.findings.map((f) => `CRUD verification: ${f}`));

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

// 2026-07-26 (agent-autonomy-assessment follow-on): the sole source of
// truth for this deploy's JWT secret. Every other write (frontend
// .env.local, the docker-compose prompt below) must use THIS SAME value —
// see jwt-secret.test.ts for the live evidence of what happens when they
// don't (three independently-decided values, frontend/backend mismatch).
export function generateJwtSecret(): string {
  return randomBytes(32).toString("hex");
}

export function buildAgentTask(
  projectId: string,
  buildDir: string,
  frontendPort: number,
  backendPort: number,
  dbPort: number,
  jwtSecret: string,
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

JWT credentials (for environment variables) — use this EXACT value, do not
invent your own or use a placeholder; the frontend has already been
configured with this same secret and a mismatch will break every
authenticated request:
- JWT_SECRET = ${jwtSecret}

Project ID: ${projectId}

Start by writing docker-compose.yml, then run docker compose up.
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
export function isPortUsedByDocker(
  port: number,
  execFn: (cmd: string) => string = (cmd) => execSync(cmd, { encoding: "utf-8", timeout: 5000 }),
): boolean {
  try {
    const output = execFn(`docker ps --format "{{.Ports}}"`);
    return new RegExp(`:${port}->`).test(output);
  } catch {
    // docker CLI unreachable/not installed — fall through to the socket
    // check alone rather than treating "can't ask docker" as "port is used".
    return false;
  }
}

async function isPortFreeOnHost(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    import("net").then(({ createServer }) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => { server.close(() => resolve(true)); });
      server.listen(port, "127.0.0.1");
    });
  });
}

export async function findFreePort(
  start: number,
  end: number,
  deps: {
    isPortUsedByDocker?: (port: number) => boolean;
    isPortFreeOnHost?: (port: number) => Promise<boolean>;
  } = {},
): Promise<number> {
  const dockerCheck = deps.isPortUsedByDocker ?? isPortUsedByDocker;
  const hostCheck = deps.isPortFreeOnHost ?? isPortFreeOnHost;
  for (let port = start; port <= end; port++) {
    if (dockerCheck(port)) continue;
    if (await hostCheck(port)) return port;
  }
  return start; // Fallback — every port in range genuinely occupied
}

// 2026-08-17: real bug found live (fulfillio1-deploy-resume-2) — see run()'s
// call site for the full story. Reads the project's own docker-compose.yml
// (the generator's real, consistent shape: services literally named
// postgres/backend/frontend, "HOST:CONTAINER" port strings — confirmed
// against the actual generated file) and returns its ports ONLY when those
// containers are ACTUALLY up right now, per docker itself — a stale compose
// file left over from a torn-down/crashed deployment must still go through
// a real fresh deploy, not be blindly trusted.
export function getRunningDeploymentPorts(
  buildDir: string,
  deps: {
    readComposeFile?: (path: string) => string | null;
    isPortUsedByDocker?: (port: number) => boolean;
  } = {},
): { frontendPort: number; backendPort: number; dbPort: number } | null {
  const readComposeFile = deps.readComposeFile ?? ((path: string) => (existsSync(path) ? readFileSync(path, "utf-8") : null));
  const dockerCheck = deps.isPortUsedByDocker ?? isPortUsedByDocker;

  const compose = readComposeFile(join(buildDir, "docker-compose.yml"));
  if (!compose) return null;

  const portFor = (service: string): number | null => {
    // Bounded by the next line that starts with EXACTLY 2 spaces + a
    // non-space char (the next top-level service key) or end of string —
    // NOT just "the next line with 2+ leading spaces", which would match
    // this service's own nested keys (e.g. "    image:", 4 spaces) and
    // truncate the block before its ports ever appear.
    const blockMatch = compose.match(new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n {2}\\S|$)`));
    if (!blockMatch) return null;
    const m = blockMatch[1].match(/-\s*"(\d+):\d+"/);
    return m ? Number(m[1]) : null;
  };

  const frontendPort = portFor("frontend");
  const backendPort = portFor("backend");
  const dbPort = portFor("postgres");
  if (frontendPort === null || backendPort === null || dbPort === null) return null;

  if (!dockerCheck(frontendPort) || !dockerCheck(backendPort)) return null;

  return { frontendPort, backendPort, dbPort };
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
