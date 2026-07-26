// P5.W5.2 (full agentic upgrade plan): pre-load CONFIRMED recurring bugs as
// high-confidence GLOBAL instincts, so a fresh build starts with these
// already in Shubham/Aanya's "KNOWN PAST MISTAKES" prompt section
// (formatInstinctsForPrompt) instead of re-discovering the SAME bug through
// a full QA round-trip every single run — the exact "same basic mistakes
// every run" gap the plan calls out.
//
// 2026-07-25 (Phase 3.1, full MVP upgrade): this file's seedInstincts() was
// written but never called from anywhere except its own `import.meta.main`
// CLI block (audit-2026-07-25.md, A.2) — the `instincts` table had 0 rows
// after 9+ real pipeline runs. Wiring the call is Phase 3.1's other half
// (see worker.ts). This edit fixes the SECOND bug found alongside that: the
// two Sprint-1 seeds below taught the FORBIDDEN stack. CLAUDE.md (2026-07-25
// correction) and skills/aanya.md both say NexUI-only — "NEVER Tailwind,
// NEVER shadcn/ui, NEVER @radix-ui" — but these seeds said "always include
// tailwind.config.ts... whenever shadcn/ui is used." Had seeding ever fired
// with the OLD content, every generator run would have been taught to use
// the exact stack it's forbidden from using. Confirmed live in nextech8's
// actual output (C:/tmp/nexsidi-builds/nextech8/frontend/tailwind.config.ts)
// that the generator drifts toward Tailwind despite the doctrine already
// saying not to — which is exactly the failure mode instinct memory exists
// to prevent, so this is corrected to teach the actual rule, not silently
// dropped.
//
// Global scope (not project): these are framework/package/config-shape
// defects, not specific to any one generated app — same reasoning
// queryRecentInstincts's own comment gives for why its read path applies
// no project filter.
//
// Seeded at "0.7" confidence: not "0.3" (a first single observation) and
// not "0.9" (the escalation ladder's cap, meant to be earned through real
// repeat detections) — these are CONFIRMED, already-understood patterns,
// but haven't yet been re-confirmed by the instinct system's own
// escalateConfidence ladder.
import type { InstinctDomain, NewInstinct } from "./instincts.ts";

export interface SeedInstinct {
  domain: InstinctDomain;
  trigger: string;
  action: string;
}

export const SPRINT1_SEEDED_INSTINCTS: SeedInstinct[] = [
  {
    domain: "code-style",
    trigger: "tailwind.config.ts, shadcn/ui, or @radix-ui/* appears anywhere in a generated frontend",
    action:
      "The generated stack is @yugnex/nexui-react ONLY — NEVER Tailwind, NEVER shadcn/ui, NEVER @radix-ui, in either NexSidi's own platform or any generated app. This was previously observed live: a generator wrote tailwind.config.ts despite its own system prompt already saying not to (nextech8, 2026-07-25). Do not add a tailwind.config.ts, do not import from @radix-ui or shadcn/ui, do not use @apply — use NexUI components and nexui-utils.css classnames/CSS variables instead.",
  },
  {
    domain: "code-style",
    trigger: "a package name in package.json cannot be confirmed to actually exist on npm",
    action:
      "Hallucinated package names (a plausible-sounding but nonexistent npm package) fail npm install inside Docker and cost a full generation cycle to discover. Before adding any dependency you are not certain exists, prefer a package you have concrete evidence for, or verify it first.",
  },
  {
    domain: "architecture",
    trigger: "middleware.ts used for Next.js 16.2 auth or routing logic",
    action:
      "Next.js 16.2 uses proxy.ts, not middleware.ts — middleware.ts is deprecated and triggers a build warning. Any auth or routing middleware must live in proxy.ts.",
  },
  {
    domain: "architecture",
    trigger: "generated routes/index.ts left as an empty static fallback router",
    action:
      "The LLM generates per-resource route files (e.g. tasks.routes.ts) but a static routes/index.ts fallback can leave them unmounted, causing 404s on every API call. Always auto-wire routes/index.ts to import and mount every file under src/routes/ after generation — never leave it as an empty static stub.",
  },
  {
    domain: "security",
    trigger: "CORS_ORIGIN in backend docker-compose does not match the frontend's host port",
    action:
      "If the frontend's Docker host port changes (e.g. a port conflict forces 3100 -> 3200), CORS_ORIGIN in the backend service must be updated to match, or the browser gets CORS errors on every API call. Always keep CORS_ORIGIN in lockstep with the frontend's actual published port.",
  },
  {
    domain: "architecture",
    trigger: "generated docker-compose.yml maps the database container to host port 5432",
    action:
      "5432 collides with a native Postgres service that may already be listening on the host machine, silently serving requests with the wrong credentials instead of failing loudly. Map the database container to a non-default host port (e.g. 55432) in docker-compose.yml. Confirmed live: nextech4's self-verification failed with a real Postgres auth error caused by exactly this collision.",
  },
];

export function buildSeedRecords(): Array<Omit<NewInstinct, "id" | "createdAt" | "domain"> & { domain: InstinctDomain }> {
  return SPRINT1_SEEDED_INSTINCTS.map((seed) => ({
    trigger: seed.trigger,
    action: seed.action,
    confidence: "0.7",
    domain: seed.domain,
    scope: "global",
    projectId: null,
    outcome: "mistake",
  }));
}

// ── DB-touching — dynamic `db` import, same pattern as instincts.ts, needs
// live Postgres ──────────────────────────────────────────────────────────

// Idempotent: skips a seed whose (domain, trigger) pair already exists as
// an open "mistake" instinct — re-running this (e.g. after a fresh
// `migrate`) must never insert duplicates or reset a confidence the
// system's own escalation ladder has already moved past 0.7.
export async function seedInstincts(): Promise<{ inserted: number; skipped: number }> {
  const { db } = await import("./client.ts");
  const { instincts: instinctsTable } = await import("./schema.ts");
  const { eq, and } = await import("drizzle-orm");

  let inserted = 0;
  let skipped = 0;
  for (const record of buildSeedRecords()) {
    const existing = await db
      .select({ id: instinctsTable.id })
      .from(instinctsTable)
      .where(
        and(
          eq(instinctsTable.domain, record.domain),
          eq(instinctsTable.trigger, record.trigger),
          eq(instinctsTable.outcome, "mistake"),
        ),
      )
      .limit(1);
    if (existing[0]) {
      skipped++;
      continue;
    }
    await db.insert(instinctsTable).values(record);
    inserted++;
  }
  return { inserted, skipped };
}

if (import.meta.main) {
  const result = await seedInstincts();
  console.log(`[seed-instincts] inserted ${result.inserted}, skipped ${result.skipped} (already present)`);
}
