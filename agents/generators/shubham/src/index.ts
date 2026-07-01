// Shubham — Express backend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run tsc → fix → repeat.
// No longer does one-shot LLM generation. Agent ACTS on real tool feedback.

import { runAgent } from "@nexsidi/agent-runtime";
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

// ── Main entry ────────────────────────────────────────────────────────────────
export async function run(plan: BuildPlan): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId);
  mkdirSync(outputDir, { recursive: true });

  // Write static scaffold first — agent focuses only on business logic
  writeStaticScaffold(plan, outputDir);

  const result = await runAgent({
    agentName: "shubham",
    model: "moonshotai/kimi-k2.6",
    apiKey,
    systemPrompt: SHUBHAM_AGENT_SYSTEM_PROMPT,
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

VERIFICATION GATE: Do not call task_complete until "npx tsc --noEmit" exits 0.
If you cannot fix tsc errors after 5 attempts, call task_complete with verification_passed: false
and explain exactly what failed.
`;

function buildAgentTask(plan: BuildPlan): string {
  return `Build a complete Express + TypeScript backend for this project.

PROJECT: ${plan.appName ?? "web app"}
DESCRIPTION: ${plan.appDescription ?? ""}

API CONTRACT (implement ALL these endpoints):
${JSON.stringify(plan.apiContract, null, 2)}

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
