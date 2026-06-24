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
  auth: { provider: "clerk"; features: Array<"sign-in" | "sign-up"> };
  apiEndpoints: ApiEndpoint[];
  dbTables: DbTable[];
  successCriteria: string[];
  lockedAt: string;
  specHash: string; // SHA-256 of spec before this field — immutable after lock
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function run(projectId: string, userRequest: string): Promise<ProjectSpec> {
  const apiKey = process.env.NIM_API_KEY ?? "";

  const { content } = await agentChat(
    "saanvi",
    [
      { role: "system", content: SAANVI_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Project ID: ${projectId}\n\nUser request:\n${userRequest}\n\nOutput ONLY the JSON object. No markdown, no prose.`,
      },
    ],
    apiKey,
  );

  const raw = parseJson(content) as Omit<ProjectSpec, "projectId" | "lockedAt" | "specHash">;

  const spec: Omit<ProjectSpec, "specHash"> = {
    projectId,
    name: String(raw.name ?? "Untitled"),
    description: String(raw.description ?? ""),
    appType: "web",
    features: Array.isArray(raw.features) ? raw.features : [],
    auth: { provider: "clerk", features: ["sign-in", "sign-up"] },
    apiEndpoints: Array.isArray(raw.apiEndpoints) ? raw.apiEndpoints : [],
    dbTables: Array.isArray(raw.dbTables) ? raw.dbTables : [],
    successCriteria: Array.isArray(raw.successCriteria) ? raw.successCriteria : [],
    lockedAt: new Date().toISOString(),
  };

  // Patent Claim 1: hash the spec at lock-time — immutable from here
  return { ...spec, specHash: hashContext(spec) };
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
const SAANVI_SYSTEM_PROMPT = `\
You are a requirements analyst. Convert a user's app idea into a precise, structured JSON specification.

Output a single JSON object (no markdown fences, no prose outside the object) matching this schema:

{
  "name": "string — short app name (≤40 chars)",
  "description": "string — 1-3 sentence summary",
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

Rules:
- Every table MUST have an id (uuid, primaryKey, default gen_random_uuid()) field.
- Every table MUST have created_at (timestamptz, nullable: false, default: now()) and
  updated_at (timestamptz, nullable: false, default: now()).
- Every user-owned table MUST have user_id (uuid, nullable: false, references users.id).
  Exception: the users table itself.
- Include a "users" table: id (uuid PK), clerk_id (text, unique, NOT NULL), email (text, unique, NOT NULL).
- Auth: Clerk handles sign-in/sign-up — do NOT design custom auth tables or JWT logic.
- Be AMBITIOUS: include all features the user mentioned. Do not simplify or cut corners.
- successCriteria must be measurable user-facing statements.
`;
