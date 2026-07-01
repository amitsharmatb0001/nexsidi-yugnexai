// Riya — DevOps agent
// Generates docker-compose.yml, runs the user's app, archives to GitHub.
// Fix #9: GitHub archival explicit in scope.

import { execSync } from "child_process";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import { db, projects } from "@nexsidi/db";
import { eq } from "drizzle-orm";

export interface DeployResult {
  success: boolean;
  appUrl: string;
  githubRepo: string | null;
  errors: string[];
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function run(projectId: string): Promise<DeployResult> {
  const buildDir = join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId);
  const errors: string[] = [];

  // Step 1: write docker-compose.yml
  const composePath = join(buildDir, "docker-compose.yml");
  writeFileSync(composePath, generateComposeYaml(projectId), "utf-8");

  // Step 2: docker-compose up (detached) + health-check
  let appUrl = "http://localhost:3100";
  try {
    execSync(`docker compose -f "${composePath}" up -d --build`, {
      cwd: buildDir,
      timeout: 300_000, // 5 min build timeout
      stdio: "inherit",
    });
    await waitForHealth("http://localhost:3100", 60_000);
    appUrl = "http://localhost:3100";
  } catch (err) {
    errors.push(`docker-compose: ${String(err)}`);
  }

  // Step 3: GitHub archival (Fix #9)
  const githubRepo = await archiveToGitHub(projectId, buildDir);

  // Persist appUrl + final status to DB
  await db
    .update(projects)
    .set({
      appUrl:    appUrl,
      status:    errors.length === 0 ? "done" : "error",
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return { success: errors.length === 0, appUrl, githubRepo, errors };
}

// ── Health check — polls until 200 or timeout ─────────────────────────────────
async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`App did not become healthy at ${url} within ${timeoutMs}ms`);
}

// ── Docker Compose YAML generation ───────────────────────────────────────────
function generateComposeYaml(projectId: string): string {
  const dbName = `project_${projectId.slice(0, 8).replace(/-/g, "_")}`;
  return `\
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${dbName}
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: apppassword
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/migrations/0000_initial.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d ${dbName}"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql://appuser:apppassword@postgres:5432/${dbName}
      CLERK_SECRET_KEY: \${CLERK_SECRET_KEY}
      CLERK_PUBLISHABLE_KEY: \${CLERK_PUBLISHABLE_KEY}
      CORS_ORIGIN: "http://localhost:3100"
      PORT: "3001"
      NODE_ENV: production
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: \${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
        NEXT_PUBLIC_API_URL: http://localhost:3001
    environment:
      CLERK_SECRET_KEY: \${CLERK_SECRET_KEY}
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: \${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: /sign-in
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: /sign-up
      NEXT_PUBLIC_API_URL: http://localhost:3001
    ports:
      - "3100:3000"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  postgres_data:
`;
}

// ── GitHub archival (Fix #9) ──────────────────────────────────────────────────
async function archiveToGitHub(projectId: string, buildDir: string): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  const org   = process.env.GITHUB_ORG ?? "nexsidi-projects";

  if (!token) {
    console.warn("[riya] GITHUB_TOKEN not set — skipping GitHub archival");
    return null;
  }

  try {
    // Create private repo
    const res = await fetch(`https://api.github.com/orgs/${org}/repos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ name: `project-${projectId}`, private: true, auto_init: false }),
    });

    if (!res.ok) {
      console.error("[riya] repo creation failed:", res.status, await res.text());
      return null;
    }

    const repo = (await res.json()) as { html_url: string; clone_url: string };

    // Push generated code
    if (existsSync(join(buildDir, ".git"))) {
      execSync(`git remote add origin ${repo.clone_url}`, { cwd: buildDir });
    } else {
      execSync("git init && git add -A && git commit -m 'Initial generated app'", { cwd: buildDir, shell: "/bin/sh" });
      execSync(`git remote add origin ${repo.clone_url}`, { cwd: buildDir });
    }
    execSync(
      `git push -u origin main`,
      { cwd: buildDir, env: { ...process.env, GIT_ASKPASS: "echo", GIT_TOKEN: token } },
    );

    // Persist to DB
    await db
      .update(projects)
      .set({ githubRepo: repo.html_url, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    console.log(`[riya] archived to ${repo.html_url}`);
    return repo.html_url;
  } catch (err) {
    console.error("[riya] archival error:", err);
    return null;
  }
}
