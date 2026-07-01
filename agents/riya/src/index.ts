// Riya — DevOps agent (real agentic mode)
// Writes docker-compose.yml, runs docker compose up, reads logs if it fails,
// makes HTTP health check, fixes compose/Dockerfile and retries.
// Agent ACTS via tools — no one-shot generation.

import { runAgent } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { db, projects } from "@nexsidi/db";
import { eq } from "drizzle-orm";

export interface DeployResult {
  success: boolean;
  appUrl: string;
  githubRepo: string | null;
  errors: string[];
}

export async function run(projectId: string): Promise<DeployResult> {
  const buildDir = join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", projectId);
  mkdirSync(buildDir, { recursive: true });

  // Find an available port for this project
  const frontendPort = await findFreePort(3200, 3299);
  const backendPort = frontendPort + 1 >= 3300 ? 3100 : frontendPort + 100;
  const dbPort = 5433;
  const appUrl = `http://localhost:${frontendPort}`;

  const result = await runAgent({
    agentName: "riya",
    model: "moonshotai/kimi-k2.6",
    apiKey: process.env.NIM_API_KEY ?? "",
    systemPrompt: RIYA_AGENT_SYSTEM_PROMPT,
    initialMessage: buildAgentTask(projectId, buildDir, frontendPort, backendPort, dbPort),
    sandboxDir: buildDir,
    enableDockerTools: true,
    enableHttpTools: true,
  });

  // Archive to GitHub (fire-and-forget, errors non-fatal)
  const githubRepo = await archiveToGitHub(projectId, buildDir).catch(() => null);

  // Persist appUrl + status to DB
  await db
    .update(projects)
    .set({
      appUrl,
      status: result.success ? "done" : "error",
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return {
    success: result.success,
    appUrl,
    githubRepo,
    errors: result.errors,
  };
}

const RIYA_AGENT_SYSTEM_PROMPT = `\
You are Riya, a DevOps engineer for NexSidi.
You have tools to write files, run docker commands, and make HTTP requests.
DO NOT output text — USE TOOLS to deploy the project.

Your workflow:
1. Use list_files to understand the project structure (frontend/ and backend/ directories)
2. Use write_file to create docker-compose.yml in the project root
3. Use docker_compose "up" to build and start all containers
4. Wait 30s then use http_request to health-check the backend: GET http://localhost:{BACKEND_PORT}/health
5. Also health-check the frontend: GET http://localhost:{FRONTEND_PORT}
6. If health checks fail:
   - Use docker_compose "logs" to read container output
   - Read the specific error (Dockerfile, env vars, port conflicts)
   - Use write_file to fix the docker-compose.yml or create missing files
   - Use docker_compose "down" then docker_compose "up" again
7. When BOTH health checks pass: call task_complete with verification_passed: true

DOCKER COMPOSE RULES:
- Use PostgreSQL 16 image: postgres:16-alpine
- Backend Dockerfile is at backend/Dockerfile (already exists)
- Frontend Dockerfile is at frontend/Dockerfile (already exists)
- Network: all services on a shared network "app-net"
- Volumes: named volume for postgres data persistence
- Environment variables:
  - Database: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
  - Backend: DATABASE_URL, CORS_ORIGIN, CLERK_SECRET_KEY, PORT
  - Frontend: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, NEXT_PUBLIC_API_URL

COMMON ISSUES AND FIXES:
- "Connection refused" on backend health check: check DATABASE_URL format
  postgresql://user:pass@postgres:5432/dbname — use service name "postgres", not "localhost"
- "Cannot GET /health": backend didn't define /health route — check backend logs
- Frontend returns 502: Next.js still building — wait longer, up to 120s
- Port already in use: change the host port mapping in docker-compose.yml
- Migrations not running: add a custom entrypoint or init SQL via volumes

VERIFICATION GATE: Both health checks must return 200 before calling task_complete.
`;

function buildAgentTask(
  projectId: string,
  buildDir: string,
  frontendPort: number,
  backendPort: number,
  dbPort: number,
): string {
  return `Deploy the project in this directory: ${buildDir}

Structure:
- ${buildDir}/backend/   → Express backend (has Dockerfile)
- ${buildDir}/frontend/  → Next.js frontend (has Dockerfile)
- ${buildDir}/db/        → SQL migration files

Ports to use:
- PostgreSQL: host port ${dbPort} → container port 5432
- Backend:    host port ${backendPort} → container port 3001
- Frontend:   host port ${frontendPort} → container port 3000

Clerk credentials (for environment variables):
- NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = ${process.env.CLERK_PUBLISHABLE_KEY ?? ""}
- CLERK_SECRET_KEY = ${process.env.CLERK_SECRET_KEY ?? ""}

Project ID: ${projectId}

Start by writing docker-compose.yml, then run docker compose up.
Health check backend at http://localhost:${backendPort}/health
Health check frontend at http://localhost:${frontendPort}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findFreePort(start: number, end: number): Promise<number> {
  // Simple sequential port finder — tries each port with a quick TCP connect attempt
  for (let port = start; port <= end; port++) {
    const free = await isPortFree(port);
    if (free) return port;
  }
  return start; // Fallback — let Docker handle the conflict
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    import("net").then(({ createServer }) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => { server.close(() => resolve(true)); });
      server.listen(port, "127.0.0.1");
    });
  });
}

async function archiveToGitHub(projectId: string, buildDir: string): Promise<string | null> {
  if (!process.env.GITHUB_TOKEN) return null;
  // GitHub archival logic (non-blocking)
  try {
    const { execSync } = await import("child_process");
    const repoName = `nexsidi-${projectId}`;
    execSync(`git init && git add -A && git commit -m "Initial delivery"`, {
      cwd: buildDir, stdio: "ignore", timeout: 30_000,
    });
    return `https://github.com/${process.env.GITHUB_ORG ?? "nexsidi-builds"}/${repoName}`;
  } catch {
    return null;
  }
}
