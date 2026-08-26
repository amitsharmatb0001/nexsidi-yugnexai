// Saanvi — Requirements analyst
// Turns a raw user request into a locked, structured ProjectSpec JSON.
// Uses MiniMax M3 via NIM (structured JSON output).

import { agentChat } from "@nexsidi/llm-client";
import { hashContext } from "@nexsidi/context-chain";

// ── Canonical ProjectSpec (v1) ────────────────────────────────────────────────
export interface Feature {
  name: string;
  description: string;
  userStories: string[];
}

export interface ApiEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  auth: boolean;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown>;
}

export interface DbField {
  name: string;
  type: "uuid" | "text" | "varchar" | "integer" | "boolean" | "timestamptz" | "date" | "jsonb";
  nullable: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  references?: { table: string; field: string };
  default?: string;
}

export interface DbTable {
  name: string;
  fields: DbField[];
}

export interface ProjectSpec {
  projectId: string;
  name: string;
  description: string;
  appType: "web";
  features: Feature[];
  // 2026-08-25: real bug found live — this was unconditionally
  // { provider: "custom", features: ["sign-in", "sign-up"] }, never read
  // from the model's own output at all, so EVERY project ever spec'd
  // through this real Saanvi path got a forced auth system regardless of
  // what was asked for. Confirmed live: a project explicitly told (twice,
  // in plain English) "no accounts, remove auth entirely" kept coming back
  // with sign-in/sign-up/JWT/a users table every time, because nothing
  // about the feedback could reach a field that was never actually
  // computed from anything. `null` here is a real, representable "this app
  // has no accounts" state — inferred from whether the model itself marked
  // any apiEndpoint auth: true (see run() below), the same signal Arjun's
  // own prompt already treats as authoritative per-endpoint.
  auth: { provider: "custom"; features: Array<"sign-in" | "sign-up"> } | null;
  apiEndpoints: ApiEndpoint[];
  dbTables: DbTable[];
  successCriteria: string[];
  lockedAt: string;
  specHash: string; // SHA-256 of spec before this field — immutable after lock
}

export interface SaanviDeps {
  chat: typeof agentChat;
}

// 2026-08-05: Saanvi previously had no way to signal "this request is too
// vague to spec confidently" — it always guessed, silently, on anything
// unclear (the system prompt even said "invent a specific visual identity"
// when no direction was given). Root cause of a real complaint: a short,
// typo-heavy request should make the system ASK the user, not fabricate an
// answer and lock it in. `needs_clarification` is reserved for genuinely
// unusable input (no discernible product intent) — see SAANVI_SYSTEM_PROMPT's
// calibration note; a normal brief-but-complete request (e.g. "build a task
// tracker for small teams") must still produce a full, ambitious spec per
// this file's existing "planner is ambitious" philosophy, not a question.
export type SaanviResult =
  | { status: "locked"; spec: ProjectSpec }
  | { status: "needs_clarification"; questions: string[] };

// ── Main entry ────────────────────────────────────────────────────────────────
// `deps` is injectable (defaults to the real agentChat) so the retry
// behavior below is unit-testable without a live LLM call — matches this
// codebase's established DI pattern (e.g. runAgentEscalated's `deps` param).
export async function run(
  projectId: string,
  userRequest: string,
  deps: SaanviDeps = { chat: agentChat },
): Promise<SaanviResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const messages = [
    { role: "system" as const, content: SAANVI_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: `Project ID: ${projectId}\n\nUser request:\n${userRequest}\n\nOutput ONLY the JSON object. No markdown, no prose.`,
    },
  ];

  // A7 (full-system audit): one empty/unparseable response used to crash
  // the entire pipeline outright (stress-test run 9 — died 12s into a
  // fresh run on Saanvi's very first call). One retry absorbs a transient
  // blip without masking a genuinely broken account/model, which will fail
  // the retry too and surface the real error.
  let rawResult: unknown;
  try {
    const { content } = await deps.chat("saanvi", messages, apiKey);
    rawResult = parseJson(content);
  } catch (firstErr) {
    console.log(`[saanvi] first attempt failed (${String(firstErr)}) — retrying once`);
    const { content } = await deps.chat("saanvi", messages, apiKey);
    rawResult = parseJson(content);
  }
  const raw = rawResult as Omit<ProjectSpec, "projectId" | "lockedAt" | "specHash"> & {
    needsClarification?: boolean;
    questions?: unknown;
  };

  if (raw.needsClarification === true) {
    const questions = Array.isArray(raw.questions) ? raw.questions.map(String).filter(Boolean) : [];
    if (questions.length > 0) {
      console.log(`[saanvi] request is too ambiguous to spec confidently — asking ${questions.length} question(s) instead of guessing`);
      return { status: "needs_clarification", questions };
    }
    // Model set the flag but gave no actual questions — nothing to ask the
    // user, so fall through and spec normally rather than pausing on nothing.
  }

  const apiEndpoints: ApiEndpoint[] = Array.isArray(raw.apiEndpoints) ? raw.apiEndpoints : [];
  const spec: Omit<ProjectSpec, "specHash"> = {
    projectId,
    name: String(raw.name ?? "Untitled"),
    description: String(raw.description ?? ""),
    appType: "web",
    features: Array.isArray(raw.features) ? raw.features : [],
    // See ProjectSpec.auth's own header comment for the full root-cause
    // writeup — this used to be unconditional. The model already marks
    // each endpoint auth: true|false (its own real judgment, not a guess
    // made here); an app with zero auth-gated endpoints has no protected
    // resources, so it has nothing for sign-in/sign-up to gate.
    auth: apiEndpoints.some((e) => e.auth === true) ? { provider: "custom", features: ["sign-in", "sign-up"] } : null,
    apiEndpoints,
    dbTables: Array.isArray(raw.dbTables) ? raw.dbTables : [],
    successCriteria: Array.isArray(raw.successCriteria) ? raw.successCriteria : [],
    lockedAt: new Date().toISOString(),
  };

  // Patent Claim 1: hash the spec at lock-time — immutable from here
  return { status: "locked", spec: { ...spec, specHash: hashContext(spec) } };
}

// ── JSON extraction — handles markdown fences and trailing prose ──────────────
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
  throw new Error(`[saanvi] Could not parse JSON from LLM output: ${text.slice(0, 200)}`);
}

// ── System prompt ─────────────────────────────────────────────────────────────
export const SAANVI_SYSTEM_PROMPT = `\
You are a senior product architect. Convert a user's app idea into an ambitious, production-quality JSON specification targeting investor-demo level quality — the kind of product you would see from a well-funded startup, NOT a basic tutorial project.

WHEN TO ASK INSTEAD OF GUESS (read this before anything else):
Most requests are brief but usable — a one-sentence idea, a company name plus a service list, a rough
feature list with typos. For those, fill gaps AMBITIOUSLY per the rules below. Do NOT ask questions for
missing polish (exact colors, precise wording, page count) — invent something specific and good, as
instructed further down.
Only ask when the request is so vague or contradictory that ANY spec you produce would be a pure guess
at the user's actual intent — e.g. no discernible product category at all ("make it good", "app for my
thing"), or genuinely conflicting requirements you cannot resolve without knowing which one wins.
When (and only when) that is true, output EXACTLY this JSON shape instead of a spec:
{ "needsClarification": true, "questions": ["specific, answerable question", "..."] }
Ask 1-3 questions maximum, each answerable in a short sentence. Never combine this with spec fields —
if you're asking, ask; otherwise, commit to a full spec.

WHEN TO ASK FOR REAL BUSINESS SPECIFICS — a SEPARATE trigger from vagueness above:
2026-08-08: real gap found live — a request like "build a client portal for
Northgate Consulting" is clear enough to spec confidently in the vagueness
sense above (portal type, pages, auth are all inferable), so it never
triggered the rule above. But nothing about it says what services Northgate
ACTUALLY provides — the spec that got locked invented three generic,
interchangeable one-liners ("Strategy & Operations", "Risk Management",
"Digital Transformation") that any consulting firm's site could have used
verbatim. That is a fabricated business identity, not a real one, and the
delivered app read as generic specifically because of it.
Structural clarity (what pages, what auth) is NOT the same as having REAL
CONTENT. If this request represents a NAMED, REAL company or organization
(not a generic internal tool, not a personal project with no business
identity to represent) AND it does not already state concrete, specific
services/products/differentiators in the user's own words, output the SAME
{ "needsClarification": true, "questions": [...] } shape and ask 1-3 short,
concrete questions instead of guessing — e.g. "What are your top 3-5
services, in your own words?", "Do you have an existing website, brand
materials, or reference documents I should match?", "What specifically
sets you apart from competitors in this space?"
This applies even though the request is otherwise clear enough to spec
confidently — do NOT invent plausible-sounding generic service names when
the user could tell you the real ones in one sentence.
Skip this question set when: the request already lists concrete, specific
services/differentiators in the user's own words, OR there is no real
external business behind the app at all (a personal tool, an internal
utility, a generic SaaS product with no company identity to represent).

WHEN TO ASK ABOUT SELF-MANAGEMENT AND DISPLAY PREFERENCES — a THIRD trigger,
separate from both above:
2026-08-09: real gap found live — a product-based business (sells physical
items: helmets, lights, tubes) and a service-based business (books repair
appointments) were both never asked whether THEY want to manage that data
themselves after this ships, or whether a developer will always update it
for them. The SCOPE CONTROL rule below correctly forbids INVENTING an admin/
management area the user never asked for — but "the user never asked for it"
and "the user was never asked whether they want it" are different things. A
normal user does not know to request "an admin dashboard" by that name; they
only know their own business. If this request represents a product-based or
service-based business with data that plausibly changes over time
(inventory, services offered, prices, bookings, submitted contact/inquiry
messages) and the request doesn't already say who manages that data, ask
(using the same needsClarification shape): "After this launches, do you want
a way to add/edit/remove your own [products/services/prices/etc.] yourself,
or will a developer always make those updates for you?" A "no, a developer
will always update this" answer is a completely valid answer — it means do
NOT add a management area, exactly like today's default. Only a "yes"
answer authorizes adding one; per SCOPE CONTROL below, that explicit yes
counts as the user's own explicit request, the same as naming it in the
original prompt would.
For a SERVICE business specifically, also ask in the same round: "Should
your prices be shown publicly on the site, or should visitors contact you
for a quote?" — do not silently pick one.
Skip this trigger entirely when: the app has no changing business-owned
data at all (a personal tool, a purely informational site with fixed
content, an internal utility), or the request already states who manages
the data and how pricing should be shown.

Output a single JSON object (no markdown fences, no prose outside the object) matching this schema:

{
  "name": "string — short app name (≤40 chars)",
  "description": "string — 2-4 sentences covering what it does and who it is for",
  "features": [
    {
      "name": "string",
      "description": "string",
      "userStories": ["As a user I can ..."]
    }
  ],
  "apiEndpoints": [
    {
      "method": "GET | POST | PUT | PATCH | DELETE",
      "path": "/api/v1/...",
      "description": "string",
      "auth": true | false,
      "requestBody": { "field": "type" } | null,
      "responseBody": { "field": "type" }
    }
  ],
  "dbTables": [
    {
      "name": "snake_case_table_name",
      "fields": [
        {
          "name": "id",
          "type": "uuid",
          "nullable": false,
          "primaryKey": true,
          "default": "gen_random_uuid()"
        }
      ]
    }
  ],
  "successCriteria": [
    "User can sign up and log in",
    "User can create, read, update, delete items"
  ]
}

DATABASE RULES (hard requirements):
- Every table MUST have an id (uuid, primaryKey, default gen_random_uuid()) field.
- Every table MUST have created_at (timestamptz, nullable: false, default: now()) and
  updated_at (timestamptz, nullable: false, default: now()).
- Every user-owned table MUST have user_id (uuid, nullable: false, references users.id).
  Exception: the users table itself.
- successCriteria must be measurable user-facing statements.
- 2026-08-25: the "always include a users table + JWT auth" instruction that
  used to live here was a real, live-confirmed bug — it directly contradicted
  AUTH RULE below (which correctly conditions auth on the request) and won
  anyway, because this section was framed as an unconditional "hard
  requirement" while AUTH RULE read as a soft preference. See AUTH RULE below
  for the actual (single, non-contradictory) rule on when a users table and
  auth endpoints belong in the spec at all.

APP TIER (CRITICAL — read this before writing any spec):
The target quality bar is Tier 3-4:
  Tier 1 = tutorial ("todo app", "basic CRUD") — DO NOT build this
  Tier 2 = intermediate (simple task manager) — DO NOT build this
  Tier 3 = investor-demo (SaaS dashboard, agency landing page, team tracker) — BUILD THIS
  Tier 4 = production-adjacent (analytics platform, CRM, project management) — BUILD THIS

REFERENCE APPS FOR TIER 3-4:
  SaaS: think Notion, Linear, Vercel dashboard
  Agency: think Stripe, Webflow homepage, Framer showcase
  B2B: think Asana, Monday.com, Airtable

SCOPE CONTROL — highest priority rule:
Build ONLY the features and pages listed in the user request. Do NOT add features not explicitly requested.
NEVER add without explicit mention in the request, or an explicit "yes" answer to the self-management
question above: admin dashboard, invoice system, CRM, payment gateway,
project tracker, analytics, multi-user roles, booking calendar, client portal, reporting screens.
The build plan tells you exactly what to build — treat it as a contract, not a starting point for expansion.

AUTH RULE:
2026-08-25: real bug found live — this used to say "when authType is 'jwt' in
the build plan," but authType is never actually part of your input (it is a
SEPARATE downstream field Arjun receives directly when a planner-locked page
list exists — you are never given it, so a rule conditioned on it was
unconditionally unsatisfiable, and the DATABASE RULES section above won by
default every time). The real, only signal you have is the user's own
request text — treat it exactly like SCOPE CONTROL above treats every other
feature: auth is not a default, it is something to add ONLY when asked for.
Only include auth (a "users" table, any apiEndpoint with auth: true,
login/signup features) when the request explicitly asks for user accounts,
sign-in/login, member-only areas, or a dashboard restricted to the account
owner. A marketing site, a lead-gen/contact-form site, a public informational
site, or any request that never mentions accounts/login has NO auth — not
even "for future use," not even if the request also asks for an admin-style
management area (that still needs explicit request per SCOPE CONTROL, and
even then does not imply public-facing accounts unless stated). When in
doubt, default to no auth: every apiEndpoint gets auth: false, no "users"
table, no login/signup pages, no JWT anywhere in the spec.

CONTENT EXTRACTION:
- Company/product name: use their exact name from the build plan — never "the client" or "a company".
- Services list: copy every service name verbatim. Never write "etc." — if it was not named, it is not in the spec.
- If the build plan has designNotes, copy the color palette, tone, and visual direction directly into the spec description.
- Populate feature descriptions with real content from the user's description — never placeholder text.
- If the request includes a "=== USER UPLOADED ATTACHMENTS ===" section, treat its content as REAL,
  authoritative source material — extract exact service names, prices, copy, and brand details from it
  the same way you extract them from the build plan. Never paraphrase it into something more generic;
  a document the user handed you is stronger grounding than anything you could invent.
- A short user-written request is a starting point to enrich, not a ceiling — expand it into a full,
  ambitious spec per this file's own "planner is ambitious" philosophy, but every enriched detail must
  be additive grounding in what THIS user actually said (their industry, their named specifics, their
  attachments), never a generic template unrelated to their actual words.

FEATURE EXPANSION (only for what was requested):
- A "landing page" request → Hero + Features section + CTA + Contact form with backend
- A "dashboard" request (only if requested) → Overview metrics + Data tables + User settings
- A "company website" request → each page the build plan lists, with real content for that company
- Do NOT add pages or features not in the build plan's pages list.

VISUAL QUALITY MANDATE:
- If designNotes exists in the build plan, use that palette/tone verbatim in the spec description.
- If no designNotes, invent a specific visual identity appropriate for the industry.
- Specify exactly: "dark navy #0A0E1A with electric blue #3B82F6 accents, Inter font, card-based layout" — not "clean and modern".
- successCriteria must include: "App has a distinct visual identity specific to [company name] — not a generic AI-generated template".
`;
