// Aanya — Next.js 16.2 frontend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run next build → fix → repeat.
// UI: @yugnex/nexui-react (NexSidi's own library) — NO Tailwind, NO shadcn/ui.

import { resolveGeneratorRunner } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { BuildPlan } from "../../../arjun/src/index.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", projectId, "frontend");
}

// 2026-07-08: see agents/generators/shubham/src/index.ts's identical helper
// for the full rationale (Patent Claim 2's instinct memory finally wired
// up, read side). Fails safe: memory is an enrichment, not a hard
// dependency.
async function loadKnownMistakesPrefix(): Promise<string> {
  try {
    const { queryRecentInstincts, formatInstinctsForPrompt } = await import("@nexsidi/db");
    const instincts = await queryRecentInstincts("security");
    const formatted = formatInstinctsForPrompt(instincts);
    return formatted ? `${formatted}\n\n` : "";
  } catch {
    return "";
  }
}

// Location of the built nexui packages on this machine (dist output, ready to vendor)
const NEXUI_PUBLISH_DIR = resolve(process.env.NEXUI_DIR ?? join(process.cwd(), "nexui-publish"));

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
    // qwen3.5-122b: confirmed working under 80K+ token inputs in stress-3's
    // QA fallbacks — a genuinely different architecture for the second try.
    fallbackModels: ["qwen/qwen3.5-122b-a10b"],
    apiKey,
    systemPrompt: knownMistakesPrefix + buildAgentPrompt(mode),
    initialMessage: buildAgentTask(plan, mode),
    sandboxDir: outputDir,
    projectId: plan.projectId,
    // 2026-07-12: Aanya stays on the CHEAP flash model (default GEMINI_MODEL),
    // NOT pro. Rationale (CLAUDE.md's parallel-agent rule): Shubham and Aanya
    // run in PARALLEL — putting both on gemini-3.1-pro-preview would collide on
    // pro's rate limit. Pro goes to the backend (Shubham: SQL/security/logic,
    // where quality matters most); frontend is adequate on flash and this
    // spreads the parallel load across both models to avoid 429s. http tools so
    // Aanya still self-verifies (npm install + next build + typecheck). Live UI is Tier 3.
    enableHttpTools: true,
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
export function buildFixTask(findings: string[]): string {
  return `An adversarial QA review found the following issues in the frontend code you already wrote. Fix ONLY these specific issues — do not rewrite unrelated files, do not change layout or visual design that wasn't flagged.

ISSUES TO FIX:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Workflow:
1. Use read_file to see the exact current content of each affected file
2. Use edit_file for targeted fixes (cheaper than rewriting the whole file) — use write_file only if the fix genuinely requires touching most of the file
3. Run "npx next build" to verify nothing broke
4. Call task_complete with verification_passed: true only after verifying the fix actually addresses the issue`;
}

export async function runFix(plan: BuildPlan, findings: string[]): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId); // SAME dir run() wrote to — not regenerated

  const result = await resolveGeneratorRunner()({
    agentName: "aanya",
    model: "mistralai/mistral-medium-3.5-128b",
    fallbackModels: ["qwen/qwen3.5-122b-a10b"],
    apiKey,
    systemPrompt: buildAgentPrompt("integrate"), // fix always happens post-integrate, per Stage 5's placement after Stage 4
    initialMessage: buildFixTask(findings),
    sandboxDir: outputDir,
    projectId: plan.projectId,
    // flash (default) — see the rationale on Aanya's run() config above.
    enableHttpTools: true,
  });

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
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
function vendorNexui(outputDir: string): void {
  const vendorDir = join(outputDir, "vendor");
  mkdirSync(vendorDir, { recursive: true });

  const nexuiSrc = join(NEXUI_PUBLISH_DIR, "nexui");
  const nexuiReactSrc = join(NEXUI_PUBLISH_DIR, "nexui-react");

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
}

function stripVendoredPackageJsonDevDeps(packageJsonPath: string): void {
  if (!existsSync(packageJsonPath)) return;
  const content = readFileSync(packageJsonPath, "utf-8");
  writeFileSync(packageJsonPath, stripDevDependencies(content), "utf-8");
}

// ── Agent system prompt ───────────────────────────────────────────────────────
// Shared base (stack rules, NexUI usage, layout patterns, critical rules) is the
// same regardless of mode. Mode-specific addenda below tell Aanya whether this
// is a mock-data-only preview build (Stage 3, pre-approval) or a real-backend
// integration pass (post-approval, wiring the locked preview to live APIs).
const AANYA_SHARED_PROMPT_BASE = `\
You are Aanya, a senior Next.js 16.2 + TypeScript frontend engineer.
You have tools to write files and run commands. DO NOT output text — USE TOOLS.

Your workflow:
1. Use list_files ONCE (recursive) to understand the scaffold already present
2. Use write_file to create all app pages, components, hooks, and utilities
   — BATCH your work: emit SEVERAL write_file calls in the SAME response
   (3-4 files per turn). One file per turn wastes most of your iteration
   budget on round trips.
3. Use run_command "npm install" (runs in project root)
4. Use run_command "npx next build" to verify the build passes
5. If build fails: read the error, fix it (edit_file for small changes —
   cheaper than rewriting the whole file), rebuild
6. When build passes: call task_complete with verification_passed: true

STACK (non-negotiable):
- Next.js 16.2 / TypeScript / React 19
- UI: @yugnex/nexui-react — the NexSidi in-house UI library
  Components: Button, Panel, Card, Input, Badge, Checkbox, Spinner, Avatar, Separator,
              Modal, Tabs, Select, Tooltip, Toast, Switch, Progress, Skeleton
  Theme: NexuiProvider wraps the app in layout.tsx (already in scaffold)
  NEVER use Tailwind, shadcn/ui, @radix-ui, or any external UI library
  NEVER use @apply in CSS — use NexUI CSS variables or classnames from nexui-utils.css
- Auth: @clerk/nextjs — ClerkProvider wraps in layout.tsx (already in scaffold)
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
  // Page layout — use Panel and gap, not Tailwind grid classes
  <div style={{ minHeight: "100vh", background: "var(--nx-bg-base)" }}>
    <nav style={{ borderBottom: "1px solid var(--nx-border)", padding: "0 24px" }}>...</nav>
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {items.map(item => <Card key={item.id}>...</Card>)}
      </div>
    </main>
  </div>

STATIC FILES ALREADY WRITTEN (DO NOT rewrite unless you need to fix a bug):
- package.json (with @yugnex/nexui-react + @yugnex/nexui as file: deps)
- app/layout.tsx (NexuiProvider + ClerkProvider wrapper)
- app/globals.css (NexUI token imports, base reset — NO @apply Tailwind directives)
- proxy.ts (Clerk auth middleware for Next.js 16.2)
- next.config.ts
- tsconfig.json

FILES YOU MUST WRITE:
- app/page.tsx (landing / sign-in redirect)
- app/sign-in/[[...sign-in]]/page.tsx
- app/sign-up/[[...sign-up]]/page.tsx
- app/dashboard/page.tsx (main authenticated view)
- Any additional pages, components, hooks needed for the feature set

CRITICAL RULES:
1. NEVER use 'use client' on layout.tsx — it is a Server Component
2. Use 'use client' on any component that uses hooks (useState, useEffect, etc.)
3. API URL: const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
4. Auth token: const token = await getToken() from useAuth() hook
5. Error states: always show a readable error message in the UI
6. Loading states: use Spinner while fetching
7. Empty states: show a helpful message when the list is empty
8. NEVER create a middleware.ts file — Next.js 16.2 auth middleware is
   proxy.ts (already written, see above). Next.js rejects having both
   proxy.ts and middleware.ts present. If "npx next build" fails and you
   suspect a middleware conflict, use delete_file to remove any
   middleware.ts you may have created — do not try run_command('rm ...'),
   rm is not in the shell allowlist.

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
- API calls: fetch() with Bearer token from useAuth().getToken().
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

function buildAgentTask(plan: BuildPlan, mode: "preview" | "integrate"): string {
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

  return `${goal}

PROJECT: ${plan.appName ?? "web app"}
DESCRIPTION: ${plan.appDescription ?? ""}

IMPORTANT — do not confuse these two unrelated things:
- Each endpoint's "route" below (e.g. "/api/v1/notes") is a BACKEND API ROUTE. It is reference-only context — never pass it as write_file's "path" argument.
- write_file's "path" argument is always a FRONTEND FILE PATH relative to the project root (e.g. "app/notes/page.tsx", "app/dashboard/page.tsx"). Every write_file call must use a distinct file path — never reuse the same path for two different pieces of content.

${apiSection}

SHARED TYPES (use these exact field names in your TypeScript interfaces):
${plan.sharedTypes ?? ""}

USER STORY:
A user should be able to sign up, log in, and then use all the core features.
The app should look polished and professional using NexSidi UI components.
No AI-generated "purple gradients over white cards" — use the dark void theme.

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
export function buildClerkEnvLocal(backendPort: string): string {
  return `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""}
CLERK_SECRET_KEY=${process.env.CLERK_SECRET_KEY ?? ""}
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
NEXT_PUBLIC_API_URL=http://localhost:${backendPort}
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
          "@clerk/nextjs": "^6.21.0",
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
      path: "app/globals.css",
      content: `@import "@yugnex/nexui/css/nexui-tokens.css";
@import "@yugnex/nexui/css/nexui-base.css";

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
      content: `import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { NexuiProvider } from "@yugnex/nexui-react";
import "./globals.css";

export const metadata = {
  title: "${plan.appName ?? "App"}",
  description: "${plan.appDescription ?? ""}",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <NexuiProvider theme="void">
            {children}
          </NexuiProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
`,
    },
    {
      // Next.js 16.2 auth middleware is proxy.ts, not middleware.ts
      path: "proxy.ts",
      content: `import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const publicPaths = ["/sign-in", "/sign-up"];

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path.startsWith(p));
  if (!userId && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
});

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
      content: buildClerkEnvLocal(backendPort),
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
