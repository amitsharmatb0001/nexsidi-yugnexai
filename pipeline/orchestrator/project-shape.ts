// Project shape classification + similarity matching.
//
// 2026-09-01: real user request — as the delivered-project portfolio grows
// past a handful, manually remembering "which existing project is close
// enough to clone from" doesn't scale. This derives a comparable fingerprint
// from each project's own LOCKED spec.json (the single source of truth
// Saanvi/Arjun already produce — nothing here is guessed or re-inferred from
// free text) plus the real page count on disk (see countAppPages's own
// header comment: page names/counts are NOT a reliable structured field in
// spec.json itself, only the real file tree is ground truth), so a new
// project request can be scored against the existing portfolio and surface
// "clone from X — here's what's shared, here's what's different" instead of
// a human having to remember and pick manually.
import type { ProjectSpec } from "../../agents/saanvi/src/index.ts";

export interface ProjectShape {
  pageCount: number;
  featureCount: number;
  dbTableCount: number;
  authType: "none" | "admin-only" | "public-signup";
  hasContactForm: boolean;
  hasAdminPanel: boolean;
}

// Mirrors deriveAuthConfig's own signal (agents/saanvi/src/index.ts) — auth
// === null is a real, representable "no accounts" state (see that field's
// own header comment for the live bug this closed), not an edge case to
// special-case around.
function authTypeOf(auth: ProjectSpec["auth"]): ProjectShape["authType"] {
  if (!auth) return "none";
  return auth.features.includes("sign-up") ? "public-signup" : "admin-only";
}

// "contact" as a path/description keyword, not a hardcoded exact path — spec
// generation names endpoints in plain English (confirmed live: Clario AI's
// real endpoint is "/api/v1/contact", not some fixed convention), so a
// substring match against both the path and the human description is more
// robust than assuming a specific route shape.
function hasEndpointMatching(spec: ProjectSpec, pattern: RegExp): boolean {
  return spec.apiEndpoints.some((e) => pattern.test(e.path) || pattern.test(e.description));
}

export function deriveProjectShape(spec: ProjectSpec, pageCount: number): ProjectShape {
  return {
    pageCount,
    featureCount: spec.features.length,
    dbTableCount: spec.dbTables.length,
    authType: authTypeOf(spec.auth),
    hasContactForm: hasEndpointMatching(spec, /contact/i),
    hasAdminPanel: hasEndpointMatching(spec, /\/admin(\/|$)/i),
  };
}

export interface ShapeComparison {
  // 0-1. Deliberately a blend of hard feature-flag matches (auth type,
  // contact form, admin panel — the things that actually change what gets
  // built) and closeness-not-equality on the two count signals (page/table
  // counts vary run-to-run even for "the same kind of app" — Saanvi doesn't
  // produce byte-identical specs from similar prompts, and it shouldn't have
  // to for this to still count as a good clone candidate).
  score: number;
  shared: string[];
  different: string[];
}

// Linear falloff to 0 by the given spread — e.g. closeness(4, 7, 6) means
// "4 vs 7, treat anything 6+ apart as no similarity at all, straight-line
// between" rather than a binary equal/not-equal on counts that will almost
// never match exactly between two independently-generated specs.
function closeness(a: number, b: number, spread: number): number {
  return Math.max(0, 1 - Math.abs(a - b) / spread);
}

export function compareShapes(a: ProjectShape, b: ProjectShape): ShapeComparison {
  const shared: string[] = [];
  const different: string[] = [];

  const authMatch = a.authType === b.authType;
  (authMatch ? shared : different).push(
    authMatch ? `same auth type (${a.authType})` : `auth type differs (${a.authType} vs ${b.authType})`,
  );

  const contactMatch = a.hasContactForm === b.hasContactForm;
  (contactMatch ? shared : different).push(
    a.hasContactForm && b.hasContactForm
      ? "both have a contact form"
      : !a.hasContactForm && !b.hasContactForm
        ? "neither has a contact form"
        : `contact form differs (${a.hasContactForm ? "has one" : "no"} vs ${b.hasContactForm ? "has one" : "no"})`,
  );

  const adminMatch = a.hasAdminPanel === b.hasAdminPanel;
  (adminMatch ? shared : different).push(
    a.hasAdminPanel && b.hasAdminPanel
      ? "both have an admin panel"
      : !a.hasAdminPanel && !b.hasAdminPanel
        ? "neither has an admin panel"
        : `admin panel differs (${a.hasAdminPanel ? "has one" : "no"} vs ${b.hasAdminPanel ? "has one" : "no"})`,
  );

  if (a.pageCount !== b.pageCount) different.push(`page count differs (${a.pageCount} vs ${b.pageCount})`);
  else shared.push(`same page count (${a.pageCount})`);

  if (a.dbTableCount !== b.dbTableCount) different.push(`table count differs (${a.dbTableCount} vs ${b.dbTableCount})`);
  else shared.push(`same table count (${a.dbTableCount})`);

  const score =
    0.25 * (authMatch ? 1 : 0) +
    0.15 * (contactMatch ? 1 : 0) +
    0.15 * (adminMatch ? 1 : 0) +
    0.25 * closeness(a.pageCount, b.pageCount, 6) +
    0.1 * closeness(a.dbTableCount, b.dbTableCount, 5) +
    0.1 * closeness(a.featureCount, b.featureCount, 5);

  return { score, shared, different };
}

export interface RankedMatch {
  projectId: string;
  comparison: ShapeComparison;
}

// Sorted best-first. Deliberately returns every candidate rather than
// filtering by a hardcoded threshold here — "70-80% similar" (the bar named
// live) is a caller/UI decision, not baked into the matching logic itself.
export function rankBySimilarity(
  target: ProjectShape,
  candidates: Array<{ projectId: string; shape: ProjectShape }>,
): RankedMatch[] {
  return candidates
    .map(({ projectId, shape }) => ({ projectId, comparison: compareShapes(target, shape) }))
    .sort((a, b) => b.comparison.score - a.comparison.score);
}
