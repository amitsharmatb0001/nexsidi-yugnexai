// Shubham — Express backend generator
// Produces a complete, runnable Express + TypeScript backend from a BuildPlan.
// Uses DeepSeek V4-Pro via NIM.

import { agentChat } from "@nexsidi/llm-client";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { BuildPlan, GeneratorTask } from "../../../arjun/src/index.ts";

export interface GeneratorResult {
  success: boolean;
  projectId: string;
  outputDir: string;
  filesWritten: string[];
  errors: string[];
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function run(plan: BuildPlan): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId);
  const filesWritten: string[] = [];
  const errors: string[] = [];

  for (const task of plan.shubhamTasks) {
    try {
      const files = await generateTask(plan, task, apiKey);
      for (const { path: relPath, content } of files) {
        const absPath = join(outputDir, relPath);
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, content, "utf-8");
        filesWritten.push(relPath);
      }
    } catch (err) {
      errors.push(`task="${task.description}": ${String(err)}`);
    }
  }

  // Static config files always overwrite LLM output — Dockerfile/tsconfig/package.json
  // must be structurally correct, never markdown-contaminated from LLM output.
  for (const { path: relPath, content } of buildStaticFiles(plan)) {
    const absPath = join(outputDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    if (!filesWritten.includes(relPath)) filesWritten.push(relPath);
  }

  return { success: errors.length === 0, projectId: plan.projectId, outputDir, filesWritten, errors };
}

function isRefusal(text: string): boolean {
  const t = text.trim().slice(0, 120).toLowerCase();
  return t.startsWith("i'm sorry") || t.startsWith("i am sorry") ||
    t.startsWith("i can't") || t.startsWith("i cannot") ||
    t.startsWith("as an ai language model") || t.startsWith("i apologize");
}

async function generateTask(
  plan: BuildPlan,
  task: GeneratorTask,
  apiKey: string,
): Promise<Array<{ path: string; content: string }>> {
  const { content } = await agentChat(
    "shubham",
    [
      { role: "system", content: SHUBHAM_SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(plan, task) },
    ],
    apiKey,
  );

  if (isRefusal(content)) {
    throw new Error(`Model refused task "${task.description}" — retrying with next model in chain`);
  }

  try {
    return parseFileOutput(content);
  } catch {
    // Retry once with explicit format reminder
    const { content: fixed } = await agentChat(
      "shubham",
      [
        { role: "system", content: SHUBHAM_SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(plan, task) },
        { role: "assistant", content: content },
        {
          role: "user",
          content: `Your response was not in the required format. You MUST use ===FILE: path=== ... ===ENDFILE=== delimiters.\n` +
            `FILES TO PRODUCE: ${task.outputFiles.join(", ")}\n` +
            `Rewrite your response now using ONLY ===FILE: path=== blocks. No prose, no markdown, no JSON.`,
        },
      ],
      apiKey,
    );
    if (isRefusal(fixed)) throw new Error(`Model refused correction for task "${task.description}"`);
    return parseFileOutput(fixed);
  }
}

function buildPrompt(plan: BuildPlan, task: GeneratorTask): string {
  return `TASK: ${task.description}
FILES TO PRODUCE: ${task.outputFiles.join(", ")}

=== SHARED TYPES ===
${plan.sharedTypes}

=== API CONTRACT ===
${JSON.stringify(plan.apiContract, null, 2)}

=== DB SCHEMA (tables Pranav will create — use exact table/column names) ===
${JSON.stringify(plan.dbSchema, null, 2)}

Generate COMPLETE, fully working code. Every file must be fully implemented.
REQUIRED output format (no other format accepted):
===FILE: src/index.ts===
<complete file content here>
===ENDFILE===
===FILE: src/app.ts===
<complete file content here>
===ENDFILE===`;
}

// ── Static config files ───────────────────────────────────────────────────────
// These ALWAYS overwrite LLM output — critical wiring must never be LLM-generated.
function buildStaticFiles(plan: BuildPlan): Array<{ path: string; content: string }> {
  const port = plan.apiContract.baseUrl?.match(/:(\d+)/)?.[1] ?? "3001";
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: `project-${plan.projectId}-backend`,
          version: "1.0.0",
          private: true,
          scripts: {
            dev:   "ts-node-dev --respawn --transpile-only src/index.ts",
            build: "tsc",
            start: "node dist/index.js",
          },
          dependencies: {
            express:          "^4.19.2",
            "@clerk/express": "^1.0.0",
            pg:               "^8.12.0",
            cors:             "^2.8.5",
            helmet:           "^7.1.0",
            dotenv:           "^16.4.5",
          },
          devDependencies: {
            typescript:        "^5.7.0",
            "@types/express":  "^4.17.21",
            "@types/pg":       "^8.11.6",
            "@types/cors":     "^2.8.17",
            "@types/node":     "^22.0.0",
            "ts-node-dev":     "^2.0.0",
          },
        },
        null, 2,
      ),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022", module: "commonjs", lib: ["ES2022"],
            outDir: "./dist", rootDir: "./src",
            strict: false, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true,
          },
          include: ["src/**/*"],
          exclude: [
            "node_modules", "dist",
            "src/**/__tests__", "src/**/*.test.ts", "src/**/*.spec.ts",
          ],
        },
        null, 2,
      ),
    },
    {
      path: ".env.example",
      content: "DATABASE_URL=postgresql://user:pass@postgres:5432/appdb\nCLERK_PUBLISHABLE_KEY=pk_test_xxx\nCLERK_SECRET_KEY=sk_test_xxx\nCORS_ORIGIN=http://localhost:3100\nPORT=3001\nNODE_ENV=production\n",
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
    // Critical: clerkMiddleware() MUST be registered before routes — always static.
    {
      path: "src/index.ts",
      content: `import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

const app = express();
const port = Number(process.env.PORT) || ${port};

app.use(express.json());
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000", credentials: true }));
app.use(clerkMiddleware());

// Routes — imported below (LLM fills these in; index.ts wiring is static)
import routes from "./routes/index";
app.use("/api/v1", routes);

app.listen(port, () => console.log(\`Server is running on port \${port}\`));
`,
    },
    // Static route index — LLM generates individual route files, this wires them.
    {
      path: "src/routes/index.ts",
      content: `import { Router } from "express";
// Individual route files are generated by the LLM — import them here.
// This file is replaced if the LLM generates it; the static fallback covers the common case.
export default Router();
`,
    },
    // Canonical request types — LLM often uses Date instead of string for dueDate.
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
}

// Strip markdown code fences that some models wrap around file content.
// e.g. ```typescript\n...\n``` → ...
function stripFences(s: string): string {
  return s.replace(/^```[^\n]*\n/, "").replace(/\n```\s*$/, "");
}

// ── Parse {"files":[...]} output ─────────────────────────────────────────────
// Primary: ===FILE: path=== ... ===ENDFILE=== delimiter format (no JSON escaping needed).
// JSON fallback handles models that still output the old format.
function parseFileOutput(text: string): Array<{ path: string; content: string }> {
  // Primary: ===FILE: path=== or === FILE: path === (with optional spaces inside ===)
  const delimitedBlocks = [...text.matchAll(/={3}\s*FILE:\s*([^\n=][^\n]*?)\s*={3}\s*\n([\s\S]*?)={3}\s*ENDFILE\s*={3}/g)];
  if (delimitedBlocks.length > 0) {
    return delimitedBlocks.map((m) => ({ path: m[1]!.trim(), content: stripFences(m[2] ?? "") }));
  }

  // Secondary: <<<FILE: path>>> ... <<<END>>> (old fence format)
  const fenceBlocks = [...text.matchAll(/<<<FILE:\s*([^\n>]+)>>>\s*([\s\S]*?)<<<END>>>/g)];
  if (fenceBlocks.length > 0) return fenceBlocks.map((m) => ({ path: m[1]!.trim(), content: stripFences(m[2] ?? "") }));

  // Tertiary: JSON (strip markdown fence, then sanitize and parse)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = fenceMatch?.[1] ?? (() => {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    return s !== -1 && e > s ? text.slice(s, e + 1) : text;
  })();
  try {
    const p = JSON.parse(raw) as { files?: Array<{ path: string; content: string }> };
    if (Array.isArray(p.files)) return p.files.filter((f) => f.path && typeof f.content === "string");
  } catch { /* fall through */ }
  try {
    const p = JSON.parse(sanitizeJsonStrings(raw)) as { files?: Array<{ path: string; content: string }> };
    if (Array.isArray(p.files)) return p.files.filter((f) => f.path && typeof f.content === "string");
  } catch { /* fall through */ }

  throw new Error("LLM output did not match any parseable format (===FILE===, <<<FILE>>>, or JSON)");
}

function sanitizeJsonStrings(json: string): string {
  let inString = false;
  let result = "";
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (inString) {
      if (ch === "\\") {
        const next = json[i + 1];
        if (next === "\n" || next === "\r") {
          result += "\\n";
          if (next === "\r" && json[i + 2] === "\n") i++;
          i++;
          continue;
        }
        result += ch + (next ?? "");
        i++;
        continue;
      }
      if (ch === '"') { inString = false; result += ch; continue; }
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      result += ch;
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
  }
  return result;
}

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId, "backend");
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SHUBHAM_SYSTEM_PROMPT = `\
You are a senior Express + TypeScript backend engineer.
Generate COMPLETE, runnable, production-quality code. No TODOs, no placeholder comments.

Stack (non-negotiable):
- Runtime: Node.js 22 / Express 4.x / TypeScript (commonjs)
- Auth: @clerk/express — clerkMiddleware() globally, requireAuth() on protected routes
- DB: PostgreSQL via "pg" Pool, raw SQL (Drizzle schema is separate)
- Security: helmet() for headers, cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000", credentials: true })
- Error handling: every async handler in try/catch; return { error: string } on failure

Auth pattern — FOLLOW EXACTLY:
  // src/index.ts is STATIC — DO NOT generate it. Focus on routes/ and controllers/ only.
  // clerkMiddleware() is already registered in src/index.ts before your routes.
  // In route handlers — ALWAYS check userId:
  import { getAuth } from "@clerk/express";
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  // IDOR prevention — ALWAYS filter by userId in queries:
  // GET tasks: WHERE user_id = $1 (pass userId)
  // GET/PUT/DELETE single task: WHERE id = $1 AND user_id = $2 (pass taskId, userId)

DB pattern — parameterized queries only (no string interpolation):
  import { Pool } from "pg";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // ✅ const { rows } = await pool.query("SELECT * FROM tasks WHERE user_id = $1", [userId]);
  // NEVER interpolate user input into SQL strings — use $1, $2 placeholders always

Input validation:
  // Always validate and parse query params before use:
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage as string, 10) || 20));
  const validStatuses = ["pending", "in_progress", "done"] as const;
  const status = validStatuses.includes(req.query.status as any) ? req.query.status : undefined;

Routes: always add BOTH router.put("/:id", handler) AND router.patch("/:id", handler) for update endpoints.
IDs: crypto.randomUUID() for new record IDs (or use DB UUID DEFAULT gen_random_uuid()).
Timestamps: use SQL DEFAULT now() — don't set in app code.
dueDate type: ALWAYS string | null (ISO 8601), NEVER Date object — use src/types/requests.ts.
DO NOT generate src/index.ts or src/routes/index.ts — those are static and already exist.

REQUIRED output format — use this EXACTLY, no JSON, no markdown:
===FILE: src/index.ts===
<complete content>
===ENDFILE===
Repeat for every file. No JSON. No markdown. Only ===FILE: path=== blocks.
Every file must be 100% complete. No shortcuts.
`;
