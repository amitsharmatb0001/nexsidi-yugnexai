import { describe, expect, test } from "bun:test";
import { REACHABLE_INSTINCT_DOMAINS, formatInstinctsForPrompt } from "./instincts.ts";
import { SPRINT1_SEEDED_INSTINCTS, buildSeedRecords } from "./seed-instincts.ts";

describe("buildSeedRecords", () => {
  // 2026-07-25 (Phase 3.1, full MVP upgrade): raised 5 -> 6 — added the
  // native-Postgres-port-collision seed (nextech4, confirmed live) when the
  // Tailwind/shadcn seed was rewritten to teach the actual NexUI-only rule
  // instead of the forbidden stack it previously taught (see seed-instincts.ts
  // header comment for the full "this was never wired AND was factually
  // wrong" story).
  test("produces exactly the 6 confirmed recurring bugs", () => {
    expect(buildSeedRecords()).toHaveLength(6);
    expect(SPRINT1_SEEDED_INSTINCTS).toHaveLength(6);
  });

  test("every seed is global scope with no projectId — these are framework/package bugs, not project-specific", () => {
    for (const record of buildSeedRecords()) {
      expect(record.scope).toBe("global");
      expect(record.projectId).toBeNull();
      expect(record.outcome).toBe("mistake");
    }
  });

  test("every seed starts at 0.7 confidence — confirmed pattern, not a first guess, not yet re-escalated by the ladder", () => {
    for (const record of buildSeedRecords()) {
      expect(record.confidence).toBe("0.7");
    }
  });

  test("every seed's domain is in REACHABLE_INSTINCT_DOMAINS — a seed outside this set is write-only, invisible to Shubham/Aanya's queryRecentInstincts(REACHABLE_INSTINCT_DOMAINS) call", () => {
    for (const record of buildSeedRecords()) {
      expect(REACHABLE_INSTINCT_DOMAINS).toContain(record.domain);
    }
  });

  test("every seed trigger is unique — duplicate triggers within the same domain would collide in seedInstincts' idempotency check", () => {
    const keys = buildSeedRecords().map((r) => `${r.domain}::${r.trigger}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("renders through formatInstinctsForPrompt without a stale Clerk reference — CLAUDE.md's current generated-app auth is custom JWT, not Clerk", () => {
    const rendered = formatInstinctsForPrompt(
      buildSeedRecords().map((r) => ({ trigger: r.trigger, action: r.action, confidence: r.confidence })),
    );
    expect(rendered).toContain("KNOWN PAST MISTAKES");
    expect(rendered.toLowerCase()).not.toContain("clerk");
    expect(rendered).toContain("proxy.ts");
  });
});
