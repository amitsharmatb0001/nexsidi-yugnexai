// Aanya — Next.js 16.2 frontend generator (real agentic mode)
// Uses tool-calling loop: write_file → run npm install → run next build → fix → repeat.
// UI: @yugnex/nexui-react (NexSidi's own library) — NO Tailwind, NO shadcn/ui.

import { runAgent } from "@nexsidi/agent-runtime";
import { mkdirSync, writeFileSync, cpSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { BuildPlan } from "../../../arjun/src/index.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", projectId, "frontend");
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
  const result = await runAgent({
    agentName: "aanya",
    model: "moonshotai/kimi-k2.6",
    apiKey,
    systemPrompt: buildAgentPrompt(mode),
    initialMessage: buildAgentTask(plan, mode),
    sandboxDir: outputDir,
    enableHttpTools: false,
  });

  return {
    success: result.success,
    projectId: plan.projectId,
    outputDir,
    filesWritten: result.filesWritten,
    errors: result.errors,
  };
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
  }
  if (existsSync(nexuiReactSrc)) {
    cpSync(nexuiReactSrc, join(vendorDir, "nexui-react"), { recursive: true,
      filter: (src) => !src.includes("node_modules") });
  }
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
1. Use list_files to understand the scaffold already present
2. Use write_file to create all app pages, components, hooks, and utilities
3. Use run_command "npm install" (runs in project root)
4. Use run_command "npx next build" to verify the build passes
5. If build fails: use read_file to see the error, use write_file to fix it, rebuild
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

NEXUI COMPONENT USAGE:
  import { Button, Panel, Card, CardHeader, CardBody, Badge, Input, Checkbox, Spinner } from "@yugnex/nexui-react";

  <Panel variant="surface" padding="md">...</Panel>        // container with surface bg
  <Panel variant="elevated" padding="lg">...</Panel>       // elevated card
  <Button variant="primary" size="md">Click</Button>       // primary CTA
  <Button variant="ghost" size="sm">Cancel</Button>        // ghost button
  <Input label="Title" placeholder="Enter..." value={v} onChange={e => set(e.target.value)} />
  <Badge variant="success">Done</Badge>                    // success badge
  <Badge variant="warning">Pending</Badge>                 // pending badge
  <Checkbox checked={done} label="Complete" onChange={setDone} />
  <Spinner size="md" color="accent" />                     // loading spinner
  <Card><CardHeader>Title</CardHeader><CardBody>Body</CardBody></Card>

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

function buildAgentTask(plan: BuildPlan, mode: "preview" | "integrate"): string {
  const backendUrl = plan.apiContract.baseUrl ?? "http://localhost:3001";

  const goal = mode === "preview"
    ? "Build a complete Next.js 16.2 frontend PREVIEW (mock data only, no backend calls yet) for this project."
    : "Wire the already-built and approved Next.js 16.2 frontend preview to the real backend API for this project.";

  const apiSection = mode === "preview"
    ? `BACKEND API CONTRACT (reference only — NOT running yet, do NOT call it; use it to shape your mock data):
${JSON.stringify(plan.apiContract, null, 2)}`
    : `BACKEND API (running at ${backendUrl}):
${JSON.stringify(plan.apiContract, null, 2)}`;

  return `${goal}

PROJECT: ${plan.appName ?? "web app"}
DESCRIPTION: ${plan.appDescription ?? ""}

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
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify({
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
        exclude: ["node_modules"],
      }, null, 2),
    },
    {
      path: "next.config.ts",
      content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@yugnex/nexui-react", "@yugnex/nexui"],
  experimental: { serverComponentsExternalPackages: [] },
};

export default nextConfig;
`,
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
      content: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${process.env.CLERK_PUBLISHABLE_KEY ?? ""}
CLERK_SECRET_KEY=${process.env.CLERK_SECRET_KEY ?? ""}
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
NEXT_PUBLIC_API_URL=http://localhost:${backendPort}
`,
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
