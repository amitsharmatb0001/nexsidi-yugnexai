# NexSidi Production MVP Upgrade Plan
> **For agentic workers:** Use nexsidi-subagent-dev (preferred) to implement task-by-task.

**Goal:** Close the observation loop + migrate all UI to @yugnex/nexui-react, making NexSidi a production MVP.
**Architecture:** Two parallel tracks — Track A (UI migration) and Track B (pipeline fixes). B1 and B2 are the highest-ROI fixes; A runs in parallel.
**Tech Stack:** Bun + Hono (API), Next.js 16.2 + @yugnex/nexui-react (web), gemini-3.1-pro-preview / gemini-3.6-flash / gemini-2.5-flash-lite (model tiers)

## Global Constraints
- No new agents — 11 agents only (Tilotma, Saanvi, Arjun, Shubham, Aanya, Pranav, Aarav, Riya, Navya, Karan, Deepika)
- Every NexUI component file must start with `'use client'` (Web Components SSR rule)
- Import NexUI from: `@yugnex/nexui-react` (components) and `@yugnex/nexui` (CSS)
- Root CSS import: `import '@yugnex/nexui/nexui-utils.css'` in root layout
- No Tailwind, no shadcn/ui anywhere after migration
- Model routing must match the tier table in Task B1 exactly — no deviations
- Do NOT touch pipeline/workflows/project-build.ts compile-gate fix (already done this session)

---

## Track A — NexUI Migration

### Task A1: Install NexUI into apps/web

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/app/layout.tsx`
- Delete: `apps/web/tailwind.config.*`, `apps/web/postcss.config.*`
- Modify: `apps/web/next.config.ts`

- [ ] **Step 1: Install packages**
```bash
cd apps/web && bun add @yugnex/nexui @yugnex/nexui-react
bun remove tailwindcss @tailwindcss/forms autoprefixer postcss
```

- [ ] **Step 2: Verify no tailwind imports remain**
```bash
grep -r "tailwind\|@/shadcn\|from 'shadcn" apps/web/app apps/web/components --include="*.tsx" --include="*.ts"
```
Expected: zero results

- [ ] **Step 3: Update root layout**
Replace `apps/web/app/layout.tsx` with:
```tsx
'use client'
import '@yugnex/nexui/nexui-utils.css'
import { NexuiProvider, ToastProvider, Toaster } from '@yugnex/nexui-react'
import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <NexuiProvider theme="void">
          <ToastProvider>
            <Toaster />
            {children}
          </ToastProvider>
        </NexuiProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Delete Tailwind config files**
```bash
rm -f apps/web/tailwind.config.ts apps/web/tailwind.config.js apps/web/postcss.config.js apps/web/postcss.config.mjs
```

- [ ] **Step 5: Build check**
```bash
cd apps/web && bun run build
```
Expected: exits 0, no Tailwind-related errors

- [ ] **Step 6: Commit**
```bash
git add apps/web/package.json apps/web/app/layout.tsx
git commit -m "feat(web): install @yugnex/nexui-react, remove Tailwind"
```

---

### Task A2: Convert apps/web dashboard page to NexUI

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/app/build/[id]/page.tsx`

- [ ] **Step 1: Read both files to understand current structure**
Read `apps/web/app/dashboard/page.tsx` and `apps/web/app/build/[id]/page.tsx`

- [ ] **Step 2: Convert dashboard/page.tsx**
All files must start with `'use client'`. Replace any Tailwind `className` strings with `nx-` utility classes or NexUI components. Use:
- `Card` + `CardHeader` + `CardBody` for project cards
- `Badge variant="live"/"success"/"error"` for status
- `Button variant="primary"` for actions
- `Skeleton` for loading states
- `nx-grid-3 md:nx-grid-2 sm:nx-grid-1` for responsive card grid

- [ ] **Step 3: Convert build/[id]/page.tsx**
Replace build log display with `TextStream` component:
```tsx
'use client'
import { TextStream, type TextStreamHandle, StatusRing, Badge, Panel } from '@yugnex/nexui-react'
import { useRef, useEffect } from 'react'

const logRef = useRef<TextStreamHandle>(null)

// Push lines from WebSocket or SSE:
// logRef.current?.push(line)

<TextStream ref={logRef} maxRows={200} showNumbers={true} />
<StatusRing score={qaScore} label="QA" size={72} />
```

- [ ] **Step 4: Type check**
```bash
cd apps/web && bun run tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**
```bash
git add apps/web/app/dashboard/page.tsx apps/web/app/build/[id]/page.tsx
git commit -m "feat(web): convert dashboard and build views to NexUI"
```

---

### Task A3: Update Aanya's generator to use NexUI

**Files:**
- Modify: `agents/generators/aanya/src/index.ts`

- [ ] **Step 1: Read current file**
Read `agents/generators/aanya/src/index.ts` to find where the generation prompt is built.

- [ ] **Step 2: Replace Tailwind+shadcn instructions with NexUI**
Find the system prompt or generation instructions section. Replace any mention of Tailwind, shadcn/ui, or @radix-ui with:

```
UI LIBRARY: @yugnex/nexui-react v2.0.1 (MANDATORY — do not use Tailwind, shadcn/ui, or any other UI library)

SETUP (already done in layout.tsx — do NOT add again):
  import '@yugnex/nexui/nexui-utils.css'
  <NexuiProvider theme="void">

SSR RULE: Every file using a NexUI component MUST start with 'use client'

IMPORTS: import { Button, Input, Card, CardHeader, CardBody, CardFooter, Badge,
  Panel, Modal, Tabs, TabsList, TabsTrigger, TabsContent, Select, SelectItem,
  Separator, Avatar, Spinner, Skeleton, Progress, Switch, Checkbox, Tooltip,
  TextStream, StatusRing } from '@yugnex/nexui-react'

LAYOUT CLASSES (nx- prefix, from nexui-utils.css):
  nx-flex, nx-flex-col, nx-grid, nx-grid-1 through nx-grid-6
  nx-gap-sm, nx-gap-md, nx-gap-lg
  nx-p-sm, nx-p-md, nx-p-lg
  nx-items-center, nx-justify-between, nx-justify-center
  Responsive: sm:nx-grid-1  md:nx-grid-2  lg:nx-grid-3

COMPONENT API: See docs/nexui/api-reference.md for all prop types
```

- [ ] **Step 3: Update install instructions in generator**
Any `npm install` or `bun add` commands Aanya generates must include:
`bun add @yugnex/nexui @yugnex/nexui-react`
And must NOT include `tailwindcss`, `shadcn`, `@radix-ui/*`, `lucide-react`.

- [ ] **Step 4: Type check**
```bash
cd agents/generators/aanya && bun run tsc --noEmit
```

- [ ] **Step 5: Commit**
```bash
git add agents/generators/aanya/src/index.ts
git commit -m "feat(aanya): switch generation target from Tailwind+shadcn to NexUI"
```

---

### Task A4: Update CLAUDE.md tech stack entries

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update platform stack entry**
Change:
```
Frontend:      Next.js 16.2 + TypeScript + Tailwind + shadcn/ui
```
To:
```
Frontend:      Next.js 16.2 + TypeScript + @yugnex/nexui-react
               (own package — zero external UI dependencies)
               SSR rule: every NexUI component file must be 'use client'
```

- [ ] **Step 2: Update generated app stack entry**
Change:
```
Frontend:  Next.js 16.2 + TypeScript + Tailwind + shadcn/ui
```
To:
```
Frontend:  Next.js 16.2 + TypeScript + @yugnex/nexui-react
```

- [ ] **Step 3: Add NexUI reference pointer**
Under the tech stack section, add:
```
NexUI docs:    docs/nexui/api-reference.md (all component APIs with prop types)
```

- [ ] **Step 4: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: update tech stack — Tailwind+shadcn → @yugnex/nexui-react"
```

---

## Track B — Pipeline Fixes

### Task B1: Model tier routing + zero-wait 429 switching (HIGHEST ROI)

**Why first:** Currently 96% of all calls hit `gemini-3.5-flash` (one cheap model for everything). QA reviews run on a flash model. This single change improves output quality more than any other fix.

**Files:**
- Modify: `packages/llm-client/src/router.ts`
- Modify: `packages/llm-client/src/types.ts`
- Modify: `packages/agent-runtime/src/gemini-loop.ts`

**Three routing rules (exact):**

| Use case | Model | Thinking |
|---|---|---|
| QA review, code review, adversarial analysis | `gemini-3.1-pro-preview` | `thinking_level: "HIGH"` |
| Code generation (Shubham, Aanya, Pranav, Arjun) | `gemini-3.6-flash` | `thinking_level: "MEDIUM"` |
| User-facing yes/no, progress updates, status messages | `gemini-2.5-flash-lite` | `thinking_budget: 1024` |

**Zero-wait 429 pattern (exact):**
```typescript
// Pool order: gemini-3.1-pro-preview → gemini-3.6-flash → gemini-3.5-flash
// On 429: immediately switch to next model in pool — NO sleep, NO backoff
// On NIM timeout/404: immediately route to Gemini pool, no retry on NIM
```

- [ ] **Step 1: Read current router.ts and types.ts**
```bash
cat packages/llm-client/src/router.ts
cat packages/llm-client/src/types.ts
```

- [ ] **Step 2: Add model tier enum and pool to types.ts**
```typescript
export type ModelTier = 'qa-review' | 'generation' | 'user-message'

export const GEMINI_POOL: Record<ModelTier, string[]> = {
  'qa-review':    ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash'],
  'generation':   ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview'],
  'user-message': ['gemini-2.5-flash-lite', 'gemini-3.5-flash'],
}

export const THINKING_CONFIG: Record<ModelTier, object> = {
  'qa-review':    { thinking_level: 'HIGH' },
  'generation':   { thinking_level: 'MEDIUM' },
  'user-message': { thinking_budget: 1024 },
}
```

- [ ] **Step 3: Update router.ts — add tier routing + zero-wait pool switch**
```typescript
export async function routeWithFallback(
  tier: ModelTier,
  prompt: string,
  opts: CallOptions
): Promise<LLMResponse> {
  const pool = GEMINI_POOL[tier]
  const thinking = THINKING_CONFIG[tier]

  for (const model of pool) {
    try {
      return await callGemini(model, prompt, { ...opts, ...thinking })
    } catch (err: any) {
      // 429 → immediately try next model, no sleep
      if (err?.status === 429 || err?.code === 'RATE_LIMIT') continue
      // NIM errors → also fall through to next
      if (err?.code === 'ECONNREFUSED' || err?.status === 404 || err?.status === 408) continue
      throw err // non-rate-limit error: propagate
    }
  }
  throw new Error(`All models in pool exhausted for tier: ${tier}`)
}
```

- [ ] **Step 4: Run existing tests**
```bash
bun test packages/llm-client
```

- [ ] **Step 5: Commit**
```bash
git add packages/llm-client/src/router.ts packages/llm-client/src/types.ts
git commit -m "feat(llm-client): add tier routing + zero-wait 429 pool switching"
```

---

### Task B2: Fix thought signatures in gemini-loop.ts

**Why now:** Gemini 3.x requires thought signatures preserved across multi-step calls. Missing → 400 error. Fixes this before B1's model upgrade triggers it.

**Files:**
- Modify: `packages/agent-runtime/src/gemini-loop.ts`

- [ ] **Step 1: Read the file**
```bash
cat packages/agent-runtime/src/gemini-loop.ts
```
Find where conversation history is built and where model responses are stored.

- [ ] **Step 2: Preserve thought signatures in history**
When a model response contains a `thought` or thinking block, it must be passed back in the next turn's `contents` array verbatim. Add:

```typescript
// After receiving a response that contains thinking parts:
if (response.candidates?.[0]?.content?.parts) {
  for (const part of response.candidates[0].content.parts) {
    // Preserve thought parts (thoughtSignature) in history as-is
    // Do NOT strip or modify them — Gemini 3.x returns 400 if missing
    if ('thought' in part || 'thoughtSignature' in part) {
      history.push({ role: 'model', parts: [part] })
    }
  }
}
```

- [ ] **Step 3: Add compaction at 80% context**
Find where token count is tracked (or add it). Before each API call:
```typescript
const CONTEXT_LIMIT = 900_000 // 1M limit, compact at 90% = 900K
const COMPACT_AT = 720_000    // 80% — summarize history

if (estimatedTokens > COMPACT_AT) {
  history = await compactHistory(history)
}
```

Where `compactHistory` summarizes older messages into a single summary message, keeping the last 10 turns verbatim.

- [ ] **Step 4: Type check**
```bash
cd packages/agent-runtime && bun run tsc --noEmit
```

- [ ] **Step 5: Commit**
```bash
git add packages/agent-runtime/src/gemini-loop.ts
git commit -m "fix(gemini-loop): preserve thought signatures + add 80% compaction"
```

---

### Task B3: Replace fake QA with real adversarial agents

**Why:** Current QA prompt says "DO NOT flag missing implementations", scores CRIT×10 (should be ×20), gate at ≥70 (should be ≥85). QA is passing broken sites at 97-100.

**Files:**
- Modify: `pipeline/activities/index.ts` (lines ~437-480)
- Read: `agents/qa/navya/src/index.ts`, `agents/qa/karan/src/index.ts`, `agents/qa/deepika/src/index.ts`

- [ ] **Step 1: Read all four files**
```bash
cat pipeline/activities/index.ts
cat agents/qa/navya/src/index.ts
cat agents/qa/karan/src/index.ts
cat agents/qa/deepika/src/index.ts
```

- [ ] **Step 2: Replace the qaPrompt() function body**
Remove the "DO NOT flag missing implementations" instruction.
Change scoring: CRITICAL×20, HIGH×10, MEDIUM×5, LOW×1 (correct weights from spec).
Change prompt to: "You are an adversarial QA reviewer. Default assumption is FAIL. Only pass if evidence proves quality. Flag everything suspect."

- [ ] **Step 3: Update scoring in runStaticQA (or equivalent)**
```typescript
// OLD (wrong):
const penalty = critical * 10 + high * 5 + medium * 2
// NEW (correct per spec):
const penalty = critical * 20 + high * 10 + medium * 5 + low * 1
const score = Math.max(0, 100 - penalty)
```

- [ ] **Step 4: Update pass threshold in project-build.ts**
In `pipeline/workflows/project-build.ts` around line 164-166:
```typescript
// OLD:
const allPass = navyaScore >= 70 && karanScore >= 70 && deepikaScore >= 70
// NEW:
const allPass = navyaScore >= 85 && karanScore >= 85 && deepikaScore >= 85
```

- [ ] **Step 5: Wire agents/qa/* into Temporal activities**
In `pipeline/activities/index.ts`, import and call the real agent functions:
```typescript
import { runNavyaQA } from '../agents/qa/navya/src/index'
import { runKaranQA } from '../agents/qa/karan/src/index'
import { runDeepikaQA } from '../agents/qa/deepika/src/index'
```
Replace the inline prompt-based QA call with calls to these functions, passing the built files as input.

- [ ] **Step 6: Run tests**
```bash
bun test pipeline
```

- [ ] **Step 7: Commit**
```bash
git add pipeline/activities/index.ts pipeline/workflows/project-build.ts
git commit -m "fix(qa): replace anti-adversarial prompt with real QA agents, correct scoring weights + threshold"
```

---

### Task B4: Wire Tier-3 browser observation as delivery gate

**Why:** The system never looks at the actual rendered output. Tier-3 exists (328 LOC, has run in dev) but is never called in production. This is the single most important loop-closure fix.

**Files:**
- Read: `agents/tilotma/src/tier3-review.ts`
- Modify: `pipeline/workflows/project-build.ts`
- Modify: `pipeline/activities/index.ts`

- [ ] **Step 1: Read tier3-review.ts to understand its interface**
```bash
cat agents/tilotma/src/tier3-review.ts
```
Find the entry function signature and what it returns.

- [ ] **Step 2: Add a Temporal activity wrapping Tier-3**
In `pipeline/activities/index.ts`, add:
```typescript
export async function runTier3BrowserReview(input: {
  projectId: string
  appUrl: string  // e.g. http://localhost:3200
  spec: ProjectSpec
}): Promise<{ passed: boolean; score: number; findings: string[] }> {
  const { heartbeat } = Context.current()
  const interval = setInterval(() => heartbeat('tier3 running'), 30_000)
  try {
    // Call the existing tier3 review with includeTier3: true
    return await runTier3Review({ ...input, includeTier3: true })
  } finally {
    clearInterval(interval)
  }
}
```

- [ ] **Step 3: Call it from project-build.ts after Riya's deploy**
After the `await riyaDeploy(...)` call, add:
```typescript
const tier3 = await runTier3BrowserReview({
  projectId,
  appUrl: `http://localhost:${deployedPort}`,
  spec,
})
if (!tier3.passed || tier3.score < 7.0) {
  // Feed findings back into QA fix loop
  await triggerQAFix({ projectId, findings: tier3.findings, reason: 'tier3-browser-fail' })
}
```

- [ ] **Step 4: Type check**
```bash
bun run tsc --noEmit
```

- [ ] **Step 5: Commit**
```bash
git add pipeline/activities/index.ts pipeline/workflows/project-build.ts
git commit -m "feat(pipeline): wire Tier-3 browser review as delivery gate"
```

---

### Task B5: Kill stale-plan fast-path bypass

**Why:** When a stale `build-plan.json` exists from a previous run, the system skips Gate 1 (intake) and uses the old plan. This is how Vision/Mission pages got dropped — they were in the first request but not in the stale plan.

**Files:**
- Modify: `pipeline/activities/index.ts`

- [ ] **Step 1: Find checkBuildPlanExists**
```bash
grep -n "checkBuildPlanExists\|build-plan.json\|buildPlanExists" pipeline/activities/index.ts
```

- [ ] **Step 2: Delete the fast-path**
Remove or comment out the block that skips intake when a plan file exists. Every run must go through Saanvi's intake → user approval → locked spec.

- [ ] **Step 3: Verify intake is always called**
```bash
grep -n "saanvi\|runIntake\|lockSpec" pipeline/activities/index.ts pipeline/workflows/project-build.ts
```
Confirm saanvi/intake is called on every workflow execution.

- [ ] **Step 4: Commit**
```bash
git add pipeline/activities/index.ts
git commit -m "fix(pipeline): remove stale-plan bypass — every run goes through intake"
```

---

### Task B6: Delete debris

**Files:**
- Delete: `attempt_3.md`, `attempt_4.md`, `attempt_5.md`, `attempt_6.md`, `attempt_7.md`, `attempt_8.md`, `attempt_9.md`, `attempt_10.md`, `attempt_11.md`, `attempt_17.md`
- Delete: `brutal_onboarding_review.md`, `new_onboarding_review.md`, `approved_spec_vs_build_plan_audit.md`
- Review and clean: `packages/agent-runtime/automate-build.mjs`, `packages/agent-runtime/src/dump-html.cjs`, `packages/agent-runtime/src/screenshot-user-ap*`

- [ ] **Step 1: Verify these are not referenced anywhere**
```bash
grep -r "attempt_3\|attempt_4\|brutal_onboarding\|automate-build" --include="*.ts" --include="*.json" .
```
Expected: zero results

- [ ] **Step 2: Delete**
```bash
rm -f attempt_*.md brutal_onboarding_review.md new_onboarding_review.md approved_spec_vs_build_plan_audit.md
rm -f packages/agent-runtime/automate-build.mjs
rm -f packages/agent-runtime/src/dump-html.cjs
```

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "chore: delete 13 debris files (attempt logs, scratch scripts)"
```

---

## Execution Order

Run these in this sequence. B1 and B2 can start while A tasks are running — they touch different files.

```
A1 → A2 → A3 → A4      (UI migration — one team)
B1 → B2 → B3 → B4 → B5 → B6   (pipeline — another team or sequential)
```

## Definition of Done

- [ ] `bun run build` in apps/web exits 0 with no Tailwind/shadcn references
- [ ] `bun run tsc --noEmit` across all packages exits 0
- [ ] QA gate uses ×20 scoring, ≥85 threshold
- [ ] Tier-3 browser review is called before delivery
- [ ] Model tier routing is active (gemini-3.1-pro-preview for QA)
- [ ] No thought signature warnings in gemini-loop logs
- [ ] Stale plan bypass is removed
- [ ] Zero attempt_*.md files in repo root
