// Riya — DevOps: docker-compose.yml generation + local deploy + GitHub archival
// Fix #9: project archival (GitHub repo create + push) is now explicitly in scope.

import { agentChat } from "@nexsidi/llm-client";
import { db, projects } from "@nexsidi/db";
import { eq } from "drizzle-orm";

export async function run(projectId: string): Promise<void> {
  // Step 1: generate docker-compose.yml for the user's app
  const { content: compose } = await agentChat(
    "riya",
    [
      { role: "system", content: RIYA_SYSTEM_PROMPT },
      { role: "user", content: `Generate docker-compose.yml for project ${projectId}` },
    ],
    process.env.NIM_API_KEY ?? "",
  );

  // TODO Phase 1: write docker-compose.yml to generated project directory

  // Step 2: docker-compose up and verify
  // TODO Phase 1: spawn docker-compose up, wait for health check

  // Step 3: Fix #9 — create GitHub repo and push generated code
  await archiveToGitHub(projectId);
}

async function archiveToGitHub(projectId: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const org   = process.env.GITHUB_ORG ?? "nexsidi-projects";
  if (!token) {
    console.warn("[riya] GITHUB_TOKEN not set — skipping archival");
    return;
  }

  // Create repo
  const res = await fetch(`https://api.github.com/orgs/${org}/repos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      name:    `project-${projectId}`,
      private: true,
      auto_init: true,
    }),
  });

  if (!res.ok) {
    console.error("[riya] GitHub repo creation failed", res.status, await res.text());
    return;
  }

  const repo = (await res.json()) as { html_url: string };

  // Persist repo URL to DB
  await db
    .update(projects)
    .set({ githubRepo: repo.html_url, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  console.log(`[riya] archived to ${repo.html_url}`);
  // TODO Phase 1: git remote add origin + git push
}

const RIYA_SYSTEM_PROMPT = `You are a DevOps engineer. Generate a docker-compose.yml file.
Services: frontend (Next.js, port 3000), backend (Express, port 3001), postgres (port 5432).
Output ONLY the YAML content. No prose.`;
