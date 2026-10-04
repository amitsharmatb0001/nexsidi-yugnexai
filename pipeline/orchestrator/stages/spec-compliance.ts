// Spec-compliance check — a cheap, mechanical pass that catches concrete,
// literal spec violations that neither System A (Navya/Karan/Deepika's bug
// hunting) nor System B (Tilotma's holistic design/originality/craft/
// functionality judge) are built to catch.
//
// Root-caused live (verify361300): spec.json's `description` explicitly named
// exact hex colors ("dark navy (#0A0E1A) background with electric blue
// (#3B82F6) accents"), and the generated theme-overrides.css correctly set
// them — but NexUI's runtime theme engine (setNexuiTheme, invoked by
// NexuiProvider's `theme="void"` prop) silently overwrote them at runtime
// with its own built-in preset (#0D1117 background, #E89010 orange accent).
// Confirmed live via getComputedStyle on the deployed site's :root — the
// SOURCE file had the right values; only what actually rendered was wrong.
// Neither System A (no logic bug — the app functions correctly) nor System B
// (a generic "does this look well-designed" judge with no mechanism to know
// the literal spec asked for navy+blue specifically, and no reason to
// penalize a competently-executed dark-orange theme on its own terms) caught
// it. This is why the check must read colors from the LIVE rendered page,
// not from generated source files — a source-level check would have passed
// this exact build.
//
// This check runs regardless of System B's pass/fail (stage6-deployment.ts
// wires it in independently) and blocks delivery on concrete, literal misses
// against spec.json — it is not an aesthetic judgment call.
import type { ProjectSpec } from "../../../agents/saanvi/src/index.ts";

export interface LiveSnapshot {
  cssVars: Record<string, string>;
  formFieldsByPath: Record<string, string[]>;
}

export interface SpecComplianceResult {
  pass: boolean;
  violations: string[];
  // 2026-10-03 (evidence-only plan, T3): what this check could not look at,
  // and why. Not a pass and not a violation — the delivery is not verified
  // until it is checked.
  notChecked?: string[];
}

// Pure — deterministic, no live calls. Saanvi's spec-generation prompt folds
// concrete color decisions into the free-text description (see BuildPlan's
// appDescription header comment: copied verbatim from ProjectSpec.description,
// never LLM-regenerated) — extracting literal hex codes from it is a reliable
// way to recover "the spec explicitly committed to these colors" without
// needing a dedicated structured field. Case-normalized so a live #3b82f6
// matches a spec #3B82F6.
export function extractSpecColors(spec: Pick<ProjectSpec, "description">): string[] {
  const matches = (spec.description ?? "").match(/#[0-9A-Fa-f]{6}/g) ?? [];
  return [...new Set(matches.map((c) => c.toUpperCase()))];
}

// Pure. Only endpoints with a non-null requestBody carry a checkable field
// list — GET endpoints, and endpoints Saanvi didn't specify a body shape for,
// contribute no requirement (absence there is not a violation of anything).
export function extractRequiredFormFields(
  spec: Pick<ProjectSpec, "apiEndpoints">,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const ep of spec.apiEndpoints ?? []) {
    if (ep.requestBody) out[ep.path] = Object.keys(ep.requestBody);
  }
  return out;
}

export function checkColorCompliance(
  specColors: string[],
  liveCssVars: Record<string, string>,
): SpecComplianceResult {
  if (specColors.length === 0) return { pass: true, violations: [] };
  const liveValues = new Set(
    Object.values(liveCssVars)
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean),
  );
  // Reading nothing is not evidence the colours are missing (Ledgerly run 4:
  // "found: none" on a site that showed them) — the check could not look.
  if (liveValues.size === 0) {
    return { pass: true, violations: [], notChecked: [`spec colours ${specColors.join(", ")}: could not read any theme colours from the live page`] };
  }
  const missing = specColors.filter((c) => !liveValues.has(c));
  if (missing.length === 0) return { pass: true, violations: [] };
  const found = [...liveValues].join(", ") || "none";
  return {
    pass: false,
    violations: missing.map(
      (c) =>
        `Spec explicitly specifies color ${c} but it does not appear anywhere in the live site's rendered theme (found: ${found})`,
    ),
  };
}

// Substring match (not exact), so a live field labeled "Email Address" still
// satisfies a spec field named "email" — this check is for MISSING fields,
// not for enforcing exact label text (System B's job, if anyone's).
export function checkFormFieldCompliance(
  requiredFieldsByPath: Record<string, string[]>,
  liveFormFieldsByPath: Record<string, string[]>,
): SpecComplianceResult {
  const violations: string[] = [];
  for (const [path, required] of Object.entries(requiredFieldsByPath)) {
    const live = liveFormFieldsByPath[path];
    // No live form found at this path — not this check's job to flag; System
    // A / Tier 3 already cover "does the form exist at all".
    if (!live) continue;
    const liveLower = live.map((f) => f.toLowerCase());
    const missing = required.filter((f) => !liveLower.some((lf) => lf.includes(f.toLowerCase())));
    if (missing.length > 0) {
      violations.push(
        `Spec's ${path} endpoint requires field(s) [${missing.join(", ")}] but the live form only has [${live.join(", ") || "none"}]`,
      );
    }
  }
  return { pass: violations.length === 0, violations };
}

export function checkSpecCompliance(
  spec: Pick<ProjectSpec, "description" | "apiEndpoints">,
  live: LiveSnapshot,
): SpecComplianceResult {
  const colorResult = checkColorCompliance(extractSpecColors(spec), live.cssVars);
  const formResult = checkFormFieldCompliance(extractRequiredFormFields(spec), live.formFieldsByPath);
  const notChecked = [...(colorResult.notChecked ?? []), ...(formResult.notChecked ?? [])];
  return {
    pass: colorResult.pass && formResult.pass,
    violations: [...colorResult.violations, ...formResult.violations],
    ...(notChecked.length > 0 ? { notChecked } : {}),
  };
}

// ── Stack conformance (2026-08-05) ──────────────────────────────────────────
// A DIFFERENT class of violation from the checks above: not "does the output
// match THIS project's spec.json", but "does it match the FIXED, global
// tech-stack rule every generated app must follow" (CLAUDE.md: "Frontend:
// Next.js 16.2 + TypeScript + @yugnex/nexui-react — NOT Tailwind, NOT
// shadcn/ui, NOT @radix-ui"). Aanya's own prompt already states this
// ("NEVER use Tailwind, shadcn/ui, @radix-ui" — agents/generators/aanya/src/
// index.ts's system prompt), but that's a generation-time INSTRUCTION with
// zero QA-time VERIFICATION anywhere — if the model ignores it, nothing
// catches that today. Checking package.json dependencies is far more
// reliable than grepping generated JSX/CSS for Tailwind-looking class names
// (real false-positive risk — "flex", "gap-4" are also plausible hand-
// written utility names); a banned package can only land in package.json if
// something actually installed/imported it.
const BANNED_FRONTEND_DEP_PATTERNS: RegExp[] = [
  /^tailwindcss$/i,
  /^@tailwindcss\//i,
  /^@radix-ui\//i,
  /shadcn/i,
  /^postcss$/i, // Tailwind's build step — no legitimate reason to need it with NexUI's plain CSS custom properties
  /^autoprefixer$/i, // same reasoning as postcss
  // 2026-08-31: real live gap found (project 05b590e98102, Clario AI) —
  // REQUIRED_FRONTEND_DEPS below was fixed to require "@yugnex/core" (the
  // real dependency since the aanya-nexui-migration, 2026-08-16), but the
  // OLD package name was never added here as banned — so a package.json
  // with BOTH present (the exact live shape found: @yugnex/core AND
  // @yugnex/nexui-react, the latter completely unused, zero imports
  // anywhere in source) passed this check clean. Required-present and
  // old-name-absent are two different assertions; fixing only the first
  // left this gap open.
  /^@yugnex\/nexui-react$/i,
];

// 2026-08-31: real live bug found (project 05b590e98102, Clario AI) — this
// check has required "@yugnex/nexui-react" since 2026-08-05, but the
// aanya-nexui-migration (2026-08-16, see agents/generators/aanya/src/
// index.ts's vendorNexui header comment) replaced the whole-package-vendored
// @yugnex/nexui-react model with a shadcn/ui-style one: @yugnex/core is the
// real npm dependency now, and individual component .tsx files are copied
// in per-project by @yugnex/cli, not installed as a package. Every project
// generated since that migration has @yugnex/core in package.json and NO
// @yugnex/nexui-react entry at all — this check has been unconditionally
// failing stack-conformance on every single build for two weeks, burning a
// full Stage 6 fix-loop round each time on a dependency that was correctly
// never installed.
const REQUIRED_FRONTEND_DEPS = ["next", "@yugnex/core"];

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function checkStackConformance(packageJson: PackageJsonLike): SpecComplianceResult {
  const allDeps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  const violations: string[] = [];

  for (const dep of Object.keys(allDeps)) {
    if (BANNED_FRONTEND_DEP_PATTERNS.some((p) => p.test(dep))) {
      violations.push(
        `Generated frontend depends on "${dep}" — the mandated stack is Next.js + @yugnex/core only (no Tailwind, shadcn/ui, or @radix-ui).`,
      );
    }
  }
  for (const required of REQUIRED_FRONTEND_DEPS) {
    if (!(required in allDeps)) {
      violations.push(`Generated frontend is missing required dependency "${required}" — the mandated stack requires it.`);
    }
  }

  return { pass: violations.length === 0, violations };
}

// 2026-09-29: real bug (project a034f90ba50e). A next.config rewrite proxying
// /api to `${process.env.NEXT_PUBLIC_API_URL}` (http://localhost:3308) runs
// INSIDE the frontend container, where localhost is the frontend container
// itself — every /api request through it returned 500, so sign-up/sign-in
// failed in the UI while the backend, called directly, worked. NEXT_PUBLIC_API_URL
// is the BROWSER's address for the backend; a server-side proxy needs the
// compose service name (http://backend:<container port>).
export function checkFrontendApiProxy(nextConfigSource: string): SpecComplianceResult {
  if (!/rewrites\s*\(/.test(nextConfigSource)) return { pass: true, violations: [] };
  const hostOnly = (expr: string) => /localhost|127\.0\.0\.1|NEXT_PUBLIC_API_URL/.test(expr);
  const hostOnlyVars = new Set(
    [...nextConfigSource.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*([^;\n]+)/g)]
      .filter((m) => hostOnly(m[2] ?? ""))
      .map((m) => m[1] ?? ""),
  );
  const destinations = [...nextConfigSource.matchAll(/destination\s*:\s*([`"'])(.*?)\1/g)].map((m) => m[2] ?? "");
  const bad = destinations.filter(
    (d) => hostOnly(d) || [...d.matchAll(/\$\{\s*(\w+)\s*\}/g)].some((m) => hostOnlyVars.has(m[1] ?? "")),
  );
  if (bad.length === 0) return { pass: true, violations: [] };
  return {
    pass: false,
    violations: [
      `frontend/next.config: rewrites() proxies to ${bad.join(", ")} — the rewrite runs inside the frontend container, where localhost is the frontend container itself, so every request through it fails with 500. Remove the rewrites() proxy and call the backend directly at process.env.NEXT_PUBLIC_API_URL from the browser.`,
    ],
  };
}

// 2026-09-29: real bug (project a034f90ba50e), reproduced in the browser. The
// sign-in form set the token cookie then router.push("/dashboard"); the
// header's Dashboard link had been prefetched while signed out, the
// middleware answered that prefetch with a redirect to /sign-in, and the
// router reused the cached redirect — login succeeded (200, cookie set) but
// the user stayed on /sign-in. A change of auth state needs a full navigation.
export function checkAuthNavigation(files: Array<{ path: string; source: string }>): SpecComplianceResult {
  const violations = files
    .filter(({ source }) => /document\.cookie\s*=\s*[`'"]token=/.test(source) && /router\.(push|replace)\(/.test(source))
    .map(({ path }) =>
      `frontend/${path}: sets the token cookie and then navigates with router.push/replace — the router reuses a page prefetched while signed out (the middleware's redirect to /sign-in), so after signing in the user stays on the sign-in page. After the token cookie changes (sign-in or sign-out), navigate with window.location.assign(...) instead.`,
    );
  return { pass: violations.length === 0, violations };
}

function readFrontendSources(frontendOutputDir: string, readdirSync: typeof import("node:fs").readdirSync, readFileSync: typeof import("node:fs").readFileSync, join: typeof import("node:path").join): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(frontendOutputDir, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!["node_modules", ".next", ".git", "nexui"].includes(entry.name)) walk(childRel);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        out.push({ path: childRel, source: readFileSync(join(frontendOutputDir, childRel), "utf-8") });
      }
    }
  };
  for (const dir of ["app", "components", "lib", "hooks"]) {
    try { walk(dir); } catch { /* directory absent */ }
  }
  return out;
}

export async function runStackConformanceCheck(frontendOutputDir: string): Promise<SpecComplianceResult> {
  const { readFileSync, existsSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const results: SpecComplianceResult[] = [];
  try {
    const packageJson = JSON.parse(readFileSync(join(frontendOutputDir, "package.json"), "utf-8")) as PackageJsonLike;
    results.push(checkStackConformance(packageJson));
  } catch (err) {
    results.push({ pass: true, violations: [], notChecked: [`stack check: could not read the frontend package.json: ${String(err).slice(0, 200)}`] });
  }
  const nextConfig = ["next.config.ts", "next.config.mjs", "next.config.js"].map((f) => join(frontendOutputDir, f)).find((p) => existsSync(p));
  if (nextConfig) results.push(checkFrontendApiProxy(readFileSync(nextConfig, "utf-8")));
  results.push(checkAuthNavigation(readFrontendSources(frontendOutputDir, readdirSync, readFileSync, join)));
  const notChecked = results.flatMap((r) => r.notChecked ?? []);
  return { pass: results.every((r) => r.pass), violations: results.flatMap((r) => r.violations), ...(notChecked.length > 0 ? { notChecked } : {}) };
}

// Converts violations into Finding-shaped objects ({file, issue} — see
// stage4-multi-agent-dev.ts's Finding) so they route through the SAME
// agentForFile-based fix loop every other QA finding uses (see
// stage6-deployment.ts's wiring). `file` is a best-effort attribution:
// unlike a Navya/Karan finding, these checks don't point at one exact wrong
// line — `file` names the file an agent fixing the issue would most
// plausibly need to touch, so the finding routes to the RIGHT agent
// (agentForFile keys off the "frontend/"/"backend/" prefix), not a
// byte-exact citation.
export function toFindings(result: SpecComplianceResult, defaultFile: string): Array<{ file: string; issue: string }> {
  return result.violations.map((issue) => ({ file: defaultFile, issue: `[spec-compliance] ${issue}` }));
}

// Real entry point — drives the live deployed app via the same Node browser
// worker Tier-3 uses (packages/agent-runtime/src/browser/client.ts, which
// exists specifically because Playwright doesn't work under Bun), collects a
// LiveSnapshot, and runs the pure check above against it. Not unit-tested
// directly (same convention as this codebase's other live-browser/live-LLM
// entry points — see stage5-adversarial-qa.ts's runStage5 vs
// runStage5WithAgents split); checkSpecCompliance and its pure helpers above
// carry the real test coverage.
// 2026-10-03 (Ledgerly benchmark run 4): this used to ask for seven fixed
// names (--nx-accent, --nx-bg-base, ...). The current NexUI theme sets
// --nx-color-primary, --nx-color-foreground and so on, so the check saw
// nothing ("found: none") on a site that rendered the spec's colours exactly,
// and sent the frontend builder to "fix" a correct theme. It now reads every
// --nx-* variable on the root and body, whatever the theme calls them.
export const ROOT_THEME_VARS_EXPRESSION =
  "(() => { const out = {}; for (const el of [document.documentElement, document.body]) { const cs = getComputedStyle(el); " +
  "for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (p.startsWith('--nx')) { const v = cs.getPropertyValue(p).trim(); if (v) out[p] = v; } } } return out; })()";

export async function runSpecComplianceCheck(
  spec: ProjectSpec,
  appUrl: string,
): Promise<SpecComplianceResult> {
  const { BrowserSession } = await import("../../../packages/agent-runtime/src/browser/client.ts");
  const session = new BrowserSession();
  try {
    await session.send("navigate", { url: appUrl });
    const themeResult = (await session.send("evaluate", { expression: ROOT_THEME_VARS_EXPRESSION })) as { value: unknown };
    const cssVars: Record<string, string> = {};
    if (themeResult.value && typeof themeResult.value === "object") {
      for (const [k, v] of Object.entries(themeResult.value as Record<string, unknown>)) if (typeof v === "string") cssVars[k] = v;
    }

    const formFieldsByPath: Record<string, string[]> = {};
    const contactEndpoint = spec.apiEndpoints.find((e) => /contact/i.test(e.path));
    if (contactEndpoint) {
      await session.send("navigate", { url: `${appUrl.replace(/\/$/, "")}/contact` });
      const fieldsResult = (await session.send("evaluate", {
        expression:
          "Array.from(document.querySelectorAll('nex-input, nex-textarea, input, textarea')).map(el => (el.getAttribute('label') || el.placeholder || el.name || '').toLowerCase()).filter(Boolean)",
      })) as { value: unknown };
      formFieldsByPath[contactEndpoint.path] = Array.isArray(fieldsResult.value) ? (fieldsResult.value as string[]) : [];
    }

    return checkSpecCompliance(spec, { cssVars, formFieldsByPath });
  } finally {
    await session.close();
  }
}
