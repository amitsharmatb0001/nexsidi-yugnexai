import { test, expect } from "bun:test";
import { deriveProjectShape, compareShapes, rankBySimilarity } from "./project-shape.ts";
import type { ProjectSpec } from "../../agents/saanvi/src/index.ts";

// Real spec shape, read directly from project 05b590e98102's locked
// spec.json — 4 features, 3 db tables, admin-only auth (sign-in only, no
// sign-up), a contact form endpoint, an admin endpoint. Trimmed to the
// fields deriveProjectShape actually reads.
const CLARIO_AI_SPEC: ProjectSpec = {
  projectId: "05b590e98102",
  name: "Clario AI",
  description: "AI SaaS platform for customer support automation.",
  appType: "web",
  features: [
    { name: "Marketing Site & Product Showcase", description: "", userStories: [] },
    { name: "Contact Inquiry System", description: "", userStories: [] },
    { name: "Private Admin Authentication", description: "", userStories: [] },
    { name: "Admin Dashboard", description: "", userStories: [] },
  ],
  auth: { provider: "custom", features: ["sign-in"] },
  apiEndpoints: [
    { method: "POST", path: "/api/v1/contact", description: "Submit a new contact inquiry from the public site.", auth: false, requestBody: {}, responseBody: {} },
    { method: "POST", path: "/api/v1/auth/sign-in", description: "Authenticate an administrator.", auth: false, requestBody: {}, responseBody: {} },
    { method: "GET", path: "/api/v1/admin/inquiries", description: "Retrieve all submitted contact inquiries.", auth: true, requestBody: null, responseBody: {} },
    { method: "GET", path: "/api/v1/content", description: "Fetch dynamic site content.", auth: false, requestBody: null, responseBody: {} },
    { method: "PUT", path: "/api/v1/admin/content", description: "Update dynamic site content blocks.", auth: true, requestBody: {}, responseBody: {} },
  ],
  dbTables: [
    { name: "users", fields: [] },
    { name: "contact_inquiries", fields: [] },
    { name: "site_content", fields: [] },
  ],
  successCriteria: [],
  lockedAt: "2026-08-30T11:55:13.653Z",
  specHash: "e063a2567dcef3b8653eb5ae8f32814bfd87c7d7978acde20fe0956cfe738149",
};

test("deriveProjectShape reads the real Clario AI spec correctly", () => {
  const shape = deriveProjectShape(CLARIO_AI_SPEC, 5); // home/about/products/pricing/contact
  expect(shape).toEqual({
    pageCount: 5,
    featureCount: 4,
    dbTableCount: 3,
    authType: "admin-only",
    hasContactForm: true,
    hasAdminPanel: true,
  });
});

test("deriveProjectShape recognizes public-signup auth (sign-in AND sign-up present)", () => {
  const spec: ProjectSpec = { ...CLARIO_AI_SPEC, auth: { provider: "custom", features: ["sign-in", "sign-up"] } };
  expect(deriveProjectShape(spec, 5).authType).toBe("public-signup");
});

test("deriveProjectShape recognizes no-accounts apps (auth: null)", () => {
  const spec: ProjectSpec = { ...CLARIO_AI_SPEC, auth: null };
  expect(deriveProjectShape(spec, 5).authType).toBe("none");
});

test("deriveProjectShape finds a contact form from the description even if the path itself doesn't say 'contact'", () => {
  const spec: ProjectSpec = {
    ...CLARIO_AI_SPEC,
    apiEndpoints: [{ method: "POST", path: "/api/v1/inquiries", description: "Submit a contact request", auth: false, requestBody: {}, responseBody: {} }],
  };
  expect(deriveProjectShape(spec, 3).hasContactForm).toBe(true);
});

// ── compareShapes ────────────────────────────────────────────────────────
test("compareShapes gives a perfect (or near-perfect) score for an identical shape", () => {
  const shape = deriveProjectShape(CLARIO_AI_SPEC, 5);
  const result = compareShapes(shape, shape);
  expect(result.score).toBeCloseTo(1, 5);
  expect(result.different).toHaveLength(0);
});

// Real scenario named live: "clone Clario AI, change a few bits, add/remove
// a couple pages" — same auth type and admin panel, contact form dropped,
// two more pages, one more table. Should land solidly in a "close, worth
// cloning from" range without requiring an exact match on anything.
test("compareShapes scores a plausible clone-with-changes candidate as similar but not identical", () => {
  const original = deriveProjectShape(CLARIO_AI_SPEC, 5);
  const variant = { ...original, pageCount: 7, hasContactForm: false, dbTableCount: 4 };
  const result = compareShapes(original, variant);
  expect(result.score).toBeGreaterThan(0.5);
  expect(result.score).toBeLessThan(1);
  expect(result.shared.some((s) => s.includes("auth type"))).toBe(true);
  expect(result.different.some((s) => s.includes("contact form"))).toBe(true);
});

test("compareShapes scores a genuinely different kind of app low", () => {
  const clarioLike = deriveProjectShape(CLARIO_AI_SPEC, 5);
  // A public-signup, no-admin, no-contact-form, 2-page app — a different
  // shape of product entirely, not a "clone with tweaks" candidate.
  const different = {
    pageCount: 2,
    featureCount: 2,
    dbTableCount: 1,
    authType: "public-signup" as const,
    hasContactForm: false,
    hasAdminPanel: false,
  };
  const result = compareShapes(clarioLike, different);
  expect(result.score).toBeLessThan(0.4);
});

// ── rankBySimilarity ─────────────────────────────────────────────────────
test("rankBySimilarity sorts candidates best-match-first and returns every candidate (no hidden threshold)", () => {
  const target = deriveProjectShape(CLARIO_AI_SPEC, 5);
  const closeMatch = { ...target, pageCount: 6 }; // one page different
  const farMatch = { pageCount: 2, featureCount: 1, dbTableCount: 1, authType: "public-signup" as const, hasContactForm: false, hasAdminPanel: false };

  const ranked = rankBySimilarity(target, [
    { projectId: "far", shape: farMatch },
    { projectId: "close", shape: closeMatch },
    { projectId: "exact", shape: target },
  ]);

  expect(ranked).toHaveLength(3);
  expect(ranked[0]!.projectId).toBe("exact");
  expect(ranked[1]!.projectId).toBe("close");
  expect(ranked[2]!.projectId).toBe("far");
  expect(ranked[0]!.comparison.score).toBeGreaterThan(ranked[1]!.comparison.score);
  expect(ranked[1]!.comparison.score).toBeGreaterThan(ranked[2]!.comparison.score);
});
