// Arjun — Pipeline lead + planner
// ProjectSpec → full BuildPlan: API contract, DB schema, independent task lists.
// Uses Mistral Nemotron via NIM.
// D22: ambitious — not minimal. D23: sprint contracts in files before code starts.

import { agentChat } from "@nexsidi/llm-client";
import { hashContext } from "@nexsidi/context-chain";
import type { ProjectSpec, Feature } from "../../saanvi/src/index.ts";
import { run as runVanya, type DesignBrief } from "../../vanya/src/index.ts";
import { mkdirSync } from "fs";
import { join } from "path";

// ── Output types ──────────────────────────────────────────────────────────────
export interface RestEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;           // e.g. /api/v1/tasks/:id
  description: string;
  auth: boolean;
  requestType: string;    // TypeScript interface/type literal
  responseType: string;   // TypeScript interface/type literal
  errorCodes: number[];
}

export interface DrizzleColumn {
  name: string;
  drizzleType: string;    // e.g. uuid(), text(), timestamp()
  constraints: string[];  // e.g. ".primaryKey()", ".notNull()", ".default(sql`now()`)"
  references?: string;    // e.g. "users.id"
}

export interface DrizzleTable {
  name: string;
  columns: DrizzleColumn[];
  indexes: string[];      // drizzle index() expressions
}

export interface GeneratorTask {
  description: string;
  outputFiles: string[];  // relative paths the agent must produce
}

export interface BuildPlan {
  projectId: string;
  appName: string;              // display name — copied from ProjectSpec.name, not LLM-produced
  appDescription: string;       // copied from ProjectSpec.description, not LLM-produced
  // 2026-07-24 (P3.W3.1): Vanya's concrete design brief (palette, typeface
  // pairing, layout concept, mood) — replaces Aanya's prior sole reliance
  // on appDescription (a one-paragraph requirements summary, not a design
  // decision) for its "APP-SPECIFIC VISUAL IDENTITY" prompt section.
  designBrief: DesignBrief;
  // 2026-08-04: root-caused live (verify4617991) — BuildPlan is the ONLY
  // artifact handed to the generators, and it had no field for the spec's
  // requirements. Saanvi's spec named all 9 requested services; the plan
  // carried only a 9-word task label ("Implement Services and Products
  // catalog pages") and two filenames, so the delivered site shipped 4.
  // Aanya's prompt even says "show real content from the project spec"
  // while never receiving that spec. Copied verbatim from ProjectSpec.features
  // (not LLM-produced) so requirements cannot be lost or paraphrased here.
  features: Feature[];
  sharedTypes: string;          // TypeScript type declarations shared by frontend + backend
  apiContract: {
    baseUrl: "http://localhost:3001";
    endpoints: RestEndpoint[];
  };
  dbSchema: {
    tables: DrizzleTable[];
  };
  shubhamTasks: GeneratorTask[];
  aanyaTasks: GeneratorTask[];
  pranavTasks: GeneratorTask[];
  independenceVerified: boolean;
  buildPlanHash: string;        // SHA-256 — verified by each generator before starting
}

export interface ArjunDeps {
  chat: typeof agentChat;
  // 2026-07-24 (P3.W3.1): injectable so run()'s existing tests (and any
  // future ones) can stub Vanya's design-brief call independently of
  // Arjun's own plan-generation `chat` — without this, every caller that
  // stubs only `chat` would still trigger a REAL, unmocked runVanya(spec)
  // network call. Defaults to the real Vanya agent.
  runVanya?: typeof runVanya;
}

// ── Locked page type (from the planner's simple build-plan) ──────────────────
export interface LockedPage {
  name: string;
  path: string;
  description: string;
  nextjsFile: string;   // pre-computed in TypeScript — Arjun copies verbatim, never derives
}

// Convert a URL path to the exact Next.js App Router file path.
// Done in code (deterministic) so the LLM never has to guess the mapping.
export function pathToNextjsFile(urlPath: string): string {
  if (urlPath === "/") return "app/page.tsx";
  // Auth routes get the route group wrapper (auth) for the middleware layout
  if (/^\/(sign-?in)$/i.test(urlPath)) return "app/(auth)/sign-in/page.tsx";
  if (/^\/(sign-?up)$/i.test(urlPath)) return "app/(auth)/sign-up/page.tsx";
  // Everything else: /about → app/about/page.tsx
  const clean = urlPath.replace(/\/+$/, ""); // strip trailing slash
  return `app${clean}/page.tsx`;
}

// ── Main entry ────────────────────────────────────────────────────────────────
// `deps` is injectable (defaults to the real agentChat) for the same reason
// as Saanvi's run() — see agents/saanvi/src/index.ts's SaanviDeps comment.
//
// When `lockedPages` is provided (always the case when triggered from the
// planner chat), Arjun runs in ANNOTATION MODE: the page list is final and
// he annotates it with auth/middleware info, then derives API contract, DB
// schema, and tasks from those fixed pages. He does NOT invent a page list.
export async function run(
  spec: ProjectSpec,
  deps: ArjunDeps = { chat: agentChat },
  lockedPages?: LockedPage[],
  authType?: string,
): Promise<BuildPlan> {
  const apiKey = process.env.NIM_API_KEY ?? "";

  const useAnnotationMode = Array.isArray(lockedPages) && lockedPages.length > 0;
  const systemPrompt = useAnnotationMode ? ARJUN_ANNOTATION_PROMPT : ARJUN_SYSTEM_PROMPT;
  const userContent = useAnnotationMode
    ? JSON.stringify({ lockedPages, authType: authType ?? "none", spec }, null, 2)
    : JSON.stringify(spec, null, 2);

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent },
  ];

  // A7 (full-system audit): one retry on empty/unparseable response before
  // giving up — see Saanvi's identical fix for the full rationale
  // (stress-test run 9 crashed the whole pipeline on one empty response).
  let rawResult: unknown;
  try {
    const { content } = await deps.chat("arjun", messages, apiKey);
    rawResult = parseJson(content);
  } catch (firstErr) {
    console.log(`[arjun] first attempt failed (${String(firstErr)}) — retrying once`);
    const { content } = await deps.chat("arjun", messages, apiKey);
    rawResult = parseJson(content);
  }
  const raw = rawResult as Omit<BuildPlan, "projectId" | "buildPlanHash" | "designBrief">;

  // 2026-07-24 (P3.W3.1): design identity is independent of Arjun's own
  // API-contract/task-decomposition JSON call — a slow/failed Vanya call
  // must not fail the whole plan (design has its own two-retry-then-
  // fallback contract inside run() already; this just invokes it).
  const designBrief = await (deps.runVanya ?? runVanya)(spec);

  // Contract security gate (RC-1): sanitize endpoints FIRST, then use that
  // same sanitized list to also clean any named shared-type interface a
  // public endpoint references — see sanitizeSharedTypesForPublicEndpoints'
  // header comment for why both are needed.
  const sanitizedEndpoints = sanitizePublicEndpointContracts(
    Array.isArray(raw.apiContract?.endpoints) ? raw.apiContract.endpoints : [],
  );
  const rawSharedTypes = typeof raw.sharedTypes === "string" ? raw.sharedTypes : "";

  const plan: Omit<BuildPlan, "buildPlanHash"> = {
    projectId: spec.projectId,
    appName: spec.name,
    appDescription: spec.description,
    designBrief,
    // Copied straight from the locked spec — never LLM-regenerated, so the
    // planner cannot drop or paraphrase a requirement on the way through.
    features: Array.isArray(spec.features) ? spec.features : [],
    sharedTypes: sanitizeSharedTypesForPublicEndpoints(rawSharedTypes, sanitizedEndpoints),
    apiContract: {
      baseUrl: "http://localhost:3001",
      endpoints: sanitizedEndpoints,
    },
    dbSchema: {
      tables: Array.isArray(raw.dbSchema?.tables) ? raw.dbSchema.tables : [],
    },
    shubhamTasks:        Array.isArray(raw.shubhamTasks)        ? raw.shubhamTasks        : [],
    aanyaTasks:          Array.isArray(raw.aanyaTasks)          ? raw.aanyaTasks          : [],
    pranavTasks:         Array.isArray(raw.pranavTasks)         ? raw.pranavTasks         : [],
    independenceVerified: raw.independenceVerified === true,
  };

  // 2026-07-24 (P3.W3.2, full agentic upgrade): intake -> output
  // reconciliation for annotation mode. "Vision/Mission pages lost at
  // intake" (this session's original forensic audit) happened here — the
  // planner's lockedPages list is supposed to be authoritative (Arjun
  // ANNOTATES, never invents), but nothing ever verified the LLM's
  // aanyaTasks output actually covers every locked page before generation
  // started. If a page were dropped during the LLM's own condensation, no
  // downstream check would catch it — Aanya only builds what aanyaTasks
  // lists, so a dropped page here is unrecoverable later. This closes that
  // gap deterministically (no LLM judgment needed — lockedPages already
  // carries the exact expected file path via nextjsFile) rather than
  // hoping a browser-verification retry loop downstream would notice.
  if (useAnnotationMode && lockedPages) {
    const missing = findMissingLockedPages(lockedPages, plan.aanyaTasks);
    if (missing.length > 0) {
      console.warn(
        `[arjun] reconciliation: ${missing.length} locked page(s) missing from aanyaTasks — ` +
          `${missing.map((p) => p.path).join(", ")} — synthesizing tasks to guarantee they're built`,
      );
      plan.aanyaTasks = [...plan.aanyaTasks, ...missing.map(synthesizeTaskForPage)];
    }
  }

  // Write sprint contracts to disk (D23) — generators read these before starting
  writePlanFiles(spec.projectId, plan);

  return { ...plan, buildPlanHash: hashContext(plan) };
}

// ── Intake -> output reconciliation (P3.W3.2) ─────────────────────────────────
// Exported for direct testing. A locked page counts as "covered" only if
// its EXACT nextjsFile path (deterministic, computed by pathToNextjsFile —
// never LLM-derived) appears in some aanyaTask's outputFiles. A page whose
// file the LLM wrote under a different/wrong path is treated the same as
// a fully dropped page — the routing depends on the exact path, so a
// near-miss is not coverage.
export function findMissingLockedPages(lockedPages: LockedPage[], aanyaTasks: GeneratorTask[]): LockedPage[] {
  const allOutputFiles = new Set(aanyaTasks.flatMap((t) => t.outputFiles));
  return lockedPages.filter((page) => !allOutputFiles.has(page.nextjsFile));
}

// Deterministic — no LLM call, so a page this synthesizes is GUARANTEED to
// reach Aanya's task list, not just "hopefully retried correctly" by a
// downstream check. Mirrors the shape/wording the LLM itself produces for
// aanyaTasks elsewhere (see ARJUN_ANNOTATION_PROMPT).
export function synthesizeTaskForPage(page: LockedPage): GeneratorTask {
  return {
    description: `Build the "${page.name}" page (${page.path}): ${page.description}`,
    outputFiles: [page.nextjsFile],
  };
}

// ── Shared system context ──────────────────────────────────────────────────
// Root-cause fix (2026-07-26 autonomy assessment, F2/F5): fix runs
// (Shubham/Aanya/Pranav's runFix) and QA runs (Navya/Karan/Deepika) were
// handed ONLY a bug-report string — no spec, no API contract, no DB schema —
// even though generation gets all three. Live proof: a race-condition fix
// kept failing because Shubham was never shown the DB schema and so could
// never see that `applications` had no unique constraint on
// (user_id, property_id) — the one fact that would have pointed at the
// actual root cause instead of another application-layer patch. This is the
// ONE renderer every fix/QA call site injects, so "what is this system and
// what does it look like right now" is never re-derived differently in two
// places.
export function buildSystemContext(plan: BuildPlan): string {
  return `SYSTEM YOU ARE WORKING ON:
${plan.appName} — ${plan.appDescription}

FULL API CONTRACT (every endpoint, not just the one a finding cited):
${JSON.stringify(plan.apiContract, null, 2)}

FULL DATABASE SCHEMA (every table/column/constraint — check this before
assuming a fix belongs in application code; a missing UNIQUE/CHECK
constraint here is often the actual root cause of a "race condition" or
"invalid state" finding):
${JSON.stringify(plan.dbSchema, null, 2)}

SHARED TYPES (frontend and backend must agree on these):
${plan.sharedTypes}`;
}

// ── Contract security gate (agent-autonomy-assessment RC-1) ────────────────
// Live root cause: a public (auth:false) endpoint whose request shape
// accepts a privilege-indicating field (role, isAdmin, permissions, ...)
// puts the contract itself at odds with security review — Navya enforces
// "matches the contract" while Karan enforces "no unauthenticated privilege
// escalation," and no code can satisfy both. Confirmed live: Shubham
// flip-flopped the same two lines of authController.ts across consecutive
// fix rounds trying to satisfy first one QA agent then the other, never
// converging. escalate_finding doesn't help — it only routes to
// implementation agents, and the bug is in the spec they're implementing
// correctly. Fixed at the only point that can't oscillate: before any code
// exists, by never letting the contract offer the conflict in the first
// place.
const PRIVILEGE_FIELD_NAMES = /^(role|isadmin|is_admin|isstaff|is_staff|islandlord|is_landlord|permission|permissions|scope|scopes|admin)$/i;

// Splits a `{ field: type; field: type }` request-shape literal into its
// field segments. Deliberately simple (split on top-level `;`/`,`, not a
// full TS parser) — these strings are always LLM-generated flat object
// literals (see ARJUN_SYSTEM_PROMPT's own examples), never nested types.
function splitRequestFields(requestType: string): { prefix: string; fields: string[]; suffix: string } {
  const match = requestType.match(/^(\s*\{)([\s\S]*)(\}\s*)$/);
  if (!match) return { prefix: "", fields: [], suffix: requestType };
  const [, prefix, body, suffix] = match;
  const fields = body!.split(/[;,]/).map((f) => f.trim()).filter(Boolean);
  return { prefix: prefix!, fields, suffix: suffix! };
}

export function sanitizePublicEndpointContracts(endpoints: RestEndpoint[]): RestEndpoint[] {
  return endpoints.map((endpoint) => {
    if (endpoint.auth !== false) return endpoint;

    const { prefix, fields, suffix } = splitRequestFields(endpoint.requestType);
    if (fields.length === 0) return endpoint;

    const kept = fields.filter((f) => {
      const fieldName = f.split(":")[0]?.trim() ?? "";
      return !PRIVILEGE_FIELD_NAMES.test(fieldName);
    });
    if (kept.length === fields.length) return endpoint; // nothing to strip

    console.warn(
      `[arjun] contract security gate: stripped privilege field(s) from public endpoint ${endpoint.method} ${endpoint.path} — ` +
        `a public (auth:false) endpoint cannot accept a role/permission field without letting any caller self-assign it`,
    );
    return { ...endpoint, requestType: `${prefix} ${kept.join("; ")} ${suffix.trim()}` };
  });
}

// Live gap found running the fix above for real (not a fixture): Arjun
// sometimes emits a NAMED shared-type reference (`requestType:
// "RegisterRequest"`) instead of an inline `{ ... }` literal — the
// vulnerable field then lives in the `export interface RegisterRequest {
// ... }` definition in sharedTypes, which sanitizePublicEndpointContracts
// never looks at. Same privilege-field pattern, same strip-don't-fail
// approach, applied to the interface body instead of the endpoint's own
// requestType string.
export function sanitizeSharedTypesForPublicEndpoints(sharedTypes: string, endpoints: RestEndpoint[]): string {
  let result = sharedTypes;
  for (const endpoint of endpoints) {
    if (endpoint.auth !== false) continue;
    const typeName = endpoint.requestType.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(typeName)) continue; // not a bare identifier — inline literal, handled elsewhere

    const interfacePattern = new RegExp(`(export interface ${typeName}\\s*\\{)([\\s\\S]*?)(\\})`);
    const match = result.match(interfacePattern);
    if (!match) continue;

    const [, prefix, body] = match;
    const fields = body!.split(/[;,]/).map((f) => f.trim()).filter(Boolean);
    const kept = fields.filter((f) => {
      const fieldName = f.split(":")[0]?.trim() ?? "";
      return !PRIVILEGE_FIELD_NAMES.test(fieldName);
    });
    if (kept.length === fields.length) continue; // nothing to strip

    console.warn(
      `[arjun] contract security gate: stripped privilege field(s) from shared type "${typeName}" — ` +
        `referenced by public endpoint ${endpoint.method} ${endpoint.path}`,
    );
    result = result.replace(interfacePattern, `${prefix}\n  ${kept.join(";\n  ")};\n}`);
  }
  return result;
}

// ── Write contract files so each agent can read their tasks ───────────────────
function writePlanFiles(projectId: string, plan: Omit<BuildPlan, "buildPlanHash">): void {
  const dir = getBuildDir(projectId);
  mkdirSync(dir, { recursive: true });
  const { writeFileSync } = require("fs") as typeof import("fs");
  writeFileSync(join(dir, "build-plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(join(dir, "shared-types.ts"), plan.sharedTypes);
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify(plan.apiContract, null, 2));
  writeFileSync(join(dir, "db-schema.json"), JSON.stringify(plan.dbSchema, null, 2));
}

export function getBuildDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId);
}

// ── JSON extraction ───────────────────────────────────────────────────────────
function parseJson(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new Error(`[arjun] Could not parse JSON: ${text.slice(0, 200)}`);
}

// ── System prompt ─────────────────────────────────────────────────────────────
// Exported so index.test.ts can assert it never contradicts a generator's own
// stack rules (e.g. instructing Tailwind while Aanya's prompt forbids it).
export const ARJUN_SYSTEM_PROMPT = `\
You are a senior technical architect. Given a ProjectSpec JSON, produce a complete BuildPlan JSON.

Be AMBITIOUS (D22). Design real systems, not toy demos.

Output a single JSON object matching this schema exactly. No markdown fences, no prose.

{
  "sharedTypes": "// TypeScript type declarations used by both frontend and backend\\nexport interface Task { ... }\\n...",
  "apiContract": {
    "endpoints": [
      {
        "method": "GET",
        "path": "/api/v1/tasks",
        "description": "List all tasks for the authenticated user",
        "auth": true,
        "requestType": "null",
        "responseType": "{ tasks: Task[]; total: number }",
        "errorCodes": [401, 500]
      }
    ]
  },
  "dbSchema": {
    "tables": [
      {
        "name": "users",
        "columns": [
          { "name": "id",       "drizzleType": "uuid()",       "constraints": [".primaryKey()", ".default(sql\`gen_random_uuid()\`)"] },
          { "name": "password_hash", "drizzleType": "text()",   "constraints": [".notNull()"] },
          { "name": "email",    "drizzleType": "text()",       "constraints": [".notNull()", ".unique()"] },
          { "name": "created_at", "drizzleType": "timestamp()", "constraints": [".notNull()", ".default(sql\`now()\`)"] }
        ],
        "indexes": []
      }
    ]
  },
  "shubhamTasks": [
    {
      "description": "Express entry point and app setup",
      "outputFiles": ["src/index.ts", "src/app.ts", "package.json", "tsconfig.json"]
    }
  ],
  "aanyaTasks": [
    {
      "description": "Next.js app setup and layout",
      "outputFiles": ["app/layout.tsx", "app/page.tsx", "package.json", "next.config.ts"]
    }
  ],
  "pranavTasks": [
    {
      "description": "Drizzle schema and initial migration",
      "outputFiles": ["src/schema.ts", "drizzle.config.ts", "package.json"]
    }
  ],
  "independenceVerified": true
}

Rules:
- sharedTypes: full TypeScript — interfaces, enums, no imports needed (standalone).
- Every endpoint must have auth=true unless it's a public health check, registration, or login endpoint.
- Custom JWT auth middleware handles auth — backend checks req.userId (which is users.id).
- We use a local users table for auth. Any user_id column in database tables should reference users.id (e.g. "users.id") and have a foreign key references constraint.
- drizzleType values: uuid(), text(), varchar(n), integer(), boolean(),
  timestamp({ withTimezone: true }), date(), jsonb()
- For all FK columns: add "references" field: "parent_table.id" (e.g. "users.id")
- independenceVerified must be true: shubham/aanya/pranav tasks must not depend on each other's
  in-progress files. They only share the contract defined in this BuildPlan.
- DO NOT include tasks that are: "research", "review", "check" — only code-producing tasks.
- outputFiles must list every file the agent must produce. Be exhaustive.

CRITICAL — READ THE SPEC, USE IT EXACTLY. DO NOT SUBSTITUTE YOUR TRAINING DEFAULTS:

PAGE ROUTES — use what the spec says, nothing else:
- Read every page from spec.features[*].userStories and spec.apiEndpoints.
- If the spec says /sign-in, the file MUST be app/(auth)/sign-in/page.tsx. NEVER app/(auth)/login/page.tsx.
- If the spec says /sign-up, the file MUST be app/(auth)/sign-up/page.tsx. NEVER app/(auth)/register/page.tsx.
- Include EVERY page mentioned in the spec (Home, About, Vision, Mission, Services, Products, Contact, Sign-In, Sign-Up, etc.).
- DO NOT add pages the spec does not mention.

FRONTEND UI STACK — the generated app uses NexUI, never Tailwind:
- The frontend imports components from "@yugnex/nexui-react" (Button, Panel, Card,
  Input, Badge, Modal, Tabs, Select, Spinner, etc.), styled with NexUI CSS variables.
- NEVER use Tailwind, shadcn/ui, or @radix-ui. Never list tailwind.config.ts,
  postcss.config.js, or components/ui/*.tsx in any outputFiles array.
- Never write a task description that mentions configuring Tailwind or installing
  a third-party component library.

TASK DESCRIPTIONS — say WHAT GOES IN the file, not just which file:
- A task description is the ONLY content instruction the generator receives. It never
  sees the raw spec text you are reading now.
- "Implement Services and Products catalog pages" is USELESS — it produced a page with
  4 of the 9 services the spec named, because the generator had to guess the content.
- Instead, name the actual required content explicitly, e.g. "Services page listing all
  nine offerings by name: mobile app development, web app development, custom software,
  CRM, POS, bulk SMS, email marketing, domain & hosting, digital marketing — each with
  its own heading and description".
- Copy concrete nouns (service names, page sections, field names) out of
  spec.features[*].description and spec.features[*].userStories into the description.

AUTH TECHNOLOGY — the spec says provider: "custom". That means:
- NEVER add app/api/auth/[...nextauth]/route.ts. NextAuth is forbidden.
- NEVER add lib/auth.ts that wraps NextAuth or next-auth. Forbidden.
- NEVER add "next-auth" to package.json. Forbidden.
- The Next.js frontend calls the Express backend for login/register and stores the JWT returned.
- Auth pages are plain forms that POST to the Express backend API.
- The frontend lib/api.ts handles sending the JWT in Authorization headers.

AUTH SCOPE — read spec.auth.features exactly:
- ["sign-in", "sign-up"] → include both app/(auth)/sign-in/page.tsx AND app/(auth)/sign-up/page.tsx.
- ["sign-in"] only → only sign-in page.
- Do not add protected dashboard pages unless spec.features explicitly describes a dashboard.

NOTIFICATION — if spec mentions email or WhatsApp notification on contact form:
- Shubham's backend must include a notification service (src/services/notification.ts).
- It sends email via Nodemailer and/or WhatsApp via Twilio based on what the spec says.
- This is NOT optional — it is a confirmed feature.
`;

// ── Annotation-mode prompt (used when locked pages are provided) ──────────────
// This is Arjun's second mode: the planner has already agreed on a page list
// with the client. Arjun's job is NOT to invent pages — it is to ANNOTATE the
// locked list and derive everything else (API, DB, tasks) from those pages.
const ARJUN_ANNOTATION_PROMPT = `\
You are a senior technical architect. You have been given:
1. A LOCKED list of pages that has already been agreed with the client — you MUST NOT add, remove, or rename any path.
2. An auth type: "none" (public site) or "jwt" (requires login).
3. A ProjectSpec for additional context (description, features, contact details).

Your job: ANNOTATE the locked pages, then derive the API contract, DB schema, and tasks.

Output a single JSON object. No markdown fences, no prose.

━━━ LOCKED PAGE → NEXT.JS FILE MAPPING ━━━
Each page in lockedPages has a "nextjsFile" field that is ALREADY CORRECT.
Copy it VERBATIM into the outputFiles for that page's aanya task.
DO NOT compute or derive the file path yourself — just use nextjsFile as given.
Examples of what you will see:
  path "/" → nextjsFile "app/page.tsx"          ← not app/home/page.tsx
  path "/sign-in" → nextjsFile "app/(auth)/sign-in/page.tsx"   ← not app/auth/signin
  path "/about"   → nextjsFile "app/about/page.tsx"

━━━ AANYA TASKS — EXACTLY ONE TASK PER LOCKED PAGE ━━━
Each locked page becomes exactly ONE aanya task. The outputFiles for that task
MUST include the page's nextjsFile field (copied verbatim) plus any component
files needed. DO NOT produce tasks for pages not in lockedPages.
DO NOT omit any page from lockedPages.

━━━ AUTH RULES (CRITICAL) ━━━
authType "none":
- No auth pages. No users table. No JWT middleware. No /sign-in, /sign-up tasks.

authType "jwt":
- The lockedPages list WILL include sign-in and sign-up — map them per the rules above.
- Auth endpoints: POST /api/v1/auth/sign-in and POST /api/v1/auth/sign-up
  NEVER: /login, /register, /auth/login, /auth/register — these names are FORBIDDEN.
- Backend auth: custom JWT — NEVER NextAuth, NEVER next-auth package.
- NEVER add app/api/auth/[...nextauth]/route.ts. Forbidden.
- Users table: id (uuid pk), email (text unique not null), password_hash (text not null), created_at (timestamp).

━━━ DERIVING API + DB FROM THE PAGE LIST ━━━
For each page, ask: what data does this page show or submit?
- Contact page → needs POST /api/v1/contact endpoint + contact_submissions table
- Static pages (Home, About, Vision, Mission, Services, Products) → no API endpoints needed
  unless spec says otherwise
- Only create endpoints that serve the locked pages. No speculative endpoints.

━━━ OUTPUT SCHEMA ━━━
{
  "sharedTypes": "// TypeScript interfaces used by both frontend and backend",
  "apiContract": {
    "endpoints": [
      {
        "method": "POST",
        "path": "/api/v1/auth/sign-in",
        "description": "Authenticate user, return JWT",
        "auth": false,
        "requestType": "{ email: string; password: string }",
        "responseType": "{ token: string; user: { id: string; email: string } }",
        "errorCodes": [400, 401, 500]
      }
    ]
  },
  "dbSchema": {
    "tables": [...]
  },
  "shubhamTasks": [
    { "description": "Express entry, app setup, JWT middleware", "outputFiles": ["src/index.ts", "src/app.ts", "src/middleware/auth.ts", "package.json", "tsconfig.json"] }
  ],
  "aanyaTasks": [
    { "description": "Home page — hero section, services overview, CTA", "outputFiles": ["app/page.tsx"] },
    { "description": "About page — company story, values", "outputFiles": ["app/about/page.tsx"] }
  ],
  "pranavTasks": [
    { "description": "Drizzle schema and initial migration", "outputFiles": ["src/schema.ts", "drizzle.config.ts", "package.json"] }
  ],
  "independenceVerified": true
}

━━━ FINAL CHECKLIST (verify before responding) ━━━
□ Every page in lockedPages has exactly ONE corresponding aanya task
□ No aanya task adds a page not in lockedPages
□ Each aanya task's outputFiles contains the page's nextjsFile value VERBATIM
□ Auth endpoints use /api/v1/auth/sign-in and /api/v1/auth/sign-up (never /login, /register)
□ No NextAuth files anywhere (no [...nextauth] route, no next-auth package)
□ independenceVerified: true
`;
