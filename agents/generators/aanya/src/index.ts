// Aanya — Next.js 16.2 frontend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run next build → fix → repeat.
// UI: @yugnex/nexui-react (NexSidi's own library) — NO Tailwind, NO shadcn/ui.

import { resolveGeneratorRunner } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { join, resolve } from "path";
import type { BuildPlan } from "../../../arjun/src/index.ts";
import { buildSystemContext } from "../../../arjun/src/index.ts";
import { formatDesignBriefForPrompt } from "../../../vanya/src/index.ts";
import { buildThemeOverrideCss, buildThemeOverrideTokens } from "./theme.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";
import { loadAndInjectContract } from "../../../../pipeline/orchestrator/stages/contract-extractor.ts";

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", projectId, "frontend");
}

// 2026-07-08: see agents/generators/shubham/src/index.ts's identical helper
// for the full rationale (Patent Claim 2's instinct memory finally wired
// up, read side). Fails safe: memory is an enrichment, not a hard
// dependency.
async function loadKnownMistakesPrefix(): Promise<string> {
  try {
    const { queryRecentInstincts, formatInstinctsForPrompt, REACHABLE_INSTINCT_DOMAINS } = await import("@nexsidi/db");
    // 2026-07-24 (P3.W3.3): was hardcoded to "security" only — missed every
    // performance/architecture instinct QA ever recorded. See
    // queryRecentInstincts's comment for the bug this closes.
    const instincts = await queryRecentInstincts(REACHABLE_INSTINCT_DOMAINS);
    const formatted = formatInstinctsForPrompt(instincts);
    return formatted ? `${formatted}\n\n` : "";
  } catch {
    return "";
  }
}


// ── Main entry ────────────────────────────────────────────────────────────────
// mode "preview": Stage 3 UI-only build shown to the user for design approval
//                 before any backend exists — mock data only, no fetch() calls.
// mode "integrate": wires the already-approved preview UI to the real backend
//                 API — no layout/visual changes, only mock data → real fetch().
export async function run(plan: BuildPlan, mode: "preview" | "integrate"): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId);
  mkdirSync(outputDir, { recursive: true });

  // 1. Vendor in NexSidi UI packages (no external npm required in Docker)
  vendorNexui(outputDir);

  // 2. Write static scaffold
  writeStaticScaffold(plan, outputDir);

  // 3. Run real agent loop
  // Primary history: kimi-k2.6 (failed, F7) -> z-ai/glm-5.2 (2026-07-03) ->
  // mistral-medium-3.5-128b (2026-07-04). glm-5.2 demoted after
  // scripts/ping-glm.ts proved its endpoint hangs past the 120s timeout on
  // EVERY request shape including a trivial "say hi" — and the stress-2/3 run
  // logs show mistral-medium-3.5-128b (then the fallback) actually performed
  // all of the generation work anyway. glm-5.2 dropped from the chain
  // entirely, not just demoted: a hanging endpoint costs a full 120s timeout
  // per attempt before failing over, which is strictly worse than going
  // straight to a working model. runAgentEscalated (Task 15): the open-source
  // chain runs first; escalates to Sonnet 5 for a single retry only when the
  // whole chain genuinely fails. See packages/agent-runtime/src/claude-loop.ts.
  const knownMistakesPrefix = await loadKnownMistakesPrefix();

  const result = await resolveGeneratorRunner()({
    agentName: "aanya",
    model: "mistralai/mistral-medium-3.5-128b",
    // 2026-07-24: qwen3.5-122b-a10b (chosen for being a genuinely different
    // architecture from the primary) returns HTTP 410 Gone as of 2026-07-20
    // — the NIM endpoint was permanently removed (see types.ts's ModelId
    // comment). Using it as a fallback meant a real failure of the primary
    // model fell through to a fallback that would ALWAYS also fail. Swapped
    // for qwen3-next-80b, the documented working replacement.
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey,
    systemPrompt: loadAndInjectContract(plan.projectId, knownMistakesPrefix + buildAgentPrompt(mode)),
    initialMessage: buildAgentTask(plan, mode),
    sandboxDir: outputDir,
    projectId: plan.projectId,
    // 2026-07-12: Aanya was kept on the cheap flash model to avoid a
    // rate-limit collision with Shubham's parallel run on pro.
    // 2026-07-25 (Phase 1, full MVP upgrade): reversed. Verified against
    // System B's own weighting (nexsidi-adversarial-qa): designQuality +
    // originality are 0.35 each — 0.70 of the live subjective score — and
    // are exactly the two criteria a flash model reliably fails ("purple
    // gradients over white cards" AI-slop pattern), so keeping Aanya on
    // flash was capping the single most heavily-weighted gate in the
    // pipeline. The original rate-limit worry doesn't actually reproduce
    // under the new tier map: Shubham now runs on "generation" (3.6-flash
    // leading, never pro) while Aanya runs on "design" (3.1-pro-preview
    // leading) — the two parallel generators are on DIFFERENT primary
    // models, so there is no shared-pool collision. QA's own use of
    // gemini-3.1-pro-preview runs AFTER generation completes (see
    // project-build.ts's `await Promise.all(genPromises)` before the QA
    // stage begins), not concurrently with it.
    geminiTier: "design",
    // http tools so Aanya still self-verifies (npm install + next build +
    // typecheck).
    enableHttpTools: true,
    enableWebSearch: true,
    // Phase 5 (full agentic upgrade): read the FULL content of a specific
    // page the user referenced (their existing site, a design reference)
    // instead of guessing at it — web_search alone only gives a
    // synthesized multi-source answer, not one exact page's real content.
    enableWebFetch: true,
    enableScreenshot: true,
    enableBrowser: true,
    // 2026-08-06: real gap found live — "Live UI is Tier 3" (this comment,
    // previously) meant Aanya NEVER checked whether its own nav links
    // actually navigate anywhere, whether a page renders its expected
    // content, or anything beyond "does it compile." Tier 3 (Tilotma) does
    // check this, but only on the fully deployed app, minutes/hours later —
    // not Aanya verifying its own work before handing it off. See CLICK-
    // THROUGH NAVIGATION VERIFICATION below for what this now requires.
    enableDockerTools: true,
    requiredVerificationCommands: ["npx tsc --noEmit", "npx next build"],
    // 2026-07-25: raised to 60. Measured live in nextech7: Aanya hit the
    // 40-iteration default exactly while still running npx next build to fix
    // proxy.ts + portal dashboard import issues. Pattern: ~32 write iterations
    // + ~8 build-fix iterations = 40 (cap). 60 gives a safe 20-iteration
    // margin. Non-retryable failure is already in place (generatorFailure()),
    // so a cap hit costs one attempt only.
    maxIterations: 60,
  });

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    errors: result.errors,
  };
}

// A6 (full-system audit, Phase C): Stage 5 QA findings previously went
// nowhere — run.ts's own comment documented the gap. runFix() targets the
// SAME outputDir run() already wrote to — no re-vendoring, no scaffold
// rewrite, no mode param (the locked preview/integrate design is already
// fixed by this point) — just the agent loop pointed at a fix task instead
// of a from-scratch build task.
// 2026-07-26 (agent-autonomy-assessment F1/F2): same root-cause fix as
// Shubham's identical prompt — see shubham/src/index.ts's buildFixTask for
// the full live evidence. "Fix ONLY these specific issues" forced
// point-fixes to symptoms instead of root causes, and the agent never saw
// the API contract/DB schema it needed to tell whether a fix belonged in
// its own layer at all.
export function buildFixTask(findings: string[], plan: BuildPlan): string {
  return `An adversarial QA review found the following issues in the frontend code you already wrote.

${buildSystemContext(plan)}

ISSUES TO FIX:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Each finding is a SYMPTOM, not necessarily the whole problem. Before editing:
1. Diagnose the root cause — read the full component/file the finding points
   at, not just the cited line. Check the API contract above: an "API
   contract mismatch" or "over-fetching" finding is often really the
   frontend not using a query param the backend already supports.
2. Check whether the same class of issue elsewhere in your own files has the
   same root cause — fix all real instances of it, not just the one cited.
3. Stay within your own domain (frontend) and don't change layout or visual
   design that wasn't flagged.

Workflow:
1. Use read_file to see the exact current content of each affected file
2. Use edit_file for targeted fixes (cheaper than rewriting the whole file) — use write_file only if the fix genuinely requires touching most of the file
3. Run "npx next build" to verify nothing broke
4. Call task_complete with verification_passed: true only after verifying the fix actually addresses the root cause, not just silences the symptom`;
}

export async function runFix(plan: BuildPlan, findings: string[]): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId); // SAME dir run() wrote to — not regenerated
  // F7 (agent-autonomy-assessment): mirrors Shubham's identical fix — see
  // that file for the full rationale.
  const knownMistakesPrefix = await loadKnownMistakesPrefix();

  const result = await resolveGeneratorRunner()({
    agentName: "aanya",
    model: "mistralai/mistral-medium-3.5-128b",
    // 2026-07-24: see run()'s identical fix above — qwen3.5-122b-a10b 410s
    // (endpoint permanently removed 2026-07-20); swapped for the documented
    // working replacement, qwen3-next-80b.
    fallbackModels: ["qwen/qwen3-next-80b-a3b-instruct"],
    apiKey,
    systemPrompt: knownMistakesPrefix + buildAgentPrompt("integrate"), // fix always happens post-integrate, per Stage 5's placement after Stage 4
    initialMessage: buildFixTask(findings, plan),
    sandboxDir: outputDir,
    projectId: plan.projectId,
    // flash (default) — see the rationale on Aanya's run() config above.
    enableHttpTools: true,
    enableWebSearch: true,
    // Phase 5 (full agentic upgrade): read the FULL content of a specific
    // page the user referenced (their existing site, a design reference)
    // instead of guessing at it — web_search alone only gives a
    // synthesized multi-source answer, not one exact page's real content.
    enableWebFetch: true,
    enableScreenshot: true,
    enableBrowser: true,
    // P3 (agent-autonomy-assessment F3): mirrors Shubham's identical flag —
    // see that file for the full rationale.
    enableEscalation: true,
    enableDockerTools: true,
    requiredVerificationCommands: ["npx tsc --noEmit", "npx next build"],
    // 2026-07-25: reverted the maxIterations override — see run() above.
  });

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    escalations: result.escalations,
    errors: result.errors,
  };
}

// Full-system audit E1: vendored packages' own package.json declares
// devDependencies (@types/react@^18) that conflict with the generated app's
// root deps (React 19). Stripping devDependencies here — before the vendored
// package.json ever lands in the generated project — means there is nothing
// for npm to install a conflicting nested copy of. Confirmed root cause via
// stress-test runs 8/9/10: every model (glm-5.2, mistral-medium-3.5-128b,
// claude-sonnet-5) burned real iterations discovering and working around
// vendor/nexui-react/node_modules/@types/react (v18) shadowing root's v19.
// Falls back to the original content unchanged on unparseable JSON — a
// corrupt vendored package.json should surface as a build error downstream,
// not crash generation here.
export function stripDevDependencies(packageJsonContent: string): string {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(packageJsonContent);
  } catch {
    return packageJsonContent;
  }
  delete pkg.devDependencies;
  return JSON.stringify(pkg, null, 2);
}

// ── Vendor NexUI into the generated project ───────────────────────────────────
export function vendorNexui(outputDir: string): void {
  const vendorDir = join(outputDir, "vendor");
  mkdirSync(vendorDir, { recursive: true });

  const nexuiPublishDir = resolve(process.env.NEXUI_DIR ?? join(process.cwd(), "nexui-publish"));
  const nexuiSrc = join(nexuiPublishDir, "nexui");
  const nexuiReactSrc = join(nexuiPublishDir, "nexui-react");

  if (existsSync(nexuiSrc)) {
    cpSync(nexuiSrc, join(vendorDir, "nexui"), { recursive: true,
      filter: (src) => !src.includes("node_modules") });
    stripVendoredPackageJsonDevDeps(join(vendorDir, "nexui", "package.json"));
  }
  if (existsSync(nexuiReactSrc)) {
    cpSync(nexuiReactSrc, join(vendorDir, "nexui-react"), { recursive: true,
      filter: (src) => !src.includes("node_modules") });
    stripVendoredPackageJsonDevDeps(join(vendorDir, "nexui-react", "package.json"));
  }

  // 2026-08-06: real bug found live (project 88d7b375eaef) — NexUI's own CSS
  // (nexui-base.css) declares @font-face src url('../fonts/NexuiSans-*.woff2')
  // etc., relative to vendor/nexui/css/. Next.js's Turbopack bundles that
  // @import'd CSS and resolves the relative url() to a root-relative
  // "/fonts/<file>.woff2" — but nothing in the generated app serves that path,
  // since only files under public/ are exposed at the app root and vendor/
  // isn't public/. Every NexUI font 404'd, the browser fell through the whole
  // stack to a fallback, and the resulting mismatch between Next's font-metric
  // overrides (calibrated for the intended custom faces) and the actual
  // fallback rendering produced visibly corrupted/overlapping glyphs — caught
  // live by Tilotma's Stage 2 reality-checker (mojibake like "Email" ->
  // "Es ail"). Fix: also copy the font files to public/fonts/ so Next's static
  // file serving actually answers the request the bundled CSS makes.
  const nexuiFontsSrc = join(nexuiSrc, "fonts");
  if (existsSync(nexuiFontsSrc)) {
    const publicFontsDir = join(outputDir, "public", "fonts");
    mkdirSync(publicFontsDir, { recursive: true });
    cpSync(nexuiFontsSrc, publicFontsDir, { recursive: true });
  }
}

function stripVendoredPackageJsonDevDeps(packageJsonPath: string): void {
  if (!existsSync(packageJsonPath)) return;
  const content = readFileSync(packageJsonPath, "utf-8");
  writeFileSync(packageJsonPath, stripDevDependencies(content), "utf-8");
}

// 2026-08-08: explicit user request — the real YugNex logo (packages/
// agent-runtime/assets/yugnex-logo.png, source: E:/ai yug/logo/YugNex_
// Transparent.png, trimmed to content + resized 2048x2048 -> 137x96 via
// sharp, alpha channel preserved). Embedded as a data URI rather than
// copied into each generated app's public/ folder: it's a FIXED, never-
// changing constant, so it becomes part of the stable prompt prefix every
// call shares — implicit prompt caching (see gemini.ts's comments on
// Vertex's automatic caching of repeated byte-identical prefixes) means
// this is billed once per cache window, not once per call, and it avoids
// a whole extra file-copy step in generation that could be forgotten.
export const YUGNEX_LOGO_DATA_URI =
  "data:image/png;base64,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";

// ── Agent system prompt ───────────────────────────────────────────────────────
// Shared base (stack rules, NexUI usage, layout patterns, critical rules) is the
// same regardless of mode. Mode-specific addenda below tell Aanya whether this
// is a mock-data-only preview build (Stage 3, pre-approval) or a real-backend
// integration pass (post-approval, wiring the locked preview to live APIs).
const AANYA_SHARED_PROMPT_BASE = `\
You are Aanya, a senior Next.js 16.2 + TypeScript frontend engineer.
You have tools to write files and run commands. DO NOT output text — USE TOOLS.

PLAN-THEN-EXECUTE — this is the most important rule in this prompt:
Your task message lists the COMPLETE, exhaustive file manifest under
"PLANNED FRONTEND FILES AND PAGES." Do not discover the app one file at a
time by writing something and immediately rebuilding — you already have the
whole plan. Write EVERY planned file before you run "npx next build" even
once. Building after each individual file is the exact waste this workflow
exists to remove.

Your workflow:
1. Use list_files ONCE (recursive) to understand the scaffold already present
2. Use write_file to create EVERY planned page, component, hook, and utility
   — BATCH your work: emit SEVERAL write_file calls in the SAME response
   (3-4 files per turn). One file per turn wastes most of your iteration
   budget on round trips, and so does building before the plan is complete.
3. Once every planned file is written: run_command "npm install" once.
4. Use run_command "npx next build" ONCE to verify the build passes.
5. If build fails: read the error, fix ALL the errors it reports in one
   batched pass (edit_file for small changes — cheaper than rewriting the
   whole file), THEN rebuild ONCE more to confirm — do not rebuild after
   fixing a single error in isolation.
6. Once the build passes: do the CLICK-THROUGH NAVIGATION VERIFICATION below.
7. Only after both pass: call task_complete with verification_passed: true

CLICK-THROUGH NAVIGATION VERIFICATION (required whenever you wrote more than
one page/route — skip only for a genuine single-page app, and say so in your
task_complete summary if you skip it):
"npx next build" proves the code compiles. It proves NOTHING about whether
clicking your own nav links actually goes where they say, or whether a page
renders real content instead of a blank screen or a thrown error. That gap is
exactly what this closes — you are the one person who can verify it before
anyone else ever sees this code.
  a) Write a minimal Dockerfile (disposable — for this check only; Riya
     writes the real deployment one later, do not treat this as final) and a
     docker-compose.yml that builds this project and maps it to a free host
     port. Start it with docker_compose up.
     Do NOT use run_command to start the server directly ("npm run dev",
     "next start", etc.) — run_command waits for the process to EXIT before
     returning, and a server never exits on its own, so that call will hang
     until it times out. Docker's "up -d" returns once the container is
     confirmed running, which is why this works and a bare run_command does not.
  b) browser_navigate to the running app's root URL. Use browser_get_text to
     confirm real page content rendered (not a blank page, not a Next.js
     error overlay) and browser_console_errors to confirm zero JS errors.
  c) For EVERY nav link you wrote (header/footer/sidebar — wherever you put
     primary navigation): browser_click it, then browser_current_url to
     confirm it actually navigated to the URL that link is supposed to point
     to — not back to home, not to a 404, not to a different page than its
     label says. A "Contact" link that lands anywhere but your contact page
     is a real bug, not a formality — fix the href/route, don't adjust what
     you consider "close enough."
  d) browser_get_text on at least one page beyond the homepage to confirm it
     shows real content matching what you were asked to build (not
     placeholder/lorem text, not an empty state where content should be).
  e) docker_compose down to tear down when finished.
  Budget ≤10 tool calls total for a-e. This is NOT the same check Tier 3
  (Tilotma) does — Tier 3 runs after full deployment, minutes or hours later,
  auditing the finished product; this is you verifying the code you JUST
  wrote actually behaves the way it looks like it should, before it ever
  reaches that stage.

STACK (non-negotiable):
- Next.js 16.2 / TypeScript / React 19
- UI: @yugnex/nexui-react — the NexSidi in-house UI library
  Components: Button, Panel, Card, Input, Badge, Checkbox, Spinner, Avatar, Separator,
              Modal, Tabs, Select, Tooltip, Toast, Switch, Progress, Skeleton
  Theme: NexuiProvider wraps the app in layout.tsx (already in scaffold)
  NEVER use Tailwind, shadcn/ui, @radix-ui, or any external UI library
  NEVER use @apply in CSS — use NexUI CSS variables or classnames from nexui-utils.css
  IMPORTANT: custom components like <nex-button> do NOT submit parent forms automatically. Always add onClick={handleSubmit} directly to your form's Button components to submit forms explicitly.
- Auth: Custom JWT authentication. You MUST write/generate:
  1. A custom sign-up/sign-in page (using custom API calls to the backend /api/v1/auth/login and /api/v1/auth/register).
  2. Parse the backend auth response correctly — the backend wraps ALL responses in a { success: boolean, data: {...} } envelope. For auth endpoints the token is at body.data.token, NOT body.token. Example:
       const body = await res.json();
       if (!res.ok || !body.success) { setError(body.error ?? "Request failed"); return; }
       const token = body.data.token;  // CORRECT — body.data.token, not body.token
       document.cookie = \`token=\${token}; path=/\`;
  3. Store the JWT token in cookies (e.g., set 'token' cookie) or localStorage.
  4. Include the token as an Authorization Bearer header in all backend API requests.
- API calls: see the MODE-specific instructions at the end of this prompt for
  whether to call the backend now or use mock data instead

NEXUI COMPONENT API — COMPLETE REFERENCE (do NOT read vendor source; everything you need is here):
  import { Button, Panel, Card, CardHeader, CardBody, Badge, Input, Checkbox, Spinner,
           Modal, Tabs, TabsList, TabsTrigger, TabsContent, Select, SelectItem, SelectGroup,
           Tooltip, Switch, Progress, Skeleton, Avatar, Separator } from "@yugnex/nexui-react";

  <Panel variant="surface" padding="md">...</Panel>        // container with surface bg
  <Panel variant="elevated" padding="lg">...</Panel>       // elevated card
  <Button variant="primary" size="md">Click</Button>       // primary CTA
  <Button variant="ghost" size="sm">Cancel</Button>        // ghost button
  <Input label="Title" placeholder="Enter..." value={v} onChange={e => set(e.target.value)} />
  <Badge variant="success">Done</Badge>                    // success badge
  <Badge variant="warning">Pending</Badge>                 // pending badge
  <Checkbox checked={done} label="Complete" onChange={setDone} />   // onChange receives the boolean directly
  <Spinner size="md" color="accent" />                     // loading spinner
  <Card><CardHeader>Title</CardHeader><CardBody>Body</CardBody></Card>

  // Modal — controlled; props: open (boolean, required), onClose (() => void, required),
  //   title?, footer? (ReactNode), size? "sm"|"md"|"lg"|"xl"|"full", closeable? (boolean)
  <Modal open={isOpen} onClose={() => setOpen(false)} title="Edit task"
         footer={<Button variant="primary" onClick={save}>Save</Button>}>
    ...form fields...
  </Modal>

  // Select — controlled or uncontrolled; onChange receives the VALUE STRING directly
  //   (NOT an event). Props: value?, defaultValue?, onChange? (value: string) => void,
  //   placeholder?, disabled?, size? "sm"|"md"|"lg", error?, label?
  <Select label="Priority" value={priority} onChange={(v) => setPriority(v)} placeholder="Choose...">
    <SelectItem value="low">Low</SelectItem>
    <SelectItem value="high" disabled={false}>High</SelectItem>
    <SelectGroup label="Other"><SelectItem value="none">None</SelectItem></SelectGroup>
  </Select>

  // Tabs — value/onChange controlled, or defaultValue uncontrolled
  <Tabs defaultValue="all">
    <TabsList>
      <TabsTrigger value="all">All</TabsTrigger>
      <TabsTrigger value="done">Done</TabsTrigger>
    </TabsList>
    <TabsContent value="all">...</TabsContent>
    <TabsContent value="done">...</TabsContent>
  </Tabs>

  // Tooltip — props: content (ReactNode, required), side? "top"|"bottom"|"left"|"right",
  //   delay? (ms, default 400), disabled?; wraps exactly one child
  <Tooltip content="Delete this task" side="top"><Button variant="ghost">X</Button></Tooltip>

  // Switch — onChange receives the boolean directly (NOT an event)
  <Switch checked={enabled} onChange={setEnabled} label="Notifications" size="md" color="accent" />

  // Progress — props: value? (0-100), variant? "linear"|"circular", size?, color?,
  //   label?, show-value? (boolean, note the kebab-case prop name)
  <Progress value={65} variant="linear" color="accent" label="Completion" />

  // Skeleton — props: variant? "text"|"circle"|"rect", width?/height? (CSS strings),
  //   lines? (number, for variant="text"), animate? (boolean)
  <Skeleton variant="text" lines={3} />
  <Skeleton variant="rect" width="100%" height="120px" />

  // Toast — REQUIRES setup that is NOT in the scaffold: wrap the app in
  //   <ToastProvider> and mount <Toaster /> once (e.g. in layout.tsx inside
  //   NexuiProvider). Then: const { toast } = useToast();
  //   toast("Saved");  toast.success("Done");  toast.error("Failed", { duration: 5000 });
  //   PREFER inline Badge/Panel status messages over Toast unless you add the provider.

NEXUI CSS VARIABLES (use in inline styles or className-based overrides):
  var(--nx-bg-base)       // page background
  var(--nx-bg-elevated)   // card surface
  var(--nx-text)          // primary text
  var(--nx-text2)         // secondary/muted text
  var(--nx-border)        // border color
  var(--nx-accent)        // accent color (amber #E89010)
  var(--nx-green)         // success green
  var(--nx-red)           // error red

LAYOUT PATTERNS:
  Use Panel and gap for layout — never Tailwind grid classes. Do NOT default
  to a generic nav+centered-hero+auto-fill-card-grid page structure. Derive
  the actual page structure (hero shape, section order, grid vs. list vs.
  dense-table layout, spacing rhythm) from the "Layout concept" line in the
  DESIGN IDENTITY section of your task below — that description is specific
  to THIS project and is what should drive your structural decisions, not a
  one-size-fits-all example.

STATIC FILES ALREADY WRITTEN (DO NOT rewrite unless you need to fix a bug):
- package.json (with @yugnex/nexui-react + @yugnex/nexui as file: deps)
- app/layout.tsx (NexuiProvider wrapper)
- app/globals.css (NexUI token imports, base reset — NO @apply Tailwind directives)
- proxy.ts (custom JWT cookie-based auth middleware for Next.js 16.2)
- next.config.ts
- tsconfig.json

FILES YOU MUST WRITE:
You MUST create all pages, routes, and components listed in the "PLANNED FRONTEND FILES AND PAGES" section of your task description. Typically this includes:
- app/page.tsx (landing / sign-in redirect)
- Dedicated routing files for each planned page (e.g., app/about/page.tsx, app/services/page.tsx, app/contact/page.tsx, app/dashboard/page.tsx)
- Do NOT consolidate separate public pages (about, services, contact) into dashboard tabs unless the plan explicitly requests it. Create separate dedicated file routes for them.

CRITICAL RULES:
1. NEVER use 'use client' on layout.tsx — it is a Server Component
2. Use 'use client' on any component that uses hooks (useState, useEffect, etc.)
3. API URL: const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
4. Auth token: read the 'token' cookie set at login (e.g. document.cookie.match(/(?:^|;\s*)token=([^;]+)/)?.[1]). Pass it as "Authorization: Bearer <token>" in all backend fetch() calls.
5. Error states: always show a readable error message in the UI
6. Loading states: use Spinner while fetching
7. Empty states: show a helpful message when the list is empty
8. NEVER create a middleware.ts file — Next.js 16.2 auth middleware is
   proxy.ts (already written, see above). Next.js rejects having both
   proxy.ts and middleware.ts present. If "npx next build" fails and you
   suspect a middleware conflict, use delete_file to remove any
   middleware.ts you may have created — do not try run_command('rm ...'),
   rm is not in the shell allowlist.
9. DATE DISPLAY: NEVER render raw ISO date strings to users. Any field that is a
   date (dueDate, createdAt, updatedAt, etc.) MUST be formatted before display.
   Use: new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
   Define a helper at the top of the file and reuse it: const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
   A raw "2026-07-13" or "2026-07-13T00:00:00.000Z" visible in the UI is a defect.
10. NO INTERNAL BRANDING IN USER-FACING TEXT: NEVER mention "NexSidi", "NexUI",
    "@yugnex", or any internal platform/library name in text that is visible to
    the end user (footer, navbar, error messages, tooltips, badge text, etc.).
    The generated app has its own brand — reference only the app's own name and
    WRONG footer: "Powered by NexSidi NexUI."
    CORRECT footer: "© 2026 TaskFlow. All rights reserved."
11. YUGNEX WATERMARK (explicit user request, 2026-08-08) — add exactly ONE
    attribution block in the site footer, BELOW the app's own copyright line
    (never merge them into one sentence). "YugNex" here is the COMPANY name
    (YugNex Technology (OPC) Private Limited) — a legitimate attribution, NOT
    the internal tooling names rule 10 hides. This is the REAL company logo
    (not a placeholder) — use this exact img tag verbatim, do not redraw it:
    <img src="${YUGNEX_LOGO_DATA_URI}" alt="YugNex" width="69" height="48" style="height:24px;width:auto;opacity:0.75" />
    Footer structure, e.g.:
    © 2026 TaskFlow. All rights reserved.
    [the img tag above] Developed & Managed by YugNex™
    YugNex™ is a trademark of YugNex Technology (OPC) Private Limited.
    The SVG uses currentColor so it inherits the footer's own text color —
    never hardcode a fill color on it. Keep this block visually quiet
    (small, muted opacity) — it is attribution, not a second brand competing
    with the app's own identity.
12. NO HARDCODED STATUS BADGES: NEVER render a "Connected", "Online", "Active",
    or "API Connected" badge unconditionally. A status badge must reflect ACTUAL
    runtime state — only show it after a successful fetch() round-trip proves the
    service is reachable. A hardcoded green badge that ignores the actual API
    state misleads users when the backend is down.

VERIFICATION GATE: Do not call task_complete until "npx next build" exits 0.
`;

const AANYA_PREVIEW_ADDENDUM = `
MODE: PREVIEW ONLY (Stage 3 — UI-first design approval, no backend yet)
- Use mock/placeholder data defined inline in each component (const arrays/objects
  at the top of the file, or a local mock-data module) — no fetch() calls anywhere.
- Do NOT write hooks that call the backend (no useEffect fetching from an API,
  no API client, no SWR/react-query against a real endpoint).
- Focus entirely on layout, visual hierarchy, and correct NexUI component usage.
- This build will be shown to the user for design approval BEFORE any backend
  exists — there is no live API to call yet, so mock everything realistically
  using the shapes from SHARED TYPES / the API contract as a reference only.
`;

const AANYA_INTEGRATE_ADDENDUM = `
MODE: INTEGRATE (post-approval — wire the locked preview to the real backend)
- Wire the already-approved UI (from the locked preview) to the real backend API.
- API calls: fetch() with Bearer token read from the 'token' cookie (document.cookie parse or a helper). Include as "Authorization: Bearer <token>" header.
- Do NOT change layout or visual design from the locked preview — only replace
  mock data with real fetch calls (plus the loading/error states around them).
`;

export function buildAgentPrompt(mode: "preview" | "integrate"): string {
  const addendum = mode === "preview" ? AANYA_PREVIEW_ADDENDUM : AANYA_INTEGRATE_ADDENDUM;
  return AANYA_SHARED_PROMPT_BASE + addendum;
}

// Renames each endpoint's `path` field to `route` for the PROMPT TEXT ONLY —
// found via stress-test 1 (F7): a mid-tier model (kimi-k2.6) repeatedly
// wrote several genuinely different files all to write_file's path
// parameter set to a literal endpoint route like "/api/v1/notes", clobbering
// each write. Root cause: RestEndpoint.path (a backend ROUTE, e.g.
// "/api/v1/notes") and write_file's `path` parameter (a frontend FILE path,
// e.g. "app/notes/page.tsx") share the exact same key name "path" in the
// same prompt context, and the model conflated them. This does not touch
// RestEndpoint/BuildPlan itself — only how the contract is rendered into
// Aanya's prompt.
function renderApiContractForPrompt(apiContract: BuildPlan["apiContract"]): string {
  const renamed = {
    baseUrl: apiContract.baseUrl,
    endpoints: apiContract.endpoints.map(({ path, ...rest }) => ({ route: path, ...rest })),
  };
  return JSON.stringify(renamed, null, 2);
}

// 2026-08-04 (live, verify4617991): the prompt below tells the model "Every
// page must show real content from the project spec" — but the spec was never
// in the message. This renders the locked spec's features/user stories so that
// instruction refers to something the model can actually read. Exported for
// direct unit testing (index.test.ts) without a live LLM call.
export function formatFeaturesForPrompt(features: BuildPlan["features"]): string {
  if (!features || features.length === 0) return "";
  const blocks = features.map((f) => {
    const stories = (f.userStories ?? []).map((s) => `    - ${s}`).join("\n");
    return `- ${f.name}: ${f.description}${stories ? `\n  User stories:\n${stories}` : ""}`;
  });
  return `LOCKED SPEC — THE REQUIREMENTS YOU MUST SATISFY (this is "the project spec"):
Every feature below was explicitly requested. Build ALL of it. When a feature
names specific items (services, sections, fields), every single named item must
appear in the UI — a page that shows 4 of 9 named services is INCOMPLETE and
will be rejected.
${blocks.join("\n")}
`;
}

export function buildAgentTask(plan: BuildPlan, mode: "preview" | "integrate"): string {
  const backendUrl = plan.apiContract.baseUrl ?? "http://localhost:3001";
  const contractJson = renderApiContractForPrompt(plan.apiContract);

  const goal = mode === "preview"
    ? "Build a complete Next.js 16.2 frontend PREVIEW (mock data only, no backend calls yet) for this project."
    : "Wire the already-built and approved Next.js 16.2 frontend preview to the real backend API for this project.";

  const apiSection = mode === "preview"
    ? `BACKEND API CONTRACT (reference only — NOT running yet, do NOT call it; use it to shape your mock data):
${contractJson}`
    : `BACKEND API (running at ${backendUrl}):
${contractJson}`;

  const taskDetails = (plan.aanyaTasks || []).map((t, idx) => {
    return `Task ${idx + 1}: ${t.description}\nFiles to write:\n${t.outputFiles.map(f => `- ${f}`).join("\n")}`;
  }).join("\n\n");

  return `${goal}

PROJECT: ${plan.appName ?? "web app"}
DESCRIPTION: ${plan.appDescription ?? ""}

IMPORTANT — do not confuse these two unrelated things:
- Each endpoint's "route" below (e.g. "/api/v1/notes") is a BACKEND API ROUTE. It is reference-only context — never pass it as write_file's "path" argument.
- write_file's "path" argument is always a FRONTEND FILE PATH relative to the project root (e.g. "app/notes/page.tsx", "app/dashboard/page.tsx"). Every write_file call must use a distinct file path — never reuse the same path for two different pieces of content.

${apiSection}

SHARED TYPES (use these exact field names in your TypeScript interfaces):
${plan.sharedTypes ?? ""}

QUALITY BAR — INVESTOR DEMO TIER (read before writing any component):
This is NOT a tutorial or basic CRUD app. The quality bar is Tier 3-4:
  a Stripe landing page, a Linear dashboard, a Vercel analytics panel.
Do NOT produce: purple gradients on white cards, generic hero sections, stock shadcn layouts.
DO produce: a distinct visual identity — consistent dark theme using NexUI's void palette,
  a brand color hierarchy (primary action, secondary text, muted borders), deliberate
  typography scale, cards with real content and purposeful spacing.

${formatDesignBriefForPrompt(plan.designBrief)}

${formatFeaturesForPrompt(plan.features)}
CONTENT RULE — NO PLACEHOLDER TEXT:
Every page must show real content from the LOCKED SPEC above, NOT "Lorem ipsum" or "Coming soon".
User-facing copy must match what this specific app actually does.

USER FLOW:
A user signs up → logs in → sees a dashboard with real metrics/content → uses the core features
→ can manage their account. All transitions are smooth with Spinner during loading states.

PLANNED FRONTEND FILES AND PAGES (you MUST implement these pages and files as planned):
${taskDetails}

Start with list_files to see the scaffold, then write pages and components.`;
}

// ── Static scaffold ───────────────────────────────────────────────────────────
// Found live during the Phase B stress-test gate: this previously read
// process.env.CLERK_PUBLISHABLE_KEY, but the real env var (see .env.example)
// is NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — the mismatch meant every generated
// preview build shipped an empty publishable key, crashing Next.js's static
// prerendering of /_not-found with "Missing publishableKey". Extracted as
// its own function (rather than inline in writeStaticScaffold's template
// string) so the env-var name is directly unit-testable.
// 2026-07-26 (agent-autonomy-assessment follow-on): was
// `process.env.JWT_SECRET || "default_dev_secret"` — a fixed, predictable
// fallback baked into every generated app whenever the env var was unset.
// Riya's deploy-time write (agents/riya/src/index.ts) always overwrites
// this file with a real generated secret before the app starts and is the
// authoritative source; this scaffold-time placeholder just must never be
// a fixed string either, in case anything reads it before Riya runs.
export function buildCustomEnvLocal(backendPort: string): string {
  const placeholder = process.env.JWT_SECRET || randomBytes(32).toString("hex");
  return `NEXT_PUBLIC_API_URL=http://localhost:${backendPort}
JWT_SECRET=${placeholder}
`;
}

// Diagnosis 2026-07-04 (stress2/stress3 forensics): "vendor" MUST be in
// exclude — the vendored NexUI source is not held to the generated project's
// React 19 typecheck (it ships its own dist), and letting Next compile it
// cost every run 10-20 iterations of mystery build errors until a model
// rediscovered this exclusion. Exported for direct unit testing.
export function buildScaffoldTsconfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2017", lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true, skipLibCheck: true, strict: true,
      noEmit: true, esModuleInterop: true, module: "esnext",
      moduleResolution: "bundler", resolveJsonModule: true,
      isolatedModules: true, jsx: "preserve", incremental: true,
      plugins: [{ name: "next" }],
      paths: { "@/*": ["./*"] },
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules", "vendor"],
  }, null, 2);
}

// Same forensics: experimental.serverComponentsExternalPackages was renamed
// upstream in Next 15 and is invalid on the mandated Next 16.2 — Claude
// deleted it in both stress2 and stress3 (the identical edit each run).
// Ship the config without it. Exported for direct unit testing.
export function buildScaffoldNextConfig(): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@yugnex/nexui-react", "@yugnex/nexui"],
};

export default nextConfig;
`;
}

function writeStaticScaffold(plan: BuildPlan, outputDir: string): void {
  const backendPort = plan.apiContract.baseUrl?.match(/:(\d+)/)?.[1] ?? "3001";

  const files: Array<{ path: string; content: string }> = [
    {
      path: "package.json",
      content: JSON.stringify({
        name: `${plan.projectId}-frontend`,
        version: "1.0.0",
        private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: {
          next: "^16.2.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "@yugnex/nexui": "file:./vendor/nexui",
          "@yugnex/nexui-react": "file:./vendor/nexui-react",
        },
        devDependencies: {
          typescript: "^5.7.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@types/node": "^22.0.0",
        },
        // E2 (full-system audit): defense-in-depth alongside E1's
        // devDependency-stripping in vendorNexui() — forces a single
        // resolved version of react/react-dom/@types even if some future
        // vendored or third-party dependency's own manifest requests a
        // different one. Belt-and-suspenders, not a substitute for E1.
        overrides: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
        },
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: buildScaffoldTsconfig(),
    },
    {
      path: "next.config.ts",
      content: buildScaffoldNextConfig(),
    },
    {
      // 2026-07-28: real bug found live — every generated app used NexUI's
      // ONE fixed dark palette + hardcoded Inter font with zero per-project
      // variation, even though Vanya's real designBrief (palette/typeface/
      // mood) was already computed and available on `plan` — it was just
      // never read. buildThemeOverrideCss derives real CSS custom-property
      // overrides from it; @importing this AFTER NexUI's own tokens (below)
      // lets the project's actual colors/fonts win the cascade for those
      // specific variables, no vendored file needs touching.
      path: "app/theme-overrides.css",
      content: buildThemeOverrideCss(plan.designBrief),
    },
    {
      path: "app/globals.css",
      content: `@import "@yugnex/nexui/css/nexui-tokens.css";
@import "@yugnex/nexui/css/nexui-base.css";
@import "./theme-overrides.css";

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: var(--nx-ff-sans);
  font-size: var(--nx-fs-base);
  color: var(--nx-text);
  background: var(--nx-bg-base);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  min-height: 100vh;
  background: var(--nx-bg-base);
  color: var(--nx-text);
}

a {
  color: var(--nx-accent-text);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
`,
    },
    {
      path: "app/layout.tsx",
      // 2026-08-06: real bug found live (confirmed on two separate deployed
      // builds via getComputedStyle) — theme-overrides.css's colors were
      // correct in source but NEVER actually rendered. Root cause:
      // NexuiProvider's initializeNexuiEngine injects the "void" preset's
      // OWN <style> tag into document.head at runtime (client-side, after
      // hydration) — which always lands later in the DOM than this file's
      // statically-imported theme-overrides.css and wins the cascade
      // regardless of import order. customTokens bakes this SAME project's
      // colors/fonts into that runtime injection instead, so it can't lose
      // that fight. theme-overrides.css is kept (still imported via
      // globals.css above) only as a pre-hydration first-paint
      // approximation — customTokens is the one guaranteed to actually win.
      content: `import type { ReactNode } from "react";
import { NexuiProvider } from "@yugnex/nexui-react";
import "./globals.css";

export const metadata = {
  title: "${plan.appName ?? "App"}",
  description: "${plan.appDescription ?? ""}",
};

const nexuiCustomTokens = ${JSON.stringify(buildThemeOverrideTokens(plan.designBrief), null, 2)};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NexuiProvider theme="void" customTokens={nexuiCustomTokens}>
          {children}
        </NexuiProvider>
      </body>
    </html>
  );
}
`,
    },
    {
      // Next.js 16.2 auth middleware is proxy.ts, not middleware.ts
      path: "proxy.ts",
      content: `import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPaths = ["/sign-in", "/sign-up"];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path.startsWith(p));
  const token = request.cookies.get("token")?.value;

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|[^?]*\\.(?:css|js|png|jpg|svg|ico|webp|woff2?)).*)",
    "/(api|trpc)(.*)",
  ],
};
`,
    },
    {
      path: ".env.local",
      content: buildCustomEnvLocal(backendPort),
    },
  ];

  for (const { path: relPath, content } of files) {
    const parts = relPath.split("/");
    if (parts.length > 1) {
      mkdirSync(join(outputDir, ...parts.slice(0, -1)), { recursive: true });
    }
    writeFileSync(join(outputDir, relPath), content, "utf-8");
  }
}
