// Arjun — Pipeline lead + planner
// ProjectSpec → full BuildPlan: API contract, DB schema, independent task lists.
// Uses Mistral Nemotron via NIM.
// D22: ambitious — not minimal. D23: sprint contracts in files before code starts.

import { agentChat } from "@nexsidi/llm-client";
import { hashContext } from "@nexsidi/context-chain";
import type { ProjectSpec } from "../../saanvi/src/index.ts";
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
}

// ── Main entry ────────────────────────────────────────────────────────────────
// `deps` is injectable (defaults to the real agentChat) for the same reason
// as Saanvi's run() — see agents/saanvi/src/index.ts's SaanviDeps comment.
export async function run(spec: ProjectSpec, deps: ArjunDeps = { chat: agentChat }): Promise<BuildPlan> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const messages = [
    { role: "system" as const, content: ARJUN_SYSTEM_PROMPT },
    { role: "user" as const, content: JSON.stringify(spec, null, 2) },
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
  const raw = rawResult as Omit<BuildPlan, "projectId" | "buildPlanHash">;

  const plan: Omit<BuildPlan, "buildPlanHash"> = {
    projectId: spec.projectId,
    appName: spec.name,
    appDescription: spec.description,
    sharedTypes: typeof raw.sharedTypes === "string" ? raw.sharedTypes : "",
    apiContract: {
      baseUrl: "http://localhost:3001",
      endpoints: Array.isArray(raw.apiContract?.endpoints) ? raw.apiContract.endpoints : [],
    },
    dbSchema: {
      tables: Array.isArray(raw.dbSchema?.tables) ? raw.dbSchema.tables : [],
    },
    shubhamTasks:        Array.isArray(raw.shubhamTasks)        ? raw.shubhamTasks        : [],
    aanyaTasks:          Array.isArray(raw.aanyaTasks)          ? raw.aanyaTasks          : [],
    pranavTasks:         Array.isArray(raw.pranavTasks)         ? raw.pranavTasks         : [],
    independenceVerified: raw.independenceVerified === true,
  };

  // Write sprint contracts to disk (D23) — generators read these before starting
  writePlanFiles(spec.projectId, plan);

  return { ...plan, buildPlanHash: hashContext(plan) };
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
const ARJUN_SYSTEM_PROMPT = `\
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
`;
