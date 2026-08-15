import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentPrompt, buildAgentTask, buildCustomEnvLocal, buildScaffoldTsconfig, buildScaffoldNextConfig, buildFixTask, vendorNexui, NEXUI_CONFIRMED_COMPONENTS, countPlannedPages, writeStaticScaffold } from "./index.ts";
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
test("vendorNexui shells out to the CLI's init then add commands with the configured registry URL and outputDir as cwd", () => {
  const outputDir = "/fake/output/dir";
  const calls: Array<{ command: string; cwd: string }> = [];
  const fakeExec = (command: string, options: { cwd: string }) => {
    calls.push({ command, cwd: options.cwd });
    return "";
  };

  const previous = process.env.NEXUI_REGISTRY_URL;
  process.env.NEXUI_REGISTRY_URL = "https://fixture.example.test";
  try {
    vendorNexui(outputDir, ["button", "card"], fakeExec);
  } finally {
    if (previous === undefined) delete process.env.NEXUI_REGISTRY_URL;
    else process.env.NEXUI_REGISTRY_URL = previous;
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
  const calls: string[] = [];
  const fakeExec = (command: string) => { calls.push(command); return ""; };

  const previous = process.env.NEXUI_REGISTRY_URL;
  delete process.env.NEXUI_REGISTRY_URL;
  try {
    vendorNexui("/fake/output/dir", ["button"], fakeExec);
  } finally {
    if (previous !== undefined) process.env.NEXUI_REGISTRY_URL = previous;
  }

  expect(calls[0]).toContain("https://new.yugnex.com");
});

test("vendorNexui defaults to the 13 confirmed-mapped components when none are specified", () => {
  // Component API audit (docs/nexsidi/plans/2026-08-16-aanya-nexui-migration.md):
  // aanyaTasks/BuildPlan only carry freeform task descriptions and output
  // file paths — no structured record of which UI components a task
  // actually uses — so per-project component selection can't be derived
  // reliably without guessing which the plan explicitly forbids. Default to
  // fetching every confirmed-mapped component every time instead.
  const calls: string[] = [];
  const fakeExec = (command: string) => { calls.push(command); return ""; };
  vendorNexui("/fake/output/dir", undefined, fakeExec);

  // Note: the plan doc labels this list "13 direct matches" but actually
  // enumerates 14 names (button, card, input, badge, checkbox, modal, tabs,
  // select, tooltip, switch, progress, skeleton, avatar, separator) — an
  // off-by-one in the doc's own count, not in the names themselves. Verified
  // directly against the real registry index.json
  // (E:\nex-ui\apps\docs\public\r\index.json): all 14 names exist there.
  expect(NEXUI_CONFIRMED_COMPONENTS.length).toBe(14);
  for (const name of NEXUI_CONFIRMED_COMPONENTS) {
    expect(calls[1]).toContain(name);
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

// Diagnosis 2026-07-04 (stress2/stress3 forensics): the scaffold tsconfig
// excluded only node_modules, so Next's typecheck compiled vendor/nexui-react/
// src — which is React-19-type-broken — and EVERY run burned 10-20 iterations
// until a model discovered it must add "vendor" to exclude (stress3: Claude
// iteration 23). Ship the fix in the scaffold instead.
test("scaffold tsconfig excludes vendor so Next never typechecks vendored NexUI source", () => {
  const tsconfig = JSON.parse(buildScaffoldTsconfig());
  expect(tsconfig.exclude).toContain("node_modules");
  expect(tsconfig.exclude).toContain("vendor");
});

// Same forensics: scaffold next.config shipped experimental.serverComponents-
// ExternalPackages — renamed upstream in Next 15, invalid on Next 16.2. Claude
// deleted it in BOTH stress2 and stress3 (identical edit, iteration 11 each).
test("scaffold next.config has no dead experimental key and keeps transpilePackages", () => {
  const config = buildScaffoldNextConfig();
  expect(config).not.toContain("serverComponentsExternalPackages");
  expect(config).toContain("transpilePackages");
  expect(config).toContain("@yugnex/nexui-react");
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
