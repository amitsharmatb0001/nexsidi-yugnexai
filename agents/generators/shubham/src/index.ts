// Shubham — Express backend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run tsc → fix → repeat.
// No longer does one-shot LLM generation. Agent ACTS on real tool feedback.

import { resolveGeneratorRunner } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { BuildPlan } from "../../../arjun/src/index.ts";

export interface GeneratorResult {
  success: boolean;
  projectId: string;
  outputDir: string;
  filesWritten: string[];
  errors: string[];
}

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", projectId, "backend");
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
    const { queryRecentInstincts, formatInstinctsForPrompt } = await import("@nexsidi/db");
    const instincts = await queryRecentInstincts("security");
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
    // qwen3.5-122b: confirmed working under 80K+ token inputs in stress-3's
    // QA fallbacks — a genuinely different architecture for the second try.
    fallbackModels: ["qwen/qwen3.5-122b-a10b"],
    apiKey,
    systemPrompt: knownMistakesPrefix + SHUBHAM_AGENT_SYSTEM_PROMPT,
    initialMessage: buildAgentTask(plan),
    sandboxDir: outputDir,
    enableHttpTools: false, // HTTP verification done by Riya after docker up
  });

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
export function buildFixTask(findings: string[]): string {
  return `An adversarial QA review found the following issues in the backend code you already wrote. Fix ONLY these specific issues — do not rewrite unrelated files, do not refactor working code that wasn't flagged.

ISSUES TO FIX:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Workflow:
1. Use read_file to see the exact current content of each affected file
2. Use edit_file for targeted fixes (cheaper than rewriting the whole file) — use write_file only if the fix genuinely requires touching most of the file
3. Run "npx tsc --noEmit" (or the project's build command) to verify nothing broke
4. Call task_complete with verification_passed: true only after verifying the fix actually addresses the issue`;
}

export async function runFix(plan: BuildPlan, findings: string[]): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId); // SAME dir run() wrote to — not regenerated

  const result = await resolveGeneratorRunner()({
    agentName: "shubham",
    model: "mistralai/mistral-medium-3.5-128b",
    fallbackModels: ["qwen/qwen3.5-122b-a10b"],
    apiKey,
    systemPrompt: SHUBHAM_AGENT_SYSTEM_PROMPT,
    initialMessage: buildFixTask(findings),
    sandboxDir: outputDir,
    enableHttpTools: false,
  });

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    errors: result.errors,
  };
}

// ── Agent system prompt — agentic mode ───────────────────────────────────────
const SHUBHAM_AGENT_SYSTEM_PROMPT = `\
You are Shubham, a senior Express + TypeScript backend engineer.
You have been given tools to write files and run commands directly.
You DO NOT output text — you USE TOOLS to create the project.

Your workflow:
1. Use write_file to create every backend file (routes, controllers, middleware, types)
2. Use run_command "npm install" to install dependencies
3. Use run_command "npx tsc --noEmit" to type-check
4. If tsc reports errors: use read_file to read the failing file, use write_file to fix it, run tsc again
5. When tsc passes: use run_command "npm run build" to compile
6. When build passes: call task_complete with verification_passed: true

STACK (non-negotiable):
- Express 4.x / TypeScript / Node 22 / commonjs
- Auth: @clerk/express — getAuth(req) returns ONLY { userId, sessionId }
  NEVER access .email on auth result. No email property exists.
- DB: PostgreSQL via "pg" Pool with parameterized queries ($1, $2)
- Security: helmet() + cors with CORS_ORIGIN env var

STATIC FILES ALREADY WRITTEN (DO NOT write these):
- package.json, tsconfig.json, Dockerfile
- src/index.ts (entry point with helmet, cors, clerkMiddleware, route mounting)
- src/routes/index.ts (auto-generated after you write route files)
- src/types/requests.ts (CreateTaskRequest, UpdateTaskRequest)

FILES YOU MUST WRITE:
- src/middleware/clerk-auth.ts (requireAuth middleware)
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
8. Available packages: express, @clerk/express, pg, cors, helmet, dotenv, zod, express-rate-limit
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

VERIFICATION GATE: Do not call task_complete until "npx tsc --noEmit" exits 0.
If you cannot fix tsc errors after 5 attempts, call task_complete with verification_passed: false
and explain exactly what failed.
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

function buildAgentTask(plan: BuildPlan): string {
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

Start by using list_files to see what scaffold files are already present,
then write the business logic files using write_file,
then verify with run_command.`;
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
          "@clerk/express": "^2.3.0",
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
import { clerkMiddleware } from "@clerk/express";
import routes from "./routes/index";

const app = express();
const port = Number(process.env.PORT) || ${port};

app.use(express.json());
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000", credentials: true }));
app.use(clerkMiddleware());
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
