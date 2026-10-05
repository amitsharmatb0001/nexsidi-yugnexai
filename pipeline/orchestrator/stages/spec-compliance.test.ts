import { test, expect, afterAll, mock } from "bun:test";
import {
  extractSpecColors,
  extractRequiredFormFields,
  checkColorCompliance,
  checkFormFieldCompliance,
  checkSpecCompliance,
  checkStackConformance,
  checkFrontendApiProxy,
  checkAuthNavigation,
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
// 2026-10-03: the theme is now read with one evaluate call that returns only
// string --nx-* values, so there is no __rect to strip; non-string values are
// still dropped before checking.
test("runSpecComplianceCheck reads the live theme through the browser and ignores non-string values", async () => {
  mock.module("../../../packages/agent-runtime/src/browser/client.ts", () => ({
    BrowserSession: class {
      async send(action: string, args?: { expression?: string }) {
        if (action === "navigate") return {};
        if (action === "evaluate" && args?.expression?.includes("--nx")) {
          return {
            value: {
              "--nx-color-background": "#0A0E1A",
              "--nx-color-primary": "#3B82F6",
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
// 2026-08-31: real live bug found (project 05b590e98102) — these fixtures
// used "@yugnex/nexui-react" (the package name before the aanya-nexui-
// migration, 2026-08-16, moved the real npm dependency to "@yugnex/core").
// Every real generated project has had @yugnex/core, never nexui-react,
// for two weeks — these tests passed the whole time while the actual check
// unconditionally failed stack-conformance on every real build. Updated to
// match what a real package.json actually contains now.
test("checkStackConformance passes for a clean Next.js + @yugnex/core package.json", () => {
  const result = checkStackConformance({
    dependencies: { next: "16.2.0", "@yugnex/core": "0.1.0", react: "19.0.0" },
  });
  expect(result).toEqual({ pass: true, violations: [] });
});

test("checkStackConformance flags Tailwind if it somehow got installed", () => {
  const result = checkStackConformance({
    dependencies: { next: "16.2.0", "@yugnex/core": "0.1.0", tailwindcss: "3.4.0" },
  });
  expect(result.pass).toBe(false);
  expect(result.violations[0]).toContain("tailwindcss");
});

test("checkStackConformance flags shadcn/ui and @radix-ui packages", () => {
  const result = checkStackConformance({
    dependencies: { next: "16.2.0", "@yugnex/core": "0.1.0" },
    devDependencies: { "@radix-ui/react-dialog": "1.0.0", "shadcn-ui": "0.1.0" },
  });
  expect(result.pass).toBe(false);
  expect(result.violations).toHaveLength(2);
});

// 2026-08-31: real live gap this closes — a package.json with BOTH the
// required "@yugnex/core" AND the old, migrated-away-from
// "@yugnex/nexui-react" (confirmed live: zero actual imports of it
// anywhere in source, a pure leftover) passed this check clean before this
// pattern existed, since the "required" list only ever asserted the new
// name's presence, never the old name's absence.
test("checkStackConformance flags the old @yugnex/nexui-react even when @yugnex/core is also present", () => {
  const result = checkStackConformance({
    dependencies: { next: "16.2.0", "@yugnex/core": "0.1.0", "@yugnex/nexui-react": "2.0.1" },
  });
  expect(result.pass).toBe(false);
  expect(result.violations.some((v) => v.includes("@yugnex/nexui-react"))).toBe(true);
});

test("checkStackConformance flags a missing required dependency (e.g. next itself)", () => {
  const result = checkStackConformance({ dependencies: { react: "19.0.0", "@yugnex/core": "0.1.0" } });
  expect(result.pass).toBe(false);
  expect(result.violations.some((v) => v.includes("next"))).toBe(true);
});

test("checkStackConformance flags NexUI missing even when Next.js is present (the exact scenario asked about live: plan said Tailwind/wrong stack)", () => {
  const result = checkStackConformance({ dependencies: { next: "16.2.0", react: "19.0.0" } });
  expect(result.pass).toBe(false);
  expect(result.violations.some((v) => v.includes("@yugnex/core"))).toBe(true);
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

// 2026-09-29: real bug (project a034f90ba50e). Aanya added a next.config.ts
// rewrite proxying /api/:path* to `${process.env.NEXT_PUBLIC_API_URL}` —
// http://localhost:3308. The rewrite runs INSIDE the frontend container,
// where localhost is the frontend container itself, so every /api request
// through it returned 500 and sign-up/sign-in failed in the UI while the
// backend (called directly) worked.
test("checkFrontendApiProxy flags a /api rewrite to NEXT_PUBLIC_API_URL", () => {
  const nextConfig = `const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const nextConfig = { async rewrites() { return [{ source: "/api/:path*", destination: \`\${backendUrl}/api/:path*\` }]; } };
export default nextConfig;`;
  const result = checkFrontendApiProxy(nextConfig);
  expect(result.pass).toBe(false);
  expect(result.violations[0]).toContain("next.config");
  expect(result.violations[0]).toContain("inside the frontend container");
});

test("checkFrontendApiProxy flags a rewrite to a literal localhost URL", () => {
  const nextConfig = `export default { async rewrites() { return [{ source: "/api/:path*", destination: "http://localhost:3308/api/:path*" }]; } };`;
  expect(checkFrontendApiProxy(nextConfig).pass).toBe(false);
});

test("checkFrontendApiProxy passes a config with no rewrites, and a rewrite to the backend service name", () => {
  expect(checkFrontendApiProxy(`export default { reactStrictMode: true };`).pass).toBe(true);
  const internal = `export default { async rewrites() { return [{ source: "/api/:path*", destination: "http://backend:3001/api/:path*" }]; } };`;
  expect(checkFrontendApiProxy(internal).pass).toBe(true);
});

// 2026-09-29: real bug (project a034f90ba50e), reproduced in the browser. The
// sign-in form set the token cookie and called router.push("/dashboard"). The
// header's Dashboard link had been prefetched while signed out, the middleware
// answered that prefetch with a redirect to /sign-in, and the router reused
// the cached redirect: login succeeded (200, cookie set) but the user stayed on
// /sign-in. A change of auth state needs a full navigation.
test("checkAuthNavigation flags a file that sets the token cookie and navigates with the router", () => {
  const src = `document.cookie = \`token=\${res.data.token}; path=/\`;\n      router.push("/dashboard");`;
  const result = checkAuthNavigation([{ path: "components/auth-form.tsx", source: src }]);
  expect(result.pass).toBe(false);
  expect(result.violations[0]).toContain("components/auth-form.tsx");
  expect(result.violations[0]).toContain("window.location.assign");
});

test("checkAuthNavigation flags sign-out that clears the cookie and uses router.replace", () => {
  const src = `document.cookie = "token=; path=/; max-age=0";\nrouter.replace("/sign-in");`;
  expect(checkAuthNavigation([{ path: "components/header.tsx", source: src }]).pass).toBe(false);
});

test("checkAuthNavigation passes full navigation, and router use in files that don't touch the token", () => {
  const login = `document.cookie = \`token=\${t}; path=/\`;\nwindow.location.assign("/dashboard");`;
  const list = `router.push(\`/plants/\${id}\`);`;
  expect(checkAuthNavigation([{ path: "a.tsx", source: login }, { path: "b.tsx", source: list }]).pass).toBe(true);
});

// 2026-10-03 (Ledgerly benchmark run 4): the live page set
// --nx-color-primary: #059669 and --nx-color-foreground: #0F172A exactly as
// the spec asked, but the check only read seven older variable names
// (--nx-accent, --nx-bg-base, ...) that this NexUI version no longer uses,
// found nothing ("found: none") and sent the frontend builder to "fix" a
// correct theme. It now reads every --nx-* variable the page defines.
test("the live theme read collects every --nx-* variable, whatever its name", async () => {
  const { ROOT_THEME_VARS_EXPRESSION } = await import("./spec-compliance.ts");
  const props: Record<string, string> = {
    "--nx-color-primary": " #059669",
    "--nx-color-foreground": "#0F172A",
    "--nx-space-1": "0.25rem",
    "color": "rgb(0, 0, 0)",
  };
  const names = Object.keys(props);
  const style = Object.assign([...names], { getPropertyValue: (p: string) => props[p] ?? "" });
  const fn = new Function("document", "getComputedStyle", `return (${ROOT_THEME_VARS_EXPRESSION});`);
  const vars = fn({ documentElement: {}, body: {} }, () => style) as Record<string, string>;
  expect(vars["--nx-color-primary"]).toBe("#059669");
  expect(vars["--nx-color-foreground"]).toBe("#0F172A");
  expect(vars.color).toBeUndefined();
  expect(checkColorCompliance(["#059669", "#0F172A"], vars).pass).toBe(true);
});

// 2026-10-03 (evidence-only plan, T3): reading no theme colours at all is not
// evidence the colours are missing — it means the check could not look. That
// is "not checked", never a failure sent to a builder, and never a pass.
test("a colour check that reads no theme values reports not checked, with no violation", () => {
  const r = checkColorCompliance(["#059669"], {});
  expect(r.violations).toEqual([]);
  expect(r.notChecked?.[0]).toContain("could not read");
});

// 2026-10-04 (evidence-only): an unreadable package.json used to skip the
// stack check as a pass ("fail-open"). It is "not checked", with the reason.
test("a stack check that cannot read package.json is not checked, not a pass", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runStackConformanceCheck } = await import("./spec-compliance.ts");
  const dir = mkdtempSync(join(tmpdir(), "stack-"));
  try {
    const r = await runStackConformanceCheck(join(dir, "frontend-that-does-not-exist"));
    expect(r.notChecked?.[0]).toContain("package.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 2026-10-05 (Ledgerly run 4, round 7): the backend template always declares express-rate-limit, the
// doctrine says "express-rate-limit on auth-sensitive routes", and sign-in / sign-up still shipped with no
// limiter at all — only the reality checker found it, in 1 of 4 passes. A dependency that is installed
// and never imported is a fact a file search can state, so it is checked, not left to a reviewer's luck.
test("checkBackendRateLimit flags a backend that installs express-rate-limit but never uses it", async () => {
  const { checkBackendRateLimit } = await import("./spec-compliance.ts");
  const bad = checkBackendRateLimit([
    { path: "src/routes/authRoutes.ts", source: 'import { Router } from "express";\nrouter.post("/sign-in", signIn);' },
    { path: "src/index.ts", source: 'import express from "express";' },
  ]);
  expect(bad.pass).toBe(false);
  expect(bad.violations[0]).toContain("backend/src/routes/authRoutes.ts");
  expect(bad.violations[0]).toContain("express-rate-limit");
});

test("checkBackendRateLimit passes when the sign-in route file applies a limiter", async () => {
  const { checkBackendRateLimit } = await import("./spec-compliance.ts");
  const ok = checkBackendRateLimit([
    { path: "src/routes/authRoutes.ts", source: 'import rateLimit from "express-rate-limit";\nconst authLimiter = rateLimit({ windowMs: 60000, max: 10 });\nrouter.post("/sign-in", authLimiter, signIn);' },
  ]);
  expect(ok).toEqual({ pass: true, violations: [] });
});

test("checkBackendRateLimit does not accept a limiter that is created but never put on a route", async () => {
  const { checkBackendRateLimit } = await import("./spec-compliance.ts");
  const bad = checkBackendRateLimit([
    { path: "src/middleware/limits.ts", source: 'import rateLimit from "express-rate-limit";\nexport const authLimiter = rateLimit({ max: 5 });' },
    { path: "src/routes/authRoutes.ts", source: 'router.post("/sign-in", signIn);' },
  ]);
  expect(bad.pass).toBe(false);
});

test("checkBackendRateLimit passes when the limiter is applied app-wide in the entry file", async () => {
  const { checkBackendRateLimit } = await import("./spec-compliance.ts");
  const ok = checkBackendRateLimit([
    { path: "src/index.ts", source: 'import rateLimit from "express-rate-limit";\napp.use("/api/v1/auth", rateLimit({ max: 20 }));' },
    { path: "src/routes/authRoutes.ts", source: 'router.post("/sign-in", signIn);' },
  ]);
  expect(ok.pass).toBe(true);
});

// A violation that names its own file ("backend/src/...: ...") must reach the agent that owns that
// file — with one default file every stack violation went to the frontend builder.
test("toFindings routes a violation to the file it names, and uses the default file otherwise", async () => {
  const { toFindings } = await import("./spec-compliance.ts");
  const f = toFindings(
    { pass: false, violations: ["backend/src/routes/authRoutes.ts: express-rate-limit is installed but unused", "the page has no title"] },
    "frontend/package.json",
  );
  expect(f[0]!.file).toBe("backend/src/routes/authRoutes.ts");
  expect(f[1]!.file).toBe("frontend/package.json");
});
