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

  // Static config files — no LLM needed
  for (const { path: relPath, content } of buildStaticFiles(plan)) {
    if (!filesWritten.includes(relPath)) {
      const absPath = join(outputDir, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, "utf-8");
      filesWritten.push(relPath);
    }
  }

  return { success: errors.length === 0, projectId: plan.projectId, outputDir, filesWritten, errors };
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
  return parseFileOutput(content);
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

Generate COMPLETE, production-ready code. Every file must be fully implemented.
Output ONLY JSON: { "files": [{ "path": "...", "content": "..." }] }`;
}

// ── Static config files ───────────────────────────────────────────────────────
function buildStaticFiles(plan: BuildPlan): Array<{ path: string; content: string }> {
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
            strict: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist"],
        },
        null, 2,
      ),
    },
    {
      path: ".env.example",
      content: "DATABASE_URL=postgresql://user:pass@postgres:5432/appdb\nCLERK_PUBLISHABLE_KEY=pk_test_xxx\nCLERK_SECRET_KEY=sk_test_xxx\nPORT=3001\nNODE_ENV=production\n",
    },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
`,
    },
  ];
}

// ── Parse {"files":[...]} output ─────────────────────────────────────────────
function parseFileOutput(text: string): Array<{ path: string; content: string }> {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = fenceMatch?.[1] ?? (() => {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    return s !== -1 && e > s ? text.slice(s, e + 1) : text;
  })();
  const parsed = JSON.parse(jsonStr) as { files?: Array<{ path: string; content: string }> };
  if (!Array.isArray(parsed.files)) throw new Error("LLM output missing `files` array");
  return parsed.files.filter((f) => f.path && typeof f.content === "string");
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
- Security: helmet() for headers, cors({ origin: "http://localhost:3000", credentials: true })
- Error handling: every async handler in try/catch; return { error: string } on failure

Clerk pattern:
  import { clerkMiddleware, requireAuth, getAuth } from "@clerk/express";
  const { userId } = getAuth(req); // in protected routes

DB pattern:
  import { Pool } from "pg";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

IDs: crypto.randomUUID() for new record IDs.
Timestamps: use SQL DEFAULT now() — don't set in app code.

Output ONLY: { "files": [{ "path": "src/...", "content": "..." }] }
Every file must be 100% complete. No shortcuts.
`;
