// 2026-07-08: Patent Claim 2 (confidence-scored mistake memory) had a real
// DB table (`instincts` in schema.ts, Phase 0) but ZERO code anywhere read
// or wrote to it — confirmed via a repo-wide grep before this file existed.
// Every pipeline run started with total amnesia, so the same bug classes
// (e.g. SQL injection in dynamic UPDATE queries) could resurface run after
// run with nothing actually learning between them. This is the real path:
// record a mistake when QA finds one, query it back before the next
// generation attempt so the model sees "you did this wrong before."
//
// DB-touching functions (recordInstinct/queryRecentInstincts) import `db`
// dynamically at call time, not at module top level — same pattern as
// agents/riya/src/index.ts's dynamic @nexsidi/db import — so importing this
// module never requires a live DATABASE_URL connection, keeping the pure
// formatting functions below unit-testable with zero infra.
import type { instincts } from "./schema.ts";

export type Confidence = "0.3" | "0.5" | "0.7" | "0.9";
export type InstinctDomain = "code-style" | "security" | "performance" | "testing" | "architecture";

export interface InstinctInput {
  agentName: string;
  domain: InstinctDomain;
  trigger: string;
  finding: string; // the QA finding text this instinct is derived from
}

export type NewInstinct = typeof instincts.$inferInsert;

// D29: project-scoped by default; promotion to global happens separately
// (2+ project types, avg confidence >= 0.8 — see nexsidi-mistake-memory
// skill's PROMOTION_CRITERIA, not implemented here — this is the write
// path, not the promotion job).
export function buildInstinctRecord(input: InstinctInput): Omit<NewInstinct, "id" | "createdAt"> {
  return {
    trigger: input.trigger,
    action: input.finding,
    confidence: "0.5", // moderate — a single observation, not yet a repeated pattern
    domain: input.domain,
    scope: "project",
    projectId: null,
    outcome: "mistake",
  };
}

export interface PromptInstinct {
  trigger: string;
  action: string;
  confidence: string;
}

// Empty on purpose returns "" (no header) rather than an empty section —
// an agent's very first run (or a run with no relevant history) should get
// a system prompt identical to before this feature existed, not a
// dangling "KNOWN PAST MISTAKES:" header with nothing under it.
export function formatInstinctsForPrompt(instinctList: PromptInstinct[]): string {
  if (instinctList.length === 0) return "";
  const lines = instinctList.map((i) => `- ${i.trigger}: ${i.action} (confidence: ${i.confidence})`);
  return `KNOWN PAST MISTAKES — avoid repeating these:\n${lines.join("\n")}`;
}

// ── DB-touching functions — dynamic `db` import, needs live Postgres ───────

export async function recordInstinct(agentName: string, domain: InstinctDomain, trigger: string, finding: string): Promise<void> {
  const { db } = await import("./client.ts");
  const { instincts: instinctsTable } = await import("./schema.ts");
  await db.insert(instinctsTable).values(buildInstinctRecord({ agentName, domain, trigger, finding }));
}

// projectId filtering intentionally omitted here — Shubham/Aanya's
// generated-app mistakes are useful across ALL projects of the same kind
// (a SQL-injection pattern in one task manager applies to the next one
// too), so this reads project-scoped AND global instincts for the domain,
// most-recent first. Per-project promotion/scoping refinement is future
// work, not blocking the basic "does the agent see its own past mistakes"
// loop this closes.
export async function queryRecentInstincts(domain: InstinctDomain, limit = 5): Promise<PromptInstinct[]> {
  const { db } = await import("./client.ts");
  const { instincts: instinctsTable } = await import("./schema.ts");
  const { eq, desc, and } = await import("drizzle-orm");
  const rows = await db
    .select({ trigger: instinctsTable.trigger, action: instinctsTable.action, confidence: instinctsTable.confidence })
    .from(instinctsTable)
    .where(and(eq(instinctsTable.domain, domain), eq(instinctsTable.outcome, "mistake")))
    .orderBy(desc(instinctsTable.createdAt))
    .limit(limit);
  return rows;
}
