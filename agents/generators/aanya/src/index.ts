// Aanya — Next.js 16.2 frontend generator
// Produces a complete Next.js 16.2 + TypeScript + Tailwind + shadcn/ui frontend.
// Uses DeepSeek V4-Pro via NIM.
// D: uses Next.js 16.2 (NOT 14 which is EOL, NOT 15)

import { agentChat } from "@nexsidi/llm-client";
import { mkdirSync, writeFileSync, appendFileSync } from "fs";
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

  // Static files ALWAYS overwrite LLM output — auth wiring, middleware, and layout are static.
  for (const { path: relPath, content } of buildStaticFiles(plan)) {
    const absPath = join(outputDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    if (!filesWritten.includes(relPath)) filesWritten.push(relPath);
  }

  return { success: errors.length === 0, projectId: plan.projectId, outputDir, filesWritten, errors };
}

// Detect model refusals (content-policy rejections that look like success responses)
function isRefusal(text: string): boolean {
  const t = text.trim().slice(0, 120).toLowerCase();
  return t.startsWith("i'm sorry") || t.startsWith("i am sorry") ||
    t.startsWith("i can't") || t.startsWith("i cannot") ||
    t.startsWith("as an ai language model") || t.startsWith("i apologize");
}

async function generateTask(
  plan: BuildPlan,
  task: GeneratorTask,
  apiKey: string,
): Promise<Array<{ path: string; content: string }>> {
  // Code generation tasks need high token budget — components routinely exceed 4096 tokens.
  const { content } = await agentChat(
    "aanya",
    [
      { role: "system", content: AANYA_SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(plan, task) },
    ],
    apiKey,
    { maxTokens: 16384 },
  );

  // If model refused, throw so the Temporal retry picks up the updated fallback chain
  if (isRefusal(content)) {
    throw new Error(`Model refused task "${task.description}" — retrying with next model in chain`);
  }

  try {
    return parseFileOutput(content);
  } catch {
    // Log raw output for debugging then retry with an explicit reminder
    const debugPath = join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", plan.projectId, `debug-aanya-${Date.now()}.txt`);
    mkdirSync(dirname(debugPath), { recursive: true });
    writeFileSync(debugPath, `TASK: ${task.description}\n\nRAW OUTPUT:\n${content}`, "utf-8");

    // Retry once with a correction follow-up
    const { content: fixed } = await agentChat(
      "aanya",
      [
        { role: "system", content: AANYA_SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(plan, task) },
        { role: "assistant", content: content },
        {
          role: "user",
          content: `Your response was not in the required format. You MUST use ===FILE: path=== ... ===ENDFILE=== delimiters.\n` +
            `FILES TO PRODUCE: ${task.outputFiles.join(", ")}\n` +
            `Rewrite your response now using ONLY ===FILE: path=== blocks. No prose, no markdown, no JSON.`,
        },
      ],
      apiKey,
      { maxTokens: 16384 },
    );
    if (isRefusal(fixed)) {
      throw new Error(`Model refused correction for task "${task.description}"`);
    }
    return parseFileOutput(fixed);
  }
}

function buildPrompt(plan: BuildPlan, task: GeneratorTask): string {
  const backendUrl = plan.apiContract.baseUrl;
  return `TASK: ${task.description}
FILES TO PRODUCE: ${task.outputFiles.join(", ")}

=== SHARED TYPES (use these — do not redefine) ===
${plan.sharedTypes}

=== API CONTRACT (backend is at ${backendUrl}) ===
${JSON.stringify(plan.apiContract, null, 2)}

Generate COMPLETE, working Next.js 16.2 code. Every function must be fully implemented.
Tailwind classes only — no inline styles, no CSS modules.
shadcn/ui components where appropriate (Button, Input, Card, Dialog, etc.).
REQUIRED output format (no JSON, no markdown):
===FILE: app/page.tsx===
<complete content>
===ENDFILE===
Repeat for every file. No JSON. Only ===FILE: path=== blocks.`;
}

// ── Static config files ───────────────────────────────────────────────────────
// These ALWAYS overwrite LLM output — auth wiring, middleware, and layout are never LLM-generated.
function buildStaticFiles(plan: BuildPlan): Array<{ path: string; content: string }> {
  const apiUrl = plan.apiContract.baseUrl ?? "http://localhost:3001";
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: `project-${plan.projectId}-frontend`,
          version: "1.0.0",
          private: true,
          scripts: { dev: "next dev", build: "next build --turbopack", start: "next start" },
          dependencies: {
            "next":                     "16.2.0",
            "react":                    "^19.0.0",
            "react-dom":                "^19.0.0",
            "@clerk/nextjs":            "^6.0.0",
            "class-variance-authority": "^0.7.0",
            "clsx":                     "^2.1.1",
            "lucide-react":             "^0.446.0",
            "tailwind-merge":           "^2.5.2",
            "tailwindcss-animate":      "^1.0.7",
            "@radix-ui/react-dialog":   "^1.1.1",
            "@radix-ui/react-label":    "^2.1.0",
            "@radix-ui/react-slot":     "^1.1.0",
            "@radix-ui/react-checkbox": "^1.1.1",
          },
          devDependencies: {
            typescript:          "^5.7.0",
            "@types/node":       "^22.0.0",
            "@types/react":      "^19.0.0",
            "@types/react-dom":  "^19.0.0",
            tailwindcss:         "^3.4.0",
            autoprefixer:        "^10.4.0",
            postcss:             "^8.4.0",
          },
        },
        null, 2,
      ),
    },
    {
      path: "next.config.ts",
      content: `import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
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
            allowJs: true, skipLibCheck: true, strict: false,
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
    // Single-stage Dockerfile — turbopack doesn't support standalone output mode.
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL=${apiUrl}
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_ENV=production
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
`,
    },
    // Clerk middleware — ALWAYS static, never LLM-generated.
    {
      path: "middleware.ts",
      content: `import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const publicPaths = ["/sign-in", "/sign-up"];

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path.startsWith(p));
  if (!userId && !isPublic) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next|favicon.ico|[^?]*\\.(?:css|js|png|jpg|svg|ico|webp|woff2?)).*)", "/(api|trpc)(.*)"],
};
`,
    },
    // Root page — always redirect based on auth state.
    {
      path: "app/page.tsx",
      content: `import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const { userId } = await auth();
  redirect(userId ? "/dashboard" : "/sign-in");
}
`,
    },
    // Clerk auth pages — always static.
    {
      path: "app/sign-in/[[...sign-in]]/page.tsx",
      content: `import { SignIn } from "@clerk/nextjs";
export default function SignInPage() {
  return <div className="min-h-screen flex items-center justify-center bg-gray-50"><SignIn /></div>;
}
`,
    },
    {
      path: "app/sign-up/[[...sign-up]]/page.tsx",
      content: `import { SignUp } from "@clerk/nextjs";
export default function SignUpPage() {
  return <div className="min-h-screen flex items-center justify-center bg-gray-50"><SignUp /></div>;
}
`,
    },
    // Shared types — canonical Task interface matching DB snake_case columns.
    {
      path: "shared/types.ts",
      content: `export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}
`,
    },
    // cn utility — always needed for shadcn/ui.
    {
      path: "lib/utils.ts",
      content: `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
`,
    },
  ];
}

// Strip markdown code fences that some models wrap around file content.
function stripFences(s: string): string {
  return s.replace(/^```[^\n]*\n/, "").replace(/\n```\s*$/, "");
}

// ── Parse {"files":[...]} output ─────────────────────────────────────────────
// Primary: ===FILE: path=== ... ===ENDFILE=== delimiter format (no JSON escaping needed).
// JSON fallback handles models that still output the old format.
function parseFileOutput(text: string): Array<{ path: string; content: string }> {
  // Primary: ===FILE: path=== or === FILE: path === (with optional spaces inside ===)
  const delimitedBlocks = [...text.matchAll(/={3}\s*FILE:\s*([^\n=][^\n]*?)\s*={3}\s*\n([\s\S]*?)={3}\s*ENDFILE\s*={3}/g)];
  if (delimitedBlocks.length > 0) {
    return delimitedBlocks.map((m) => ({ path: m[1]!.trim(), content: stripFences(m[2] ?? "") }));
  }

  // Secondary: <<<FILE: path>>> ... <<<END>>> (old fence format)
  const fenceBlocks = [...text.matchAll(/<<<FILE:\s*([^\n>]+)>>>\s*([\s\S]*?)<<<END>>>/g)];
  if (fenceBlocks.length > 0) return fenceBlocks.map((m) => ({ path: m[1]!.trim(), content: stripFences(m[2] ?? "") }));

  // Tertiary: JSON (strip markdown fence, then sanitize and parse)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = fenceMatch?.[1] ?? (() => {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    return s !== -1 && e > s ? text.slice(s, e + 1) : text;
  })();
  try {
    const p = JSON.parse(raw) as { files?: Array<{ path: string; content: string }> };
    if (Array.isArray(p.files)) return p.files.filter((f) => f.path && typeof f.content === "string");
  } catch { /* fall through */ }
  try {
    const p = JSON.parse(sanitizeJsonStrings(raw)) as { files?: Array<{ path: string; content: string }> };
    if (Array.isArray(p.files)) return p.files.filter((f) => f.path && typeof f.content === "string");
  } catch { /* fall through */ }

  throw new Error("LLM output did not match any parseable format (===FILE===, <<<FILE>>>, or JSON)");
}

function sanitizeJsonStrings(json: string): string {
  let inString = false;
  let result = "";
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (inString) {
      if (ch === "\\") {
        const next = json[i + 1];
        if (next === "\n" || next === "\r") {
          result += "\\n";
          if (next === "\r" && json[i + 2] === "\n") i++;
          i++;
          continue;
        }
        result += ch + (next ?? "");
        i++;
        continue;
      }
      if (ch === '"') { inString = false; result += ch; continue; }
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      result += ch;
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
  }
  return result;
}

export function getOutputDir(projectId: string): string {
  return join(process.env.BUILD_DIR ?? "/tmp/nexsidi-builds", projectId, "frontend");
}

// ── System prompt ─────────────────────────────────────────────────────────────
const AANYA_SYSTEM_PROMPT = `\
You are a senior Next.js 16.2 + TypeScript + Tailwind CSS + shadcn/ui frontend engineer.
Generate COMPLETE, fully working code. No TODOs, no placeholder comments, no incomplete functions.

Stack (non-negotiable):
- Next.js 16.2 App Router (NOT Pages Router)
- TypeScript strict mode
- Tailwind CSS utility classes — no inline styles, no CSS modules
- shadcn/ui components (import from "@/components/ui/...")
- Clerk for auth: ClerkProvider in layout, useUser/useAuth in client components
- Data fetching: fetch() in Server Components, useState/useEffect in Client Components

STATIC FILES — DO NOT GENERATE (they are pre-written and will overwrite yours):
  middleware.ts, app/page.tsx, app/sign-in/[[...sign-in]]/page.tsx, app/sign-up/[[...sign-up]]/page.tsx,
  shared/types.ts, lib/utils.ts, next.config.ts, Dockerfile, package.json, tsconfig.json

Clerk patterns — READ CAREFULLY:
  // EVERY file with hooks MUST start with: "use client"
  // Layout: wrap root with <ClerkProvider> — import from "@clerk/nextjs"
  // Client hooks: const { getToken, isLoaded } = useAuth(); const { user } = useUser();
  // Server components: import { auth } from "@clerk/nextjs/server"; const { userId } = await auth();
  // Types: use shared/types.ts — import { Task } from "@/shared/types"

API calls from client components — EXACT PATTERN (no exceptions):
  const { getToken } = useAuth();
  const token = await getToken();  // ALWAYS use getToken() — NEVER use privateMetadata
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(apiUrl + "/api/v1/tasks", {
    method: "GET",
    headers: { Authorization: "Bearer " + token },
  });
  // GET requests: NEVER include a body — put filters in URL query params
  // e.g. apiUrl + "/api/v1/tasks?status=pending&page=1&perPage=20"

UI quality rules (D18 live eval criteria):
- Design must feel like a coherent whole — not AI slop (no purple gradients over white cards)
- Custom color palette, purposeful typography hierarchy, consistent spacing
- Functional AND beautiful — users can understand what to do without guessing
- Dark mode support via Tailwind dark: classes

REQUIRED output format — use this EXACTLY, no JSON, no markdown:
===FILE: app/page.tsx===
<complete content>
===ENDFILE===
Repeat for every file. No JSON. No markdown. Only ===FILE: path=== blocks.
Every file must be 100% complete. No shortcuts.
`;
