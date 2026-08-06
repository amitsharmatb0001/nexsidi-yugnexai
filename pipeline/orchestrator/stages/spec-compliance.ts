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
  return {
    pass: colorResult.pass && formResult.pass,
    violations: [...colorResult.violations, ...formResult.violations],
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
];

const REQUIRED_FRONTEND_DEPS = ["next", "@yugnex/nexui-react"];

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
        `Generated frontend depends on "${dep}" — the mandated stack is Next.js + @yugnex/nexui-react only (no Tailwind, shadcn/ui, or @radix-ui).`,
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

export async function runStackConformanceCheck(frontendOutputDir: string): Promise<SpecComplianceResult> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  try {
    const packageJson = JSON.parse(readFileSync(join(frontendOutputDir, "package.json"), "utf-8")) as PackageJsonLike;
    return checkStackConformance(packageJson);
  } catch (err) {
    console.error(`[spec-compliance] Could not read frontend package.json for stack conformance — skipping (fail-open): ${String(err)}`);
    return { pass: true, violations: [] };
  }
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
export async function runSpecComplianceCheck(
  spec: ProjectSpec,
  appUrl: string,
): Promise<SpecComplianceResult> {
  const { BrowserSession } = await import("../../../packages/agent-runtime/src/browser/client.ts");
  const session = new BrowserSession();
  try {
    await session.send("navigate", { url: appUrl });
    const cssResult = (await session.send("getComputedStyle", {
      selector: ":root",
      props: [
        "--nx-accent",
        "--nx-accent-text",
        "--nx-bg-base",
        "--nx-bg-surface",
        "--nx-bg-elevated",
        "--nx-text",
        "--nx-border",
      ],
    })) as { styles: (Record<string, string> & { __rect?: unknown }) | null };
    // 2026-08-06: real bug found live (project 88d7b375eaef) — the browser
    // worker's getComputedStyle handler (worker.mjs) always adds a __rect:
    // {x,y,width,height} object alongside the requested string props, for
    // callers that need bounding-box info too. checkColorCompliance assumes
    // every value in cssVars is a string (Object.values(...).map(v =>
    // v.trim())) — __rect's object value has no .trim, so this crashed with
    // "TypeError: v.trim is not a function" on EVERY run, and stage6's
    // fail-open catch silently skipped the whole spec-compliance check
    // instead of surfacing a real code bug as a real code bug.
    const { __rect: _rect, ...cssVars } = cssResult.styles ?? {};

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
