// Aanya — Next.js 16.2 frontend generator
// Produces a complete Next.js 16.2 + TypeScript + Tailwind + shadcn/ui frontend.
// Uses DeepSeek V4-Pro via NIM.
// D: uses Next.js 16.2 (NOT 14 which is EOL, NOT 15)

import { agentChat } from "@nexsidi/llm-client";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { BuildPlan, GeneratorTask } from "../../../arjun/src/index.ts";
import type { GeneratorResult } from "../../shubham/src/index.ts";

// ── Main entry ────────────────────────────────────────────────────────────────
export async function run(plan: BuildPlan): Promise<GeneratorResult> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  const outputDir = getOutputDir(plan.projectId);
  const filesWritten: string[] = [];
  const errors: string[] = [];

  for (const task of plan.aanyaTasks) {
    try {
      const files = await generateTask(plan, task, apiKey);
      for (const { path: relPath, content } of files) {
        const absPath = join(outputDir, relPath);
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, content, "utf-8");
        filesWritten.push(relPath);
      }
    } catch (err) {
      errors.push(`task="${task.description}": ${String(err)}`);
    }
  }

  for (const { path: relPath, content } of buildStaticFiles(plan)) {
    if (!filesWritten.includes(relPath)) {
      const absPath = join(outputDir, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, "utf-8");
      filesWritten.push(relPath);
    }
  }

  return { success: errors.length === 0, projectId: plan.projectId, outputDir, filesWritten, errors };
}

async function generateTask(
  plan: BuildPlan,
  task: GeneratorTask,
  apiKey: string,
): Promise<Array<{ path: string; content: string }>> {
  const { content } = await agentChat(
    "aanya",
    [
      { role: "system", content: AANYA_SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(plan, task) },
    ],
    apiKey,
  );
  return parseFileOutput(content);
}

function buildPrompt(plan: BuildPlan, task: GeneratorTask): string {
  const backendUrl = plan.apiContract.baseUrl;
  return `TASK: ${task.description}
FILES TO PRODUCE: ${task.outputFiles.join(", ")}

=== SHARED TYPES (use these — do not redefine) ===
${plan.sharedTypes}

=== API CONTRACT (backend is at ${backendUrl}) ===
${JSON.stringify(plan.apiContract, null, 2)}

Generate COMPLETE, production-ready Next.js 16.2 code. Fully implemented UI with real data.
Tailwind classes only — no inline styles, no CSS modules.
shadcn/ui components where appropriate (Button, Input, Card, Dialog, etc.).
Output ONLY JSON: { "files": [{ "path": "...", "content": "..." }] }`;
}

// ── Static config files ───────────────────────────────────────────────────────
function buildStaticFiles(plan: BuildPlan): Array<{ path: string; content: string }> {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: `project-${plan.projectId}-frontend`,
          version: "1.0.0",
          private: true,
          scripts: { dev: "next dev", build: "next build", start: "next start" },
          dependencies: {
            "next":                  "16.2.0",
            "react":                 "^19.0.0",
            "react-dom":             "^19.0.0",
            "@clerk/nextjs":         "^6.0.0",
            "class-variance-authority": "^0.7.0",
            "clsx":                  "^2.1.1",
            "lucide-react":          "^0.446.0",
            "tailwind-merge":        "^2.5.2",
            "@radix-ui/react-dialog": "^1.1.1",
            "@radix-ui/react-label": "^2.1.0",
            "@radix-ui/react-slot":  "^1.1.0",
          },
          devDependencies: {
            typescript:      "^5.7.0",
            "@types/node":   "^22.0.0",
            "@types/react":  "^19.0.0",
            "@types/react-dom": "^19.0.0",
            tailwindcss:     "^3.4.0",
            autoprefixer:    "^10.4.0",
            postcss:         "^8.4.0",
          },
        },
        null, 2,
      ),
    },
    {
      path: "next.config.ts",
      content: `import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: "http://localhost:3001/api/v1/:path*" }];
  },
};
export default nextConfig;
`,
    },
    {
      path: "tailwind.config.ts",
      content: `import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { borderRadius: { lg: "0.5rem", md: "0.375rem", sm: "0.25rem" } } },
  plugins: [],
};
export default config;
`,
    },
    {
      path: "postcss.config.mjs",
      content: `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`,
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022", lib: ["dom", "dom.iterable", "ES2022"],
            allowJs: true, skipLibCheck: true, strict: true,
            noEmit: true, esModuleInterop: true, module: "esnext",
            moduleResolution: "bundler", resolveJsonModule: true,
            isolatedModules: true, jsx: "preserve", incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        },
        null, 2,
      ),
    },
    {
      path: ".env.example",
      content: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx\nCLERK_SECRET_KEY=sk_test_xxx\nNEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in\nNEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up\nNEXT_PUBLIC_API_URL=http://localhost:3001\n",
    },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
`,
    },
  ];
}

// ── Parse {"files":[...]} output ─────────────────────────────────────────────
function parseFileOutput(text: string): Array<{ path: string; content: string }> {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = fenceMatch?.[1] ?? (() => {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    return s !== -1 && e > s ? text.slice(s, e + 1) : text;
  })();
  const parsed = JSON.parse(jsonStr) as { files?: Array<{ path: string; content: string }> };
  if (!Array.isArray(parsed.files)) throw new Error("LLM output missing `files` array");
  return parsed.files.filter((f) => f.path && typeof f.content === "string");
}

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId, "frontend");
}

// ── System prompt ─────────────────────────────────────────────────────────────
const AANYA_SYSTEM_PROMPT = `\
You are a senior Next.js 16.2 + TypeScript + Tailwind CSS + shadcn/ui frontend engineer.
Generate COMPLETE, runnable, production-quality code. No TODOs, no placeholder comments.

Stack (non-negotiable):
- Next.js 16.2 App Router (NOT Pages Router)
- TypeScript strict mode
- Tailwind CSS utility classes — no inline styles, no CSS modules
- shadcn/ui components (import from "@/components/ui/...")
- Clerk for auth: ClerkProvider in layout, useUser/useAuth in client components
- Data fetching: fetch() in Server Components, useState/useEffect in Client Components

Clerk patterns:
  // Layout: <ClerkProvider><SignedIn>...</SignedIn><SignedOut>...</SignedOut></ClerkProvider>
  // Client: const { userId } = useAuth(); const { user } = useUser();
  // Server: import { auth } from "@clerk/nextjs/server"; const { userId } = await auth();
  // Redirect unauthenticated: import { redirect } from "next/navigation"; if (!userId) redirect("/sign-in");

API calls: fetch from NEXT_PUBLIC_API_URL env (e.g. http://localhost:3001).
Add Authorization header with Clerk token for protected endpoints.

UI quality rules (D18 live eval criteria):
- Design must feel like a coherent whole — not AI slop (no purple gradients over white cards)
- Custom color palette, purposeful typography hierarchy, consistent spacing
- Functional AND beautiful — users can understand what to do without guessing
- Dark mode support via Tailwind dark: classes

Output ONLY: { "files": [{ "path": "app/...", "content": "..." }] }
Every file must be 100% complete. No shortcuts.
`;
