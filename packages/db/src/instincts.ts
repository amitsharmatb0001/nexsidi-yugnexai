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
export type InstinctDomain = "code-style" | "security" | "performance" | "testing" | "architecture" | "design" | "content";

// 2026-07-24 (P3.W3.3), extended 2026-07-25 (P5.W5.2): originally just the
// domains inferInstinctDomain (stage5-qa-fix-loop.ts) actually PRODUCES from
// live QA findings — "code-style" and "testing" were excluded because
// nothing classified a finding into either. P5.W5.2 (seed-instincts.ts)
// seeds 5 confirmed recurring generation bugs directly, not via QA — two of
// them are genuinely "code-style" (a hallucinated package, a missing
// Tailwind color-extension block). "code-style" is now a real write source,
// so it must be reachable here, or those two seeds are write-only —
// repeating the exact bug this array was created to fix. "testing" stays
// excluded: nothing writes to it yet, seeded or QA-inferred.
//
// 2026-08-08: real gap found live (project bae438767bed, direct user
// request) — the ENTIRE qualitative review path (Tilotma's Tier 3
// reality-checker, System B's live-eval) had zero connection to instinct
// memory: not the wrong domain, no domain existed at all for "this design
// is generic" or "this content lacks real substance," and nothing on that
// path ever called recordInstinct regardless. "design" is added here
// alongside the real writer in live-eval.ts (see runLiveEval) — same rule
// as above: a domain only belongs in this array once something real
// writes to it. "content" is added to the InstinctDomain TYPE (below) to
// mark real intent, but deliberately excluded here — nothing writes to it
// yet, and adding it to this array now would be the exact write-only/dead
// domain this comment's own history already warns against repeating.
export const REACHABLE_INSTINCT_DOMAINS: InstinctDomain[] = ["security", "performance", "architecture", "code-style", "design"];

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

// 2026-07-24 (P3.W3.3, full agentic upgrade): every instinct was previously
// inserted as a fresh row at a flat "0.5" confidence, forever — a mistake
// QA catches for the 5th time in a row gets logged with the exact same
// weight as one seen for the first time. D31 ("confidence tiers change
// enforcement") only means anything if confidence actually MOVES when a
// pattern repeats. This is the escalation ladder recordInstinct (below)
// climbs when it finds an existing instinct for the same domain+trigger —
// caps at "0.9" (the highest tier), never invented above it.
const CONFIDENCE_TIERS: Confidence[] = ["0.3", "0.5", "0.7", "0.9"];

export function escalateConfidence(current: Confidence): Confidence {
  const idx = CONFIDENCE_TIERS.indexOf(current);
  const nextIdx = Math.min(idx + 1, CONFIDENCE_TIERS.length - 1);
  return CONFIDENCE_TIERS[nextIdx]!;
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
  const { eq, and, desc } = await import("drizzle-orm");

  // 2026-07-24 (P3.W3.3): escalate confidence on a repeated pattern instead
  // of inserting a flat duplicate every time. "Same pattern" = same domain
  // + same trigger text, still an open "mistake" (not superseded). Only the
  // most recent matching row is escalated — older rows for the same pattern
  // are left as the historical record, not rewritten.
  const existing = await db
    .select({ id: instinctsTable.id, confidence: instinctsTable.confidence })
    .from(instinctsTable)
    .where(and(eq(instinctsTable.domain, domain), eq(instinctsTable.trigger, trigger), eq(instinctsTable.outcome, "mistake")))
    .orderBy(desc(instinctsTable.createdAt))
    .limit(1);

  if (existing[0]) {
    await db
      .update(instinctsTable)
      .set({ confidence: escalateConfidence(existing[0].confidence as Confidence), action: finding })
      .where(eq(instinctsTable.id, existing[0].id));
    return;
  }

  await db.insert(instinctsTable).values(buildInstinctRecord({ agentName, domain, trigger, finding }));
}

// projectId filtering intentionally omitted here — Shubham/Aanya's
// generated-app mistakes are useful across ALL projects of the same kind
// (a SQL-injection pattern in one task manager applies to the next one
// too), so this reads project-scoped AND global instincts for the domain,
// most-recent first. Per-project promotion/scoping refinement is future
// work, not blocking the basic "does the agent see its own past mistakes"
// loop this closes.
//
// 2026-07-24 (P3.W3.3): accepts one domain OR several. Real bug found
// during this session's audit: both call sites (Shubham/Aanya) hardcoded
// queryRecentInstincts("security") — but inferInstinctDomain
// (stage5-qa-fix-loop.ts) classifies findings into "security",
// "performance", or "architecture" depending on which QA agent found them.
// Querying only "security" meant every Deepika (performance) and Navya
// (logic->architecture) instinct was written correctly but NEVER read back
// by either generator — 2 of the 3 reachable domains were write-only.
export async function queryRecentInstincts(domain: InstinctDomain | InstinctDomain[], limit = 5): Promise<PromptInstinct[]> {
  const { db } = await import("./client.ts");
  const { instincts: instinctsTable } = await import("./schema.ts");
  const { eq, inArray, desc, and } = await import("drizzle-orm");
  const domainFilter = Array.isArray(domain) ? inArray(instinctsTable.domain, domain) : eq(instinctsTable.domain, domain);
  const rows = await db
    .select({ trigger: instinctsTable.trigger, action: instinctsTable.action, confidence: instinctsTable.confidence })
    .from(instinctsTable)
    .where(and(domainFilter, eq(instinctsTable.outcome, "mistake")))
    .orderBy(desc(instinctsTable.createdAt))
    .limit(limit);
  return rows;
}
