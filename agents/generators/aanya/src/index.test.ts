import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentPrompt, buildAgentTask, buildCustomEnvLocal, buildScaffoldTsconfig, buildScaffoldNextConfig, buildFixTask, vendorNexui, NEXUI_CONFIRMED_COMPONENTS, countPlannedPages, writeStaticScaffold } from "./index.ts";
import type { VendorExecFn } from "./index.ts";
import type { BuildPlan } from "../../../arjun/src/index.ts";
import { FALLBACK_BRIEF } from "../../../vanya/src/index.ts";

const FIX_TEST_PLAN: BuildPlan = {
  projectId: "fixtest",
  appName: "Greenway Estates Portal",
  appDescription: "A property management platform for landlords, tenants, and staff.",
  designBrief: FALLBACK_BRIEF,
  features: [],
  sharedTypes: "export interface Application { id: string; }",
  apiContract: { baseUrl: "http://localhost:3001", endpoints: [] },
  dbSchema: { tables: [] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
  buildPlanHash: "deadbeef",
};

// 2026-08-10: real bug found live (project rivhdw1, mid-generation, direct
// observation) — the scaffold wrote a real, correctly-written Next.js
// middleware function (checks the "token" cookie, redirects unauthenticated
// requests) to the WRONG filename: "proxy.ts". Next.js 16.2 only recognizes
// "middleware.ts" as its routing middleware convention — a file named
// proxy.ts is just an inert, unused file the framework never invokes,
// silently disabling server-side auth redirect for every generated app
// (client-side redirects were the only real gate). Worse: the prompt's own
// Rule 8 explicitly told Aanya "NEVER create a middleware.ts file... Next.js
// rejects having both proxy.ts and middleware.ts present" — a confident but
// FALSE claim (verified directly this session: Next.js simply never routes
// requests through proxy.ts at all, request logs confirmed only
// middleware.ts receives traffic). This bug had already been "fixed" once
// per-project via an expensive QA round-trip (Navya flags it, Aanya renames
// it) on an EARLIER project (freshtst1) — but the fix was never applied to
// the SOURCE (this scaffold + prompt), so every NEW project paid the same
// round-trip cost again. This test locks in the real fix at the source.
test("writeStaticScaffold writes the auth middleware to middleware.ts, not proxy.ts (the real Next.js 16.2 convention)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    expect(existsSync(join(dir, "middleware.ts"))).toBe(true);
    expect(existsSync(join(dir, "proxy.ts"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("system prompt correctly requires middleware.ts and forbids proxy.ts, not the reverse", () => {
  const prompt = buildAgentPrompt("integrate");
  expect(prompt).not.toMatch(/NEVER create a middleware\.ts file/i);
  expect(prompt).toMatch(/middleware\.ts/);
});

// 2026-08-10: real gap found live (user request) — the CLICK-THROUGH
// NAVIGATION VERIFICATION section (and its new VISUAL QUALITY CHECK step)
// explicitly says "skip only for a genuine single-page app." Making
// visual_check a mechanically REQUIRED evidence kind for every project,
// with no way to tell single-page from multi-page, would hard-block a
// legitimate single-page app forever (completion-gate.ts's
// requiredEvidenceKinds check has no override path). countPlannedPages
// counts distinct "page.tsx" files across aanyaTasks' outputFiles — the
// same real signal the App Router convention Aanya is already required to
// follow — so run()/runFix() can require visual_check only when it's
// actually possible to satisfy it honestly.
test("countPlannedPages counts distinct page.tsx files across aanyaTasks, not raw task count", () => {
  const plan: BuildPlan = {
    ...FIX_TEST_PLAN,
    aanyaTasks: [
      { description: "home", outputFiles: ["app/page.tsx"] },
      { description: "auth", outputFiles: ["app/(auth)/sign-in/page.tsx", "app/(auth)/sign-up/page.tsx"] },
      { description: "shared component", outputFiles: ["components/Header.tsx"] },
    ],
  };
  expect(countPlannedPages(plan)).toBe(3);
});

test("countPlannedPages returns 1 for a genuine single-page app", () => {
  const plan: BuildPlan = {
    ...FIX_TEST_PLAN,
    aanyaTasks: [
      { description: "home", outputFiles: ["app/page.tsx"] },
    ],
  };
  expect(countPlannedPages(plan)).toBe(1);
});

// 2026-08-16 (aanya-nexui-migration Task 2): the "STATIC FILES ALREADY
// WRITTEN" list directly describes what writeStaticScaffold produces — the
// exact failure class this migration's plan warns against repeating
// (proxy.ts/middleware.ts: a confidently-wrong claim shipped in the prompt
// with zero test ever checking it). Locks in that this list was actually
// updated alongside the scaffold rewrite above, not left describing the old
// vendored-package model.
test("system prompt's STATIC FILES list describes the real @yugnex/core scaffold, not the old vendored-package one", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("@yugnex/nexui-react + @yugnex/nexui as file: deps");
  expect(prompt).not.toContain("NexuiProvider wrapper");
  expect(prompt).toContain("@yugnex/core as a real npm dependency");
  expect(prompt).toContain("StyleRegistry + ThemeProvider + NoFoucScript");
});

test("preview mode prompt instructs mock data, no real API calls", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("mock");
  expect(prompt).not.toContain("Bearer token from useAuth().getToken()");
});

// 2026-08-09: real bug found live (project meridianbk4) — the LAYOUT
// PATTERNS section gave one literal, copy-pasteable page skeleton (nav ->
// maxWidth:1200 container -> auto-fill card grid) in every single
// generation prompt, regardless of Vanya's actual per-project
// layoutConcept (already passed via formatDesignBriefForPrompt in
// buildAgentTask — this was never a missing-data problem, it was a
// competing-instruction problem). Confirmed live across 4 separate
// meridianbk projects: colors and fonts genuinely varied per Vanya's
// brief, but the underlying DOM structure converged on this one example
// every time — a concrete, checkable contributor to "every generated app
// looks the same" despite the per-project design-brief work already
// being real and working for color/typography.
test("system prompt derives page structure from layoutConcept instead of offering a fixed skeleton example to copy", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("Layout concept");
  expect(prompt).not.toContain('gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))"');
});

test("integrate mode prompt instructs real API wiring", () => {
  const prompt = buildAgentPrompt("integrate");
  expect(prompt).toContain("read the 'token' cookie");
  expect(prompt).toContain('"Authorization: Bearer <token>"');
  expect(prompt).not.toContain("useAuth().getToken()");
});

// 2026-08-16 (aanya-nexui-migration Task 1): vendorNexui was rewritten from
// a whole-package cpSync copy of a local nexui-publish/ directory to
// per-component vendoring via @yugnex/cli against a registry (shadcn/ui-
// style). stripDevDependencies/stripVendoredPackageJsonDevDeps are gone —
// there is no vendored package.json anymore to strip devDependencies from;
// components are raw .tsx files copied straight into components/nexui/, and
// @yugnex/core (the one real npm dependency) ships its own clean manifest.
// The font-copying block is gone too — checked @yugnex/core's actual theme
// tokens (packages/core/src/theme/tokens.ts in the nex-ui repo): its default
// fontFamily is a system-font stack ('-apple-system, BlinkMacSystemFont,
// "Segoe UI", ...'), not a custom webfont, and grepping every registry
// component's real JSON (apps/docs/public/r/*.json) for @font-face/.woff/
// next/font found zero references. The font-404 bug class this used to
// guard against (NexuiSans-*.woff2 relative to vendor/nexui/css/) cannot
// recur because there is no custom font being shipped at all — confirmed,
// not assumed.
//
// vendorNexui shells out to @yugnex/cli's `init` then `add` (subprocess, not
// a library import — see vendorNexui's own header comment in index.ts for
// why: the published @yugnex/cli@0.1.1 package has no "exports" map, ships
// only a single bundled dist/index.js with zero `export` statements, and
// that bundle runs `program.parseAsync()` as a top-level side effect on
// import — there is nothing importable and importing it would try to parse
// THIS process's argv). Tests inject a fake execFn to assert the exact
// commands issued without spawning a real process, mirroring the execFn
// injection pattern already used by riya's isPortUsedByDocker.
// 2026-08-16 (review fix, Finding A): these three tests only asserted the
// exact commands issued — they never proved anything landed on disk, which
// is precisely the gap Finding A's review caught. Switched from a bogus
// "/fake/output/dir" (never real, so the new post-add file-existence check
// would always throw) to a real mkdtempSync dir, and fakeExec now stubs out
// each requested component's .tsx file on the "add" call — mirroring what
// the real CLI does on success — so these command-shape assertions keep
// passing under vendorNexui's new verification without weakening it.
function fakeExecThatWritesStubComponents(
  calls: Array<{ command: string; cwd: string }>,
): VendorExecFn {
  return (command, options) => {
    calls.push({ command, cwd: options.cwd });
    const match = command.match(/ add ((?:"[^"]+"\s*)+)--yes/);
    if (match?.[1]) {
      const names = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const componentsDir = join(options.cwd, "components", "nexui");
      mkdirSync(componentsDir, { recursive: true });
      for (const name of names) {
        writeFileSync(join(componentsDir, `${name}.tsx`), `export function ${name}() { return null; }\n`);
      }
    }
    return "";
  };
}

test("vendorNexui shells out to the CLI's init then add commands with the configured registry URL and outputDir as cwd", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "aanya-vendor-cmd-shape-"));
  const calls: Array<{ command: string; cwd: string }> = [];
  const fakeExec = fakeExecThatWritesStubComponents(calls);

  const previous = process.env.NEXUI_REGISTRY_URL;
  process.env.NEXUI_REGISTRY_URL = "https://fixture.example.test";
  try {
    vendorNexui(outputDir, ["button", "card"], fakeExec);
  } finally {
    if (previous === undefined) delete process.env.NEXUI_REGISTRY_URL;
    else process.env.NEXUI_REGISTRY_URL = previous;
    rmSync(outputDir, { recursive: true, force: true });
  }

  expect(calls.length).toBe(2);
  expect(calls[0]?.cwd).toBe(outputDir);
  expect(calls[0]?.command).toContain("init");
  expect(calls[0]?.command).toContain("https://fixture.example.test");
  expect(calls[1]?.cwd).toBe(outputDir);
  expect(calls[1]?.command).toContain("add");
  expect(calls[1]?.command).toContain("button");
  expect(calls[1]?.command).toContain("card");
});

test("vendorNexui defaults to the confirmed live registry URL when NEXUI_REGISTRY_URL is unset", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "aanya-vendor-default-registry-"));
  const calls: Array<{ command: string; cwd: string }> = [];
  const fakeExec = fakeExecThatWritesStubComponents(calls);

  const previous = process.env.NEXUI_REGISTRY_URL;
  delete process.env.NEXUI_REGISTRY_URL;
  try {
    vendorNexui(outputDir, ["button"], fakeExec);
  } finally {
    if (previous !== undefined) process.env.NEXUI_REGISTRY_URL = previous;
    rmSync(outputDir, { recursive: true, force: true });
  }

  expect(calls[0]?.command).toContain("https://new.yugnex.com");
});

test("vendorNexui defaults to the 13 confirmed-mapped components when none are specified", () => {
  // Component API audit (docs/nexsidi/plans/2026-08-16-aanya-nexui-migration.md):
  // aanyaTasks/BuildPlan only carry freeform task descriptions and output
  // file paths — no structured record of which UI components a task
  // actually uses — so per-project component selection can't be derived
  // reliably without guessing which the plan explicitly forbids. Default to
  // fetching every confirmed-mapped component every time instead.
  const outputDir = mkdtempSync(join(tmpdir(), "aanya-vendor-default-components-"));
  const calls: Array<{ command: string; cwd: string }> = [];
  const fakeExec = fakeExecThatWritesStubComponents(calls);
  try {
    vendorNexui(outputDir, undefined, fakeExec);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }

  // Note: the plan doc labels this list "13 direct matches" but actually
  // enumerates 14 names (button, card, input, badge, checkbox, modal, tabs,
  // select, tooltip, switch, progress, skeleton, avatar, separator) — an
  // off-by-one in the doc's own count, not in the names themselves. Verified
  // directly against the real registry index.json
  // (E:\nex-ui\apps\docs\public\r\index.json): all 14 names exist there.
  expect(NEXUI_CONFIRMED_COMPONENTS.length).toBe(14);
  for (const name of NEXUI_CONFIRMED_COMPONENTS) {
    expect(calls[1]?.command).toContain(name);
  }
});

// 2026-08-16 (review fix, Finding A — regression test): the real @yugnex/cli
// subprocess can exit 0 while silently having fetched ZERO bytes for one or
// more requested components — traced into the real CLI source: fetchRegistry-
// Component (packages/cli/src/utils/fetch-registry.ts) swallows any fetch
// failure (404, network error, malformed JSON) into a bare `try/catch { return
// null }`, and addOne (packages/cli/src/commands/add.ts) on receiving that
// `null` just `console.log`s a red warning and `return`s — no process.exit(1),
// no throw. The CLI process genuinely exits 0 in this scenario; a bare
// execSync (which only inspects the exit code) cannot see the gap. This test
// proves vendorNexui's own post-add file-existence check closes it: inject a
// fake execFn that behaves exactly like the real CLI does when one component
// silently fails — it returns normally (exit 0 semantics) but never writes
// that component's .tsx file to disk — and assert vendorNexui throws,
// identifying the missing component by name, instead of returning silently.
test("vendorNexui throws naming the missing component(s) when the CLI subprocess exits 0 but a component file never lands on disk", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "aanya-vendor-partial-fail-"));
  try {
    // Simulate the real CLI's actual on-disk behavior for a partial failure:
    // "button" fetches fine and its file is written; "card" silently fails
    // inside the CLI (404/network hiccup) and addOne just logs + returns,
    // writing nothing — but the subprocess as a whole still exits 0.
    const fakeExec = (command: string, options: { cwd: string }) => {
      if (command.includes(" add ")) {
        mkdirSync(join(options.cwd, "components", "nexui"), { recursive: true });
        writeFileSync(join(options.cwd, "components", "nexui", "button.tsx"), "export function Button() { return null; }\n");
        // "card" deliberately never written — mirrors addOne's silent-return path.
      }
      return ""; // real CLI exits 0 even though "card" was never fetched
    };

    expect(() => vendorNexui(outputDir, ["button", "card"], fakeExec)).toThrow(/card/);
    try {
      vendorNexui(outputDir, ["button", "card"], fakeExec);
    } catch (err) {
      expect(String(err)).not.toContain("button"); // only the ACTUALLY-missing one is named
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("vendorNexui does not throw when the CLI subprocess exits 0 and every requested component file actually landed on disk", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "aanya-vendor-success-"));
  try {
    const fakeExec = (command: string, options: { cwd: string }) => {
      if (command.includes(" add ")) {
        mkdirSync(join(options.cwd, "components", "nexui"), { recursive: true });
        writeFileSync(join(options.cwd, "components", "nexui", "button.tsx"), "export function Button() { return null; }\n");
        writeFileSync(join(options.cwd, "components", "nexui", "card.tsx"), "export function Card() { return null; }\n");
      }
      return "";
    };

    expect(() => vendorNexui(outputDir, ["button", "card"], fakeExec)).not.toThrow();
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

// Real end-to-end check against a local fixture registry (mirrors the real
// registry JSON shape seen live at E:\nex-ui\apps\docs\public\r\button.json)
// instead of hitting the live https://new.yugnex.com over the network —
// fetch-registry.ts's readSource treats a non-http registryUrl as a local
// directory, so pointing NEXUI_REGISTRY_URL at a temp dir exercises the
// REAL @yugnex/cli subprocess end-to-end (init writes components.json, add
// resolves registryDependencies and copies real file content) with zero
// live network calls to the actual product registry.
test("vendorNexui (real CLI subprocess) writes components.json and copies real component source into outputDir/components/nexui", () => {
  const registryDir = mkdtempSync(join(tmpdir(), "nexsidi-nexui-registry-fixture-"));
  const outputDir = mkdtempSync(join(tmpdir(), "nexsidi-aanya-vendor-output-"));
  try {
    writeFileSync(join(registryDir, "index.json"), JSON.stringify([
      { name: "button", title: "Button", description: "A button." },
      { name: "card", title: "Card", description: "A card." },
    ]));
    writeFileSync(join(registryDir, "button.json"), JSON.stringify({
      name: "button",
      dependencies: [],
      registryDependencies: [],
      files: [{ path: "button.tsx", content: "export function Button() { return null; }\n", type: "registry:component" }],
    }));
    writeFileSync(join(registryDir, "card.json"), JSON.stringify({
      name: "card",
      dependencies: [],
      registryDependencies: ["button"], // proves transitive resolution runs for real
      files: [{ path: "card.tsx", content: "export function Card() { return null; }\n", type: "registry:component" }],
    }));

    const previous = process.env.NEXUI_REGISTRY_URL;
    process.env.NEXUI_REGISTRY_URL = registryDir;
    try {
      vendorNexui(outputDir, ["card"]); // real (default) execFn — actually spawns the CLI
    } finally {
      if (previous === undefined) delete process.env.NEXUI_REGISTRY_URL;
      else process.env.NEXUI_REGISTRY_URL = previous;
    }

    expect(existsSync(join(outputDir, "components.json"))).toBe(true);
    expect(existsSync(join(outputDir, "components", "nexui", "card.tsx"))).toBe(true);
    // registryDependencies: ["button"] must have been pulled in transitively
    expect(existsSync(join(outputDir, "components", "nexui", "button.tsx"))).toBe(true);
  } finally {
    rmSync(registryDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
}, 30000);

// Found live during the Phase B stress-test gate (stress2phaseb, 2026-07-04):
// .env.local was reading process.env.CLERK_PUBLISHABLE_KEY, but the real
// worktree .env names it NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (confirmed by
// grepping .env/.env.example) — the mismatch meant every generated preview
// build shipped an EMPTY Clerk publishable key, which crashes Next.js's
// static prerendering of /_not-found with "Missing publishableKey". Neither
// the NIM agent nor the Claude escalation (80 combined iterations) could
// fix this — it's a scaffold/env-generation bug, not something editable
// from inside the generated project.
test("buildCustomEnvLocal emits the backend origin once and leaves route prefixes to the app", () => {
  const content = buildCustomEnvLocal("4500");
  expect(content).toContain("NEXT_PUBLIC_API_URL=http://localhost:4500\n");
  expect(content).not.toContain("localhost:4500/api/v1");
  expect(content).toContain("JWT_SECRET=");
});

// 2026-07-26 (agent-autonomy-assessment follow-on, live proof): this used
// to fall back to the literal string "default_dev_secret" whenever
// process.env.JWT_SECRET was unset at generation time. Confirmed live in
// complex1's shipped frontend/.env.local: JWT_SECRET=default_dev_secret,
// while the deployed backend's docker-compose.yml independently got a
// THIRD, different hardcoded value from the live Riya agent — three
// uncoordinated fallbacks, no single source of truth. Riya's deploy-time
// write (agents/riya/src/index.ts) is now the authoritative one and always
// overwrites this file with a real generated secret before the app starts,
// but this scaffold-time placeholder must never be a fixed, predictable
// string either.
test("buildCustomEnvLocal never falls back to a fixed, predictable JWT_SECRET value", () => {
  const content = buildCustomEnvLocal("4500");
  expect(content).not.toContain("default_dev_secret");
});

// 2026-08-16 (aanya-nexui-migration Task 2): Task 1 moved vendoring from
// whole-package cpSync copies under vendor/ to per-component .tsx files
// copied by @yugnex/cli into components/nexui/ — there is no vendor/
// directory produced at all anymore (confirmed: vendorNexui's real output
// path is outputDir/components/nexui/<name>.tsx, see its own tests above).
// components/nexui/*.tsx are real, first-party project source now (the
// whole point of the shadcn/ui-style "you own the code" model) and MUST be
// typechecked like any other project file — excluding them would silently
// let a broken vendored component ship. "vendor" is dropped from exclude;
// node_modules stays (@yugnex/core itself ships pre-built dist, no reason
// to typecheck it either way since it's not under this project's own
// TypeScript scope).
test("scaffold tsconfig no longer excludes vendor (Task 1 writes components/nexui/, not vendor/) and still excludes node_modules", () => {
  const tsconfig = JSON.parse(buildScaffoldTsconfig());
  expect(tsconfig.exclude).toContain("node_modules");
  expect(tsconfig.exclude).not.toContain("vendor");
});

// 2026-08-16 (aanya-nexui-migration Task 2): transpilePackages existed to
// make Next.js transpile @yugnex/nexui-react's raw TypeScript source (the
// old vendored package shipped .ts, not prebuilt .js). @yugnex/core ships
// pre-built dist/*.js (confirmed: node_modules/@yugnex/core/dist/index.js,
// client.js — real npm install, not assumed) — nothing needs transpiling.
// Verified empirically this session: a real `npm install` + `npx next
// build` against a minimal project depending on @yugnex/core, with NO
// transpilePackages entry at all, compiles clean (no "Unexpected token" /
// unresolved-syntax errors that would indicate raw TS leaking into the
// build). Same forensics as before: scaffold next.config must not carry the
// dead experimental.serverComponentsExternalPackages key either (renamed
// upstream in Next 15, invalid on Next 16.2).
test("scaffold next.config has no dead experimental key and no transpilePackages (nothing needs transpiling anymore)", () => {
  const config = buildScaffoldNextConfig();
  expect(config).not.toContain("serverComponentsExternalPackages");
  expect(config).not.toContain("transpilePackages");
  expect(config).not.toContain("@yugnex/nexui-react");
  expect(config).not.toContain("@yugnex/nexui");
});

// ── writeStaticScaffold's package.json (Task 2) ─────────────────────────────
// Replaces the old file:./vendor/nexui[-react] deps with @yugnex/core as a
// real, non-file: npm dependency (confirmed live: `npm view @yugnex/core
// version` → 0.1.0, published on the public npm registry, not a private-only
// package).
test("scaffold package.json depends on @yugnex/core as a real dependency, not a file: vendored path", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-pkg-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@yugnex/core"]).toBe("^0.1.0");
    expect(pkg.dependencies["@yugnex/core"]).not.toContain("file:");
    expect(pkg.dependencies["@yugnex/nexui"]).toBeUndefined();
    expect(pkg.dependencies["@yugnex/nexui-react"]).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── writeStaticScaffold's app/globals.css (Task 2) ─────────────────────────
// @yugnex/core ships ZERO CSS files (confirmed: `npm pack`'d tarball and
// node_modules/@yugnex/core/dist/ contain only .js/.d.ts/.map — no
// nexui-tokens.css/nexui-base.css equivalent exists in any form). Token
// injection happens at runtime via <ThemeProvider> (see layout.tsx below),
// not a static @import. globals.css keeps the reset/base rules but now
// references @yugnex/core's real CSS custom-property names
// (--nx-color-background, not the old --nx-bg-base) and drops the dead
// @import entirely.
test("scaffold globals.css does not @import any @yugnex/nexui CSS file (none exists in the new package)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-css-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    const css = readFileSync(join(dir, "app", "globals.css"), "utf-8");
    expect(css).not.toContain("@yugnex/nexui/css");
    expect(css).not.toContain("nexui-tokens.css");
    expect(css).not.toContain("nexui-base.css");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffold globals.css uses @yugnex/core's real CSS variable names (--nx-color-*), not the old --nx-bg-base/--nx-text names", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-css-vars-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    const css = readFileSync(join(dir, "app", "globals.css"), "utf-8");
    expect(css).toContain("var(--nx-color-background)");
    expect(css).toContain("var(--nx-color-foreground)");
    expect(css).not.toContain("--nx-bg-base");
    expect(css).not.toContain("--nx-text)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffold globals.css still imports the per-project override file (now font-only, see theme.ts)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-css-import-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    const css = readFileSync(join(dir, "app", "globals.css"), "utf-8");
    expect(css).toContain('@import "./theme-overrides.css"');
    const overrideCss = readFileSync(join(dir, "app", "theme-overrides.css"), "utf-8");
    // Task 2: theme-overrides.css no longer carries color --nx-* overrides
    // (those now flow through createTheme()/ThemeProvider in layout.tsx) —
    // it is font-only now (see theme.ts's buildFontOverrideCss).
    expect(overrideCss).not.toContain("--nx-");
    expect(overrideCss).toContain("font-family");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── writeStaticScaffold's app/layout.tsx (Task 2) ──────────────────────────
// Real shape confirmed against @yugnex/core@0.1.0's published dist/*.d.ts
// this session, NOT the README's usage example — the README shows
// `import { StyleRegistry, ThemeProvider, NoFoucScript } from
// "@yugnex/core/client"`, which is WRONG: a real `next build` against that
// exact import fails with "Module '@yugnex/core/client' has no exported
// member 'NoFoucScript'". NoFoucScript is a server-safe export (no hooks)
// and only lives on the main "@yugnex/core" entry; StyleRegistry/
// ThemeProvider (both "use client") are the only real /client exports.
test("scaffold layout.tsx imports StyleRegistry/ThemeProvider from @yugnex/core/client and NoFoucScript/createTheme from @yugnex/core (not from /client — real published shape, README's example is wrong)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-layout-imports-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    const layout = readFileSync(join(dir, "app", "layout.tsx"), "utf-8");
    expect(layout).toMatch(/import\s*\{\s*StyleRegistry,\s*ThemeProvider\s*\}\s*from\s*"@yugnex\/core\/client"/);
    expect(layout).toMatch(/import\s*\{\s*createTheme,\s*NoFoucScript\s*\}\s*from\s*"@yugnex\/core"/);
    expect(layout).not.toContain("NoFoucScript } from \"@yugnex/core/client\"");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffold layout.tsx no longer references NexuiProvider or @yugnex/nexui-react", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-layout-noold-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    const layout = readFileSync(join(dir, "app", "layout.tsx"), "utf-8");
    expect(layout).not.toContain("NexuiProvider");
    expect(layout).not.toContain("@yugnex/nexui-react");
    expect(layout).not.toContain("customTokens");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffold layout.tsx builds the theme from buildThemeOverrideTokens via createTheme() and mounts NoFoucScript + StyleRegistry + ThemeProvider in the real required nesting", () => {
  const dir = mkdtempSync(join(tmpdir(), "aanya-scaffold-layout-shape-"));
  try {
    writeStaticScaffold(FIX_TEST_PLAN, dir);
    const layout = readFileSync(join(dir, "app", "layout.tsx"), "utf-8");
    expect(layout).toContain("createTheme(");
    // Real, per-project color overrides (FALLBACK_BRIEF's accent) must
    // actually reach createTheme() — not a placeholder object.
    expect(layout).toContain('"light":');
    expect(layout).toContain('"dark":');
    // NoFoucScript must render before hydration (real requirement per its
    // own doc comment: "Render once, as early as possible in the root
    // layout") — inside <head>, not nested under StyleRegistry/ThemeProvider.
    expect(layout).toMatch(/<head>[\s\S]*<NoFoucScript \/>[\s\S]*<\/head>/);
    expect(layout).toMatch(/<StyleRegistry>[\s\S]*<ThemeProvider[\s\S]*<\/StyleRegistry>/);
    expect(layout).toContain("defaultColorMode=");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A6 (full-system audit, Phase C): same fix-loop pattern as Shubham's
// buildFixTask — targets the SAME outputDir run() already wrote to, with a
// fix-focused task instead of a from-scratch build task.
//
// 2026-07-26 (agent-autonomy-assessment F1/F2): same root-cause fix as
// Shubham's identical test file — see that file's header comment for the
// live evidence. "Fix ONLY these specific issues" is gone; root-cause
// reasoning and full system context are now instructed.
test("buildFixTask numbers each finding", () => {
  const task = buildFixTask(
    ["[logic/HIGH] frontend/lib/api.ts: dueDate type mismatch (Date vs string)"],
    FIX_TEST_PLAN,
  );
  expect(task).toContain("1. [logic/HIGH] frontend/lib/api.ts: dueDate type mismatch (Date vs string)");
});

test("buildFixTask instructs root-cause diagnosis, not blind point-fixing", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task).not.toContain("Fix ONLY these specific issues");
  expect(task).not.toContain("do not refactor working code that wasn't flagged");
  expect(task.toLowerCase()).toContain("root cause");
});

test("buildFixTask includes the full system context, not just the bug report", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task).toContain("Greenway Estates Portal");
});

test("buildFixTask instructs verification before task_complete", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task.toLowerCase()).toContain("verif");
  expect(task).toContain("task_complete");
});

// ── Step 1: the generator must actually RECEIVE the spec's requirements ──────
// 2026-08-04 (live, verify4617991): buildAgentTask's prompt says "Every page
// must show real content from the project spec" — but the spec was never
// included in the message. BuildPlan had no features field at all, so Aanya
// had only appDescription (one paragraph) plus Arjun's 9-word task label
// "Implement Services and Products catalog pages". It produced a 23-line page
// with 4 services when the spec named 9. The model wasn't underperforming; it
// was never told what to build.
const PLAN_WITH_FEATURES: BuildPlan = {
  ...FIX_TEST_PLAN,
  features: [
    {
      name: "Service & Product Catalog",
      description: "Services page detailing mobile app development, CRM, POS, bulk SMS, and digital marketing.",
      userStories: ["As a visitor I can browse the Services page to see every offering"],
    },
  ],
};

test("buildAgentTask includes the spec's feature names, descriptions and user stories", () => {
  const task = buildAgentTask(PLAN_WITH_FEATURES, "preview");

  expect(task).toContain("Service & Product Catalog");
  expect(task).toContain("CRM");
  expect(task).toContain("bulk SMS");
  expect(task).toContain("As a visitor I can browse the Services page to see every offering");
});

test("buildAgentTask still works for a plan with no features (backward compatible)", () => {
  const task = buildAgentTask({ ...FIX_TEST_PLAN, features: [] }, "preview");
  expect(task).toContain("PROJECT:");
});

// 2026-08-08: explicit user request — every generated app's footer must
// carry a YugNex attribution watermark (the REAL logo, provided by the
// user at E:/ai yug/logo/YugNex_Transparent.png, trimmed+resized via sharp
// and embedded as a data URI — see YUGNEX_LOGO_DATA_URI's header comment
// for why a data URI over a copied file) + "Developed & Managed by
// YugNex™" + a trademark-property note. Separate from and not in
// conflict with rule 10's ban on internal TOOLING names (NexSidi/NexUI/
// @yugnex) — "YugNex" here is the company name, a legitimate attribution.
test("buildAgentPrompt instructs adding the real YugNex logo + watermark text to the footer, with the TM symbol and a trademark note", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("YUGNEX WATERMARK");
  expect(prompt).toContain("Developed & Managed by YugNex™");
  expect(prompt).toContain("YugNex™ is a trademark of YugNex Technology (OPC) Private Limited.");
  expect(prompt).toContain("data:image/png;base64,");
  expect(prompt).toContain("alt=\"YugNex\"");
});

// 2026-08-10: real bug found live (project freshtst1) — the watermark's
// example <img> tag used `style="height:24px;width:auto;opacity:0.75"` — a
// plain HTML string attribute. That's invalid JSX (React requires `style` to
// be an object, `style={{...}}`); Aanya faithfully copied the invalid
// example verbatim, and "npx next build" failed on it every single time,
// costing a full extra fix-and-rebuild cycle to self-correct (confirmed
// live: Aanya diagnosed and fixed it, but that's a wasted round-trip this
// prompt itself caused). The example must be syntactically valid JSX so
// there's nothing to copy-paste wrong.
test("the watermark example uses a valid JSX style object, not an invalid HTML-style string attribute", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toMatch(/style="height:24px/);
  expect(prompt).toContain('style={{ height: "24px", width: "auto", opacity: 0.75 }}');
});

// ── NEXUI COMPONENT API rewrite (Task 3) — regression tests ────────────────
// 2026-08-16 (aanya-nexui-migration Task 3): every prop name/value below was
// copied from the REAL registry source (E:\nex-ui\apps\docs\public\r\*.json)
// during this task, not written from memory or by pattern-matching the old
// prompt's style — see this task's own report for the full component ->
// source-file verification table. These tests mirror the exact
// "asserts the WRONG old pattern is gone AND the RIGHT new pattern is
// present" style already established by the proxy.ts/middleware.ts tests
// above (search "system prompt correctly requires middleware.ts") — same
// idea, applied to every component whose old and new prop shapes differ.
test("prompt has zero references to the old @yugnex/nexui-react package as an importable dependency", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain('from "@yugnex/nexui-react"');
  expect(prompt).toContain("@/components/nexui/button");
});

test("Button: prompt uses the real variant/tone split (solid/outline/ghost/soft + tone), not the old variant=\"primary\"", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain('variant="primary"');
  expect(prompt).toContain('variant="solid" tone="primary"');
  expect(prompt).toContain("isLoading");
});

test("Badge: prompt uses tone for semantic color (success/warning are tones, not variants)", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain('variant="success"');
  expect(prompt).not.toContain('variant="warning"');
  expect(prompt).toContain('tone="success"');
  expect(prompt).toContain('tone="warning"');
});

test("Checkbox: prompt uses onCheckedChange (not onChange) and does not claim a built-in label prop", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("<Checkbox checked={done} label=");
  expect(prompt).not.toContain("onChange={setDone}");
  expect(prompt).toContain("onCheckedChange={(c) => setDone(c === true)}");
});

test("Switch: prompt uses onCheckedChange (not onChange) and does not claim label/size/color props", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("onChange={setEnabled}");
  expect(prompt).not.toContain('<Switch checked={enabled} onChange={setEnabled} label=');
  expect(prompt).toContain("onCheckedChange={setEnabled}");
});

test("Modal: prompt uses the real compound-component API (open/onOpenChange, ModalContent/ModalHeader/ModalFooter), not the old onClose/title/footer props", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("onClose={() => setOpen(false)}");
  expect(prompt).not.toMatch(/<Modal[^>]+title="/);
  expect(prompt).toContain("onOpenChange={setOpen}");
  expect(prompt).toContain("ModalContent");
  expect(prompt).toContain("ModalHeader");
  expect(prompt).toContain("ModalFooter");
});

test("Select: prompt uses the real data-driven options array API, not the old SelectItem/SelectGroup JSX children", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("<SelectItem");
  expect(prompt).not.toContain("<SelectGroup");
  expect(prompt).toContain("options={[");
  expect(prompt).toContain("SelectField");
});

test("Tabs: prompt uses the real TabsPanel component, not the old TabsContent name", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toMatch(/<TabsContent[ >]/);
  expect(prompt).not.toContain('TabsContent value="all"');
  expect(prompt).toContain("TabsPanel");
});

test("Tooltip: prompt uses the real placement prop (not side) and the real default delay", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain('side="top"');
  expect(prompt).not.toContain("default 400");
  expect(prompt).toContain('placement="top"');
});

test("Progress: prompt uses the real tone prop (not variant/color) — linear bar only, no circular variant", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain('variant="linear"');
  expect(prompt).not.toContain('color="accent"');
  expect(prompt).toContain('tone="primary"');
});

test("Skeleton: prompt uses the real shape prop (not variant)", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain('variant="text"');
  expect(prompt).not.toContain('variant="rect"');
  expect(prompt).toContain('shape="text"');
  expect(prompt).toContain('shape="rect"');
});

test("Avatar: prompt uses a numeric size prop, not a sm/md/lg size string", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("size={40}");
});

test("Panel & Spinner: prompt teaches css()/keyframes() replacements, not the removed <Panel>/<Spinner> components", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toMatch(/<Panel[ >]/);
  expect(prompt).not.toMatch(/<Spinner[ >]/);
  expect(prompt).toContain("NO Panel and NO Spinner component");
  expect(prompt).toContain("panelClass = css({");
  expect(prompt).toContain("spinnerClass = css({");
  expect(prompt).toContain("keyframes({");
});

test("NexUI CSS variables: prompt uses the real --nx-color-* naming convention, not the old --nx-bg-base/--nx-accent/--nx-green names", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("--nx-bg-base");
  expect(prompt).not.toContain("--nx-bg-elevated");
  expect(prompt).not.toContain("var(--nx-accent)");
  expect(prompt).not.toContain("--nx-green");
  expect(prompt).not.toContain("--nx-red");
  expect(prompt).toContain("var(--nx-color-background)");
  expect(prompt).toContain("var(--nx-color-primary)");
  expect(prompt).toContain("var(--nx-color-destructive)");
});

test("Layout patterns: prompt no longer tells Aanya to use Panel for layout", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("Use Panel and gap for layout");
  expect(prompt).toContain("Use css()");
});

test("STACK section and loading-state rule no longer mention the removed Spinner component", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).not.toContain("use Spinner while fetching");
  expect(prompt).toContain("isLoading prop for in-button loading");
});
