import { test, expect } from "bun:test";
import { run, ARJUN_SYSTEM_PROMPT, findMissingLockedPages, synthesizeTaskForPage, buildSystemContext, sanitizePublicEndpointContracts, sanitizeSharedTypesForPublicEndpoints, type LockedPage, type BuildPlan, type RestEndpoint } from "./index.ts";
import type { ProjectSpec } from "../../saanvi/src/index.ts";
import { FALLBACK_BRIEF, type DesignBrief } from "../../vanya/src/index.ts";

// 2026-07-24 (P3.W3.1): run() now also calls Vanya for a design brief.
// Every test below stubs it (defaulting to FALLBACK_BRIEF) so these stay
// true unit tests with zero live network calls — without this, a test that
// only stubs `chat` would still trigger a REAL, unmocked Vanya LLM call.
const stubRunVanya = async (): Promise<DesignBrief> => FALLBACK_BRIEF;

// Full-system audit A7: same fix as Saanvi (agents/saanvi/src/index.test.ts)
// — one empty/unparseable NIM response used to crash the whole pipeline.
// run() takes an injectable `chat` dependency so this is unit-testable
// without a live LLM call.

const MINIMAL_SPEC: ProjectSpec = {
  projectId: "proj123",
  name: "Test App",
  description: "d",
  appType: "web",
  features: [],
  auth: { provider: "custom", features: ["sign-in", "sign-up"] },
  apiEndpoints: [],
  dbTables: [],
  successCriteria: [],
  lockedAt: new Date().toISOString(),
  specHash: "hash",
};

const VALID_PLAN_JSON = JSON.stringify({
  sharedTypes: "export interface X {}",
  apiContract: { endpoints: [] },
  dbSchema: { tables: [] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
});

test("a single empty response is retried once and succeeds on the second attempt", async () => {
  let callCount = 0;
  const stubChat = async () => {
    callCount++;
    return { content: callCount === 1 ? "" : VALID_PLAN_JSON, modelUsed: "mistralai/mistral-nemotron" as const };
  };

  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya });

  expect(callCount).toBe(2);
  expect(plan.appName).toBe("Test App");
});

test("two consecutive empty responses still throw", async () => {
  const stubChat = async () => ({ content: "", modelUsed: "mistralai/mistral-nemotron" as const });

  await expect(run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya })).rejects.toThrow();
});

// 2026-07-24 (P3.W3.1): design identity previously had no path into
// BuildPlan at all (Aanya relied solely on spec.description). This proves
// Vanya's brief actually reaches the plan Aanya receives.
test("Vanya's design brief flows through into BuildPlan.designBrief", async () => {
  const stubChat = async () => ({ content: VALID_PLAN_JSON, modelUsed: "mistralai/mistral-nemotron" as const });
  const customBrief: DesignBrief = {
    mood: "Playful and bold",
    palette: [{ name: "ink", hex: "#111111" }, { name: "paper", hex: "#FFFFFF" }, { name: "accent", hex: "#FF6600" }],
    typography: { display: "Fraunces", body: "Inter" },
    layoutConcept: "Asymmetric grid",
  };

  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: async () => customBrief });

  expect(plan.designBrief).toEqual(customBrief);
});

// 2026-07-24 (P3.W3.2, full agentic upgrade): "Vision/Mission pages lost at
// intake" (this session's original forensic audit) — annotation mode's
// lockedPages list is supposed to be authoritative (Arjun ANNOTATES, never
// invents pages), but nothing verified the LLM's aanyaTasks output actually
// covered every locked page. These tests cover the deterministic
// reconciliation that closes that gap.

const LOCKED_PAGES: LockedPage[] = [
  { name: "Home", path: "/", description: "Landing page", nextjsFile: "app/page.tsx" },
  { name: "Vision", path: "/vision", description: "Company vision", nextjsFile: "app/vision/page.tsx" },
  { name: "Mission", path: "/mission", description: "Company mission", nextjsFile: "app/mission/page.tsx" },
];

test("findMissingLockedPages returns an empty array when every locked page has a matching aanyaTask output file", () => {
  const aanyaTasks = LOCKED_PAGES.map((p) => ({ description: p.name, outputFiles: [p.nextjsFile] }));
  expect(findMissingLockedPages(LOCKED_PAGES, aanyaTasks)).toEqual([]);
});

test("findMissingLockedPages catches pages dropped entirely from aanyaTasks (the exact 'Vision/Mission lost' failure mode)", () => {
  // Only Home made it into aanyaTasks — Vision and Mission were dropped
  // during the LLM's own condensation, exactly as the original forensic
  // audit found live.
  const aanyaTasks = [{ description: "Home", outputFiles: ["app/page.tsx"] }];
  const missing = findMissingLockedPages(LOCKED_PAGES, aanyaTasks);
  expect(missing.map((p) => p.name)).toEqual(["Vision", "Mission"]);
});

test("findMissingLockedPages treats a wrong output path as missing, not covered — the exact path is what routing depends on", () => {
  const aanyaTasks = [
    { description: "Home", outputFiles: ["app/page.tsx"] },
    // Wrong path for Vision — e.g. the LLM wrote "app/our-vision/page.tsx" instead of "app/vision/page.tsx"
    { description: "Vision", outputFiles: ["app/our-vision/page.tsx"] },
    { description: "Mission", outputFiles: ["app/mission/page.tsx"] },
  ];
  const missing = findMissingLockedPages(LOCKED_PAGES, aanyaTasks);
  expect(missing.map((p) => p.name)).toEqual(["Vision"]);
});

test("synthesizeTaskForPage produces a task whose outputFiles is exactly the locked page's nextjsFile", () => {
  const task = synthesizeTaskForPage(LOCKED_PAGES[1]!); // Vision
  expect(task.outputFiles).toEqual(["app/vision/page.tsx"]);
  expect(task.description).toContain("Vision");
  expect(task.description).toContain("Company vision");
});

test("run() in annotation mode self-heals dropped locked pages — aanyaTasks includes every locked page even when the LLM's raw output omits some", async () => {
  // The LLM's raw response only builds Home — Vision/Mission are silently
  // dropped, reproducing the original bug.
  const incompletePlanJson = JSON.stringify({
    sharedTypes: "",
    apiContract: { endpoints: [] },
    dbSchema: { tables: [] },
    shubhamTasks: [],
    aanyaTasks: [{ description: "Home page", outputFiles: ["app/page.tsx"] }],
    pranavTasks: [],
    independenceVerified: true,
  });
  const stubChat = async () => ({ content: incompletePlanJson, modelUsed: "mistralai/mistral-nemotron" as const });

  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya }, LOCKED_PAGES, "none");

  const coveredFiles = new Set(plan.aanyaTasks.flatMap((t) => t.outputFiles));
  expect(coveredFiles.has("app/page.tsx")).toBe(true);
  expect(coveredFiles.has("app/vision/page.tsx")).toBe(true);
  expect(coveredFiles.has("app/mission/page.tsx")).toBe(true);
});

test("run() does NOT run reconciliation in free-form mode (no lockedPages provided) — nothing to reconcile against", async () => {
  const stubChat = async () => ({ content: VALID_PLAN_JSON, modelUsed: "mistralai/mistral-nemotron" as const });
  const plan = await run(MINIMAL_SPEC, { chat: stubChat, runVanya: stubRunVanya }); // no lockedPages arg
  expect(plan.aanyaTasks).toEqual([]); // untouched — no synthesized tasks appended
});

// ── buildSystemContext — root-cause fix for the autonomy assessment's F2/F5:
// fix runs (Shubham/Aanya/Pranav) and QA runs (Navya/Karan/Deepika) only ever
// received a bug-report string, never the spec/contract/schema generation
// gets. This is the ONE shared renderer both call sites inject so an agent
// can see the whole system, not just the one line QA flagged. ────────────────
const CONTEXT_PLAN: BuildPlan = {
  projectId: "ctxtest",
  appName: "Greenway Estates Portal",
  appDescription: "A property management platform connecting landlords, tenants, and staff.",
  designBrief: { palette: [], typefaces: [], layoutConcept: "", mood: "" } as any,
  features: [],
  sharedTypes: "export interface Application { id: string; status: string; }",
  apiContract: {
    baseUrl: "http://localhost:3001",
    endpoints: [
      { method: "POST", path: "/api/v1/applications", description: "Create an application", auth: true, requestType: "AppRequest", responseType: "AppResponse", errorCodes: [400] },
    ],
  },
  dbSchema: {
    tables: [
      {
        name: "applications",
        columns: [
          { name: "user_id", drizzleType: "uuid()", constraints: [".notNull()"], references: "users.id" },
          { name: "property_id", drizzleType: "uuid()", constraints: [".notNull()"], references: "properties.id" },
        ],
        indexes: [],
      },
    ],
  },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
  buildPlanHash: "deadbeef",
};

test("buildSystemContext includes the app name/description so an agent knows what the system is for", () => {
  const ctx = buildSystemContext(CONTEXT_PLAN);
  expect(ctx).toContain("Greenway Estates Portal");
  expect(ctx).toContain("property management platform connecting landlords, tenants, and staff");
});

test("buildSystemContext includes the full DB schema — the exact fact Shubham needed to know 'applications' has no unique constraint on (user_id, property_id)", () => {
  const ctx = buildSystemContext(CONTEXT_PLAN);
  expect(ctx).toContain("applications");
  expect(ctx).toContain("user_id");
  expect(ctx).toContain("property_id");
});

test("buildSystemContext includes the full API contract, not just the one endpoint a finding happened to cite", () => {
  const ctx = buildSystemContext(CONTEXT_PLAN);
  expect(ctx).toContain("/api/v1/applications");
  expect(ctx).toContain("POST");
});

test("buildSystemContext includes shared types so frontend/backend fixes stay contract-compatible", () => {
  const ctx = buildSystemContext(CONTEXT_PLAN);
  expect(ctx).toContain("interface Application");
});

// ── sanitizePublicEndpointContracts — root-cause fix (agent-autonomy-
// assessment RC-1). Live proof: Arjun's own contract for complex1 specified
// POST /api/v1/auth/register with auth:false and
// requestType: "{ email: string; password: string; name: string; role: string }"
// — a public endpoint that lets any caller self-assign role:"staff". Navya
// (enforces the contract) and Karan (enforces security) then WANT OPPOSITE
// CODE: Navya wants role honored (matches the contract), Karan wants role
// rejected (closes the vuln). Shubham cannot satisfy both, so it oscillates
// forever — confirmed live, 2 consecutive rounds flip-flopping the same
// lines. escalate_finding can't fix this either: it only routes to
// implementation agents, and the spec itself is the bug. This closes it at
// the only correct point — before any code exists — by deterministically
// stripping privilege-indicating fields from public endpoints' request
// shape, the same way findMissingLockedPages deterministically repairs a
// dropped page instead of hoping a later QA round notices.
const PUBLIC_REGISTER_ENDPOINT: RestEndpoint = {
  method: "POST",
  path: "/api/v1/auth/register",
  description: "Registers a new user",
  auth: false,
  requestType: "{ email: string; password: string; name: string; role: string }",
  responseType: "AuthResponse",
  errorCodes: [400, 500],
};

test("sanitizePublicEndpointContracts strips a privilege field (role) from a public endpoint's request shape", () => {
  const [sanitized] = sanitizePublicEndpointContracts([PUBLIC_REGISTER_ENDPOINT]);
  expect(sanitized!.requestType).not.toContain("role");
  expect(sanitized!.requestType).toContain("email: string");
  expect(sanitized!.requestType).toContain("password: string");
  expect(sanitized!.requestType).toContain("name: string");
});

test("sanitizePublicEndpointContracts leaves an authenticated endpoint's role field untouched — auth:true endpoints are legitimately allowed privilege fields", () => {
  const authed: RestEndpoint = { ...PUBLIC_REGISTER_ENDPOINT, auth: true, path: "/api/v1/admin/users" };
  const [sanitized] = sanitizePublicEndpointContracts([authed]);
  expect(sanitized!.requestType).toContain("role");
});

test("sanitizePublicEndpointContracts leaves a public endpoint with no privilege field untouched", () => {
  const clean: RestEndpoint = { ...PUBLIC_REGISTER_ENDPOINT, requestType: "{ email: string; password: string }" };
  const [sanitized] = sanitizePublicEndpointContracts([clean]);
  expect(sanitized!.requestType).toBe("{ email: string; password: string }");
});

test("sanitizePublicEndpointContracts catches isAdmin/permissions/scope variants, not just 'role'", () => {
  for (const field of ["isAdmin", "is_admin", "isStaff", "permissions", "scope"]) {
    const endpoint: RestEndpoint = { ...PUBLIC_REGISTER_ENDPOINT, requestType: `{ email: string; ${field}: boolean }` };
    const [sanitized] = sanitizePublicEndpointContracts([endpoint]);
    expect(sanitized!.requestType).not.toContain(field);
  }
});

// Live gap found running the fix for real (not a fixture): Arjun's own
// output sometimes uses a NAMED shared type instead of an inline literal —
// `requestType: "RegisterRequest"` referencing
// `export interface RegisterRequest { ...; role: UserRole; }` in
// sharedTypes. sanitizePublicEndpointContracts only ever looked at the
// endpoint's own requestType string, so a named-reference register
// endpoint sailed through with the exact same vulnerability untouched.
// Confirmed live via pipeline/check-sanitizer-live.ts before this fix.
test("sanitizeSharedTypesForPublicEndpoints strips a privilege field from a NAMED interface a public endpoint references", () => {
  const sharedTypes = `export enum UserRole {\n  TENANT = 'tenant',\n  LANDLORD = 'landlord',\n  STAFF = 'staff'\n}\n\nexport interface RegisterRequest {\n  email: string;\n  password: string;\n  fullName: string;\n  role: UserRole;\n}\n\nexport interface LoginRequest {\n  email: string;\n  password: string;\n}\n`;
  const namedEndpoint: RestEndpoint = { ...PUBLIC_REGISTER_ENDPOINT, requestType: "RegisterRequest" };

  const sanitized = sanitizeSharedTypesForPublicEndpoints(sharedTypes, [namedEndpoint]);

  const registerInterface = sanitized.match(/export interface RegisterRequest \{([\s\S]*?)\}/)?.[1] ?? "";
  expect(registerInterface).not.toContain("role");
  expect(registerInterface).toContain("email: string");
  // untouched: a DIFFERENT interface not referenced by any public endpoint
  expect(sanitized).toContain("export interface LoginRequest {\n  email: string;\n  password: string;\n}");
});

test("sanitizeSharedTypesForPublicEndpoints leaves sharedTypes untouched when no public endpoint uses a named type with a privilege field", () => {
  const sharedTypes = "export interface LoginRequest {\n  email: string;\n  password: string;\n}\n";
  const authedEndpoint: RestEndpoint = { ...PUBLIC_REGISTER_ENDPOINT, auth: true, requestType: "AdminRequest" };
  expect(sanitizeSharedTypesForPublicEndpoints(sharedTypes, [authedEndpoint])).toBe(sharedTypes);
});

// ── Step 1: requirements must survive the Saanvi → Arjun → generator chain ──
// 2026-08-04: root-caused live (project=verify4617991). The user asked for 9
// named services; Saanvi's spec.json listed all 9 explicitly in its features.
// The delivered site shipped 4. Cause: BuildPlan — the ONLY artifact handed to
// the generators — had no field for the spec's features/userStories, so every
// requirement was structurally discarded at this boundary. Arjun's surviving
// instruction for the whole services page was the 9-word string "Implement
// Services and Products catalog pages" plus two filenames. Aanya's own prompt
// then says "Every page must show real content from the project spec" while
// never receiving that spec, so it invented plausible content instead.
// No downstream gate could detect the loss: nothing compares delivered output
// to the spec. This is the single defect that made every prior QA/model/gate
// fix unable to improve output quality.
const SPEC_WITH_FEATURES: ProjectSpec = {
  ...MINIMAL_SPEC,
  features: [
    {
      name: "Service & Product Catalog",
      description: "Services page detailing mobile app development, CRM, POS, bulk SMS, and digital marketing.",
      userStories: ["As a visitor I can browse the Services page to see all offerings"],
    },
  ],
};

test("BuildPlan carries the spec's features through to the generators", async () => {
  const stubChat = async () => ({ content: VALID_PLAN_JSON, modelUsed: "mistralai/mistral-nemotron" as const });

  const plan = await run(SPEC_WITH_FEATURES, { chat: stubChat, runVanya: stubRunVanya });

  expect(plan.features).toHaveLength(1);
  expect(plan.features[0]!.name).toBe("Service & Product Catalog");
  expect(plan.features[0]!.description).toContain("CRM");
  expect(plan.features[0]!.userStories).toEqual(["As a visitor I can browse the Services page to see all offerings"]);
});

// 2026-08-04 (live, verify4617991): Arjun's plan contained the aanyaTask
// "Initialize Next.js application, configure Tailwind CSS ..." with
// tailwind.config.ts in outputFiles — while Aanya's own system prompt says
// "NEVER use Tailwind, shadcn/ui, @radix-ui". Watched live: Aanya obeyed the
// plan, wrote tailwind.config.ts + a shadcn-style components/ui/button.tsx,
// then had to self-correct mid-run and the stray config still shipped.
// Verified by test: the contradiction is NOT in this prompt's text — it comes
// from OMISSION. The prompt never states the frontend UI stack, so the planner
// LLM fills the blank with the industry-default (Tailwind). Stating the stack
// constraint here is what stops the planner inventing it.
test("Arjun's planner prompt states the frontend UI stack so it cannot plan Tailwind tasks", () => {
  const prompt = ARJUN_SYSTEM_PROMPT.toLowerCase();
  expect(prompt).toContain("nexui");
  expect(prompt).toContain("never use tailwind");
});
