// Neha — Knowledge agent: monitors GitHub releases, npm versions, CVE feeds
// Nice-to-have #12: push over poll for CVEs (NVD webhooks + GHSA GraphQL subscriptions)
// Default polling kept as fallback in case webhooks aren't registered.

import { agentChat } from "@nexsidi/llm-client";

export interface KnowledgeUpdate {
  type:    "cve" | "package_update" | "framework_update";
  source:  "nvd" | "ghsa" | "npm" | "github_releases";
  id:      string;
  summary: string;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  affectedPackages?: string[];
  receivedAt: string;
}

// Called by webhook endpoint (Nice-to-have #12: push path)
export async function handleCvePush(payload: unknown, source: "nvd" | "ghsa"): Promise<void> {
  console.log(`[neha] CVE push from ${source}`);
  const update = await parseCvePayload(payload, source);
  if (update) {
    await persistUpdate(update);
    if (update.severity === "CRITICAL") {
      await alertTilotma(update);
    }
  }
}

// Fallback: 6-hour poll for sources without push support
export async function pollAll(): Promise<void> {
  await Promise.all([
    pollNpm(),
    pollGitHubReleases(),
  ]);
}

async function parseCvePayload(
  payload: unknown,
  source: "nvd" | "ghsa",
): Promise<KnowledgeUpdate | null> {
  // TODO Phase 2: parse NVD / GHSA JSON into KnowledgeUpdate
  console.log(`[neha] parsing ${source} payload`);
  return null;
}

async function persistUpdate(update: KnowledgeUpdate): Promise<void> {
  // TODO Phase 2: upsert into knowledge DB (pgvector for semantic search by agents)
  console.log("[neha] persisted:", update.id);
}

async function alertTilotma(update: KnowledgeUpdate): Promise<void> {
  // TODO Phase 2: publish to Tilotma's agent-bus inbox
  console.warn("[neha] CRITICAL CVE — alerting Tilotma:", update.id, update.summary);
}

async function pollNpm(): Promise<void> {
  // TODO Phase 2: fetch latest versions of key packages and compare with pinned versions
}

async function pollGitHubReleases(): Promise<void> {
  // TODO Phase 2: check next.js, hono, drizzle, temporal release tags
}
