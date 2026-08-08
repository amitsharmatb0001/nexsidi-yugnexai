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
  auth: { provider: "custom"; features: Array<"sign-in" | "sign-up"> };
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

  const spec: Omit<ProjectSpec, "specHash"> = {
    projectId,
    name: String(raw.name ?? "Untitled"),
    description: String(raw.description ?? ""),
    appType: "web",
    features: Array.isArray(raw.features) ? raw.features : [],
    auth: { provider: "custom", features: ["sign-in", "sign-up"] },
    apiEndpoints: Array.isArray(raw.apiEndpoints) ? raw.apiEndpoints : [],
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
- Include a "users" table: id (uuid PK), password_hash (text, NOT NULL), email (text, unique, NOT NULL), name (text, NOT NULL).
- Auth: Custom JWT authentication — design local user registration, login, and JWT middleware.
- successCriteria must be measurable user-facing statements.

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
NEVER add without explicit mention in the request: admin dashboard, invoice system, CRM, payment gateway,
project tracker, analytics, multi-user roles, booking calendar, client portal, reporting screens.
The build plan tells you exactly what to build — treat it as a contract, not a starting point for expansion.

AUTH RULE:
Only include auth (users table, login/signup endpoints) when authType is "jwt" in the build plan.
If authType is "none", do NOT add a users table, do NOT add auth endpoints, do NOT add a login page feature.
A company website with authType "none" has no authentication — not even "for future use".

CONTENT EXTRACTION:
- Company/product name: use their exact name from the build plan — never "the client" or "a company".
- Services list: copy every service name verbatim. Never write "etc." — if it was not named, it is not in the spec.
- If the build plan has designNotes, copy the color palette, tone, and visual direction directly into the spec description.
- Populate feature descriptions with real content from the user's description — never placeholder text.

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
