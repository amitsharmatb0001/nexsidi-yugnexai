import { test, expect, afterAll, mock } from "bun:test";
import {
  extractSpecColors,
  extractRequiredFormFields,
  checkColorCompliance,
  checkFormFieldCompliance,
  checkSpecCompliance,
  checkStackConformance,
  runSpecComplianceCheck,
  toFindings,
} from "./spec-compliance.ts";
import type { ProjectSpec } from "../../../agents/saanvi/src/index.ts";

// Real spec.json this check was root-caused against (verify361300) — Saanvi
// correctly named exact colors in the description; the live site rendered
// completely different ones (#0D1117 / #E89010, NexUI's "void" preset)
// despite the generated source file having the right values.
const REAL_DESCRIPTION =
  "A high-end corporate website and client portal for NexTech... The platform features a premium " +
  "aesthetic using a dark navy (#0A0E1A) background with electric blue (#3B82F6) accents, utilizing " +
  "the Inter font and a sleek, card-based layout.";

test("extractSpecColors pulls every distinct hex color out of the description, case-normalized", () => {
  expect(extractSpecColors({ description: REAL_DESCRIPTION })).toEqual(["#0A0E1A", "#3B82F6"]);
});

test("extractSpecColors dedupes repeated colors and normalizes case", () => {
  expect(extractSpecColors({ description: "primary #ff0000, also #FF0000 again" })).toEqual(["#FF0000"]);
});

test("extractSpecColors returns an empty array when the description names no literal colors", () => {
  expect(extractSpecColors({ description: "A modern, professional site with a clean layout." })).toEqual([]);
});

test("extractRequiredFormFields reads field names from endpoints with a requestBody", () => {
  const spec = {
    apiEndpoints: [
      { method: "POST" as const, path: "/api/v1/contact", description: "", auth: false,
        requestBody: { name: "string", email: "string", message: "string" }, responseBody: {} },
      { method: "GET" as const, path: "/api/v1/health", description: "", auth: false,
        requestBody: null, responseBody: {} },
    ],
  };
  expect(extractRequiredFormFields(spec)).toEqual({
    "/api/v1/contact": ["name", "email", "message"],
  });
});

test("extractRequiredFormFields returns an empty object when no endpoint has a requestBody", () => {
  const spec = { apiEndpoints: [{ method: "GET" as const, path: "/api/v1/health", description: "", auth: false, requestBody: null, responseBody: {} }] };
  expect(extractRequiredFormFields(spec)).toEqual({});
});

// ── checkColorCompliance ─────────────────────────────────────────────────────
test("checkColorCompliance passes when every spec color appears live", () => {
  const result = checkColorCompliance(["#0A0E1A", "#3B82F6"], {
    "--nx-bg-base": "#0A0E1A",
    "--nx-accent": "#3B82F6",
  });
  expect(result).toEqual({ pass: true, violations: [] });
});

// The real verify361300 failure: spec colors never actually rendered.
test("checkColorCompliance fails and names every missing spec color when the live theme doesn't have them", () => {
  const result = checkColorCompliance(["#0A0E1A", "#3B82F6"], {
    "--nx-bg-surface": "#161B22",
    "--nx-accent": "#E89010",
  });
  expect(result.pass).toBe(false);
  expect(result.violations).toHaveLength(2);
  expect(result.violations[0]).toContain("#0A0E1A");
  expect(result.violations[1]).toContain("#3B82F6");
});

test("checkColorCompliance passes vacuously when the spec named no literal colors", () => {
  expect(checkColorCompliance([], { "--nx-accent": "#E89010" })).toEqual({ pass: true, violations: [] });
});

test("checkColorCompliance is case-insensitive when comparing live values against spec colors", () => {
  const result = checkColorCompliance(["#3B82F6"], { "--nx-accent": "#3b82f6" });
  expect(result.pass).toBe(true);
});

// 2026-08-06: real bug found live (project 88d7b375eaef) — the browser
// worker's getComputedStyle handler always adds a __rect: {x,y,width,height}
// object alongside the requested CSS custom properties, for callers that
// also need bounding-box info. runSpecComplianceCheck fed the raw
// styles object straight into checkColorCompliance, which does
// Object.values(...).map(v => v.trim()) assuming every value is a string —
// __rect's object value has no .trim, so this threw "TypeError: v.trim is
// not a function" on every single run, and stage6's fail-open catch
// silently skipped the check entirely instead of surfacing the real bug.
test("runSpecComplianceCheck strips the browser worker's __rect bounding-box field before color-checking, instead of crashing on it", async () => {
  mock.module("../../../packages/agent-runtime/src/browser/client.ts", () => ({
    BrowserSession: class {
      async send(action: string) {
        if (action === "navigate") return {};
        if (action === "getComputedStyle") {
          return {
            styles: {
              "--nx-bg-base": "#0A0E1A",
              "--nx-accent": "#3B82F6",
              __rect: { x: 0, y: 0, width: 100, height: 50 },
            },
          };
        }
        if (action === "evaluate") return { value: [] };
        return {};
      }
      async close() {}
    },
  }));
  try {
    const spec: ProjectSpec = {
      projectId: "p1",
      name: "Test",
      description: REAL_DESCRIPTION,
      appType: "web",
      features: [],
      auth: { provider: "custom", features: [] },
      apiEndpoints: [],
      dbTables: [],
      successCriteria: [],
      lockedAt: new Date().toISOString(),
      specHash: "deadbeef",
    };
    const result = await runSpecComplianceCheck(spec, "http://localhost:3201");
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  } finally {
    mock.restore();
  }
});

// ── checkFormFieldCompliance ──────────────────────────────────────────────────
test("checkFormFieldCompliance passes when every required field is present live", () => {
  const result = checkFormFieldCompliance(
    { "/api/v1/contact": ["name", "email", "message"] },
    { "/api/v1/contact": ["name", "email address", "message"] },
  );
  expect(result).toEqual({ pass: true, violations: [] });
});

test("checkFormFieldCompliance fails and names the missing field", () => {
  const result = checkFormFieldCompliance(
    { "/api/v1/contact": ["name", "email", "message", "phone"] },
    { "/api/v1/contact": ["name", "email", "message"] },
  );
  expect(result.pass).toBe(false);
  expect(result.violations[0]).toContain("phone");
  expect(result.violations[0]).toContain("/api/v1/contact");
});

test("checkFormFieldCompliance skips a path with no matching live form instead of flagging it", () => {
  const result = checkFormFieldCompliance(
    { "/api/v1/contact": ["name", "email", "message"] },
    {},
  );
  expect(result).toEqual({ pass: true, violations: [] });
});

// ── checkSpecCompliance (combined) ────────────────────────────────────────────
test("checkSpecCompliance combines color and form-field violations", () => {
  const spec = {
    description: REAL_DESCRIPTION,
    apiEndpoints: [
      { method: "POST" as const, path: "/api/v1/contact", description: "", auth: false,
        requestBody: { name: "string", email: "string", message: "string" }, responseBody: {} },
    ],
  };
  const live = {
    cssVars: { "--nx-bg-surface": "#161B22", "--nx-accent": "#E89010" },
    formFieldsByPath: { "/api/v1/contact": ["name", "message"] },
  };
  const result = checkSpecCompliance(spec, live);
  expect(result.pass).toBe(false);
  // 2 missing colors + 1 missing form field (email)
  expect(result.violations).toHaveLength(3);
});

// ── checkStackConformance (2026-08-05) ────────────────────────────────────────
test("checkStackConformance passes for a clean Next.js + nexui-react package.json", () => {
  const result = checkStackConformance({
    dependencies: { next: "16.2.0", "@yugnex/nexui-react": "1.0.0", react: "19.0.0" },
  });
  expect(result).toEqual({ pass: true, violations: [] });
});

test("checkStackConformance flags Tailwind if it somehow got installed", () => {
  const result = checkStackConformance({
    dependencies: { next: "16.2.0", "@yugnex/nexui-react": "1.0.0", tailwindcss: "3.4.0" },
  });
  expect(result.pass).toBe(false);
  expect(result.violations[0]).toContain("tailwindcss");
});

test("checkStackConformance flags shadcn/ui and @radix-ui packages", () => {
  const result = checkStackConformance({
    dependencies: { next: "16.2.0", "@yugnex/nexui-react": "1.0.0" },
    devDependencies: { "@radix-ui/react-dialog": "1.0.0", "shadcn-ui": "0.1.0" },
  });
  expect(result.pass).toBe(false);
  expect(result.violations).toHaveLength(2);
});

test("checkStackConformance flags a missing required dependency (e.g. next itself)", () => {
  const result = checkStackConformance({ dependencies: { react: "19.0.0", "@yugnex/nexui-react": "1.0.0" } });
  expect(result.pass).toBe(false);
  expect(result.violations.some((v) => v.includes("next"))).toBe(true);
});

test("checkStackConformance flags NexUI missing even when Next.js is present (the exact scenario asked about live: plan said Tailwind/wrong stack)", () => {
  const result = checkStackConformance({ dependencies: { next: "16.2.0", react: "19.0.0" } });
  expect(result.pass).toBe(false);
  expect(result.violations.some((v) => v.includes("@yugnex/nexui-react"))).toBe(true);
});

// ── toFindings ─────────────────────────────────────────────────────────────
test("toFindings converts violations into Finding-shaped objects routable by agentForFile", () => {
  const result = { pass: false, violations: ["depends on tailwindcss", "missing next"] };
  const findings = toFindings(result, "frontend/package.json");
  expect(findings).toEqual([
    { file: "frontend/package.json", issue: "[spec-compliance] depends on tailwindcss" },
    { file: "frontend/package.json", issue: "[spec-compliance] missing next" },
  ]);
});

test("toFindings returns an empty array for a passing result", () => {
  expect(toFindings({ pass: true, violations: [] }, "frontend/package.json")).toEqual([]);
});

test("checkSpecCompliance passes when the live app matches the spec's literal colors and form fields", () => {
  const spec = {
    description: REAL_DESCRIPTION,
    apiEndpoints: [
      { method: "POST" as const, path: "/api/v1/contact", description: "", auth: false,
        requestBody: { name: "string", email: "string", message: "string" }, responseBody: {} },
    ],
  };
  const live = {
    cssVars: { "--nx-bg-base": "#0A0E1A", "--nx-accent": "#3B82F6" },
    formFieldsByPath: { "/api/v1/contact": ["name", "email", "message"] },
  };
  expect(checkSpecCompliance(spec, live)).toEqual({ pass: true, violations: [] });
});
