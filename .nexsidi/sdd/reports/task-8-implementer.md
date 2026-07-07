# Task 8 Implementer Report

Status: DONE

## What I did

Refactored `agents/generators/aanya/src/index.ts`:

1. Renamed the old `AANYA_AGENT_SYSTEM_PROMPT` constant to `AANYA_SHARED_PROMPT_BASE` (private,
   unchanged in substance) and added an exported `buildAgentPrompt(mode: "preview" | "integrate"): string`
   that returns `AANYA_SHARED_PROMPT_BASE + addendum`, where the addendum is one of two new constants:

   - `AANYA_PREVIEW_ADDENDUM` (mode "preview"):
     ```
     MODE: PREVIEW ONLY (Stage 3 — UI-first design approval, no backend yet)
     - Use mock/placeholder data defined inline in each component (const arrays/objects
       at the top of the file, or a local mock-data module) — no fetch() calls anywhere.
     - Do NOT write hooks that call the backend (no useEffect fetching from an API,
       no API client, no SWR/react-query against a real endpoint).
     - Focus entirely on layout, visual hierarchy, and correct NexUI component usage.
     - This build will be shown to the user for design approval BEFORE any backend
       exists — there is no live API to call yet, so mock everything realistically
       using the shapes from SHARED TYPES / the API contract as a reference only.
     ```

   - `AANYA_INTEGRATE_ADDENDUM` (mode "integrate"):
     ```
     MODE: INTEGRATE (post-approval — wire the locked preview to the real backend)
     - Wire the already-approved UI (from the locked preview) to the real backend API.
     - API calls: fetch() with Bearer token from useAuth().getToken().
     - Do NOT change layout or visual design from the locked preview — only replace
       mock data with real fetch calls (plus the loading/error states around them).
     ```

2. Every existing rule/section of the shared prompt body (workflow steps, STACK rules, NEXUI
   COMPONENT USAGE, NEXUI CSS VARIABLES, LAYOUT PATTERNS, STATIC FILES ALREADY WRITTEN, FILES
   YOU MUST WRITE, CRITICAL RULES 1-7, VERIFICATION GATE) is preserved verbatim, with ONE
   necessary wording change: the STACK bullet
   `- API calls: fetch() with Bearer token from useAuth().getToken()`
   was reworded to
   `- API calls: see the MODE-specific instructions at the end of this prompt for whether to call the backend now or use mock data instead`.
   This was unavoidable: the literal phrase `Bearer token from useAuth().getToken()` must NOT
   appear in preview-mode output per the test contract, so the exact API-call instruction had to
   move out of the always-included shared base and into the integrate-only addendum (where it now
   lives verbatim). The rule's substance (auth-token-bearing fetch calls) is retained, just
   relocated to the mode where it actually applies. Noted under Concerns below.

3. `run()` now takes `(plan: BuildPlan, mode: "preview" | "integrate")` and calls
   `buildAgentPrompt(mode)` for `systemPrompt` and `buildAgentTask(plan, mode)` for
   `initialMessage`.

4. `buildAgentTask()` now also takes `mode` and adjusts wording so it no longer unconditionally
   asserts a backend is running:
   - preview: goal line says "Build a complete Next.js 16.2 frontend PREVIEW (mock data only, no
     backend calls yet)"; the API contract is presented as `BACKEND API CONTRACT (reference only —
     NOT running yet, do NOT call it; use it to shape your mock data)`.
   - integrate: goal line says "Wire the already-built and approved ... preview to the real backend
     API"; the API contract section is unchanged from before (`BACKEND API (running at ${backendUrl})`).

## Test output

Failing test (before refactor, confirming `buildAgentPrompt` didn't exist yet):
```
bun test v1.3.14 (0d9b296a)
agents\generators\aanya\src\index.test.ts:
# Unhandled error between tests
SyntaxError: Export named 'buildAgentPrompt' not found in module '...\agents\generators\aanya\src\index.ts'.
 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [103.00ms]
```

Passing test (after refactor):
```
bun test v1.3.14 (0d9b296a)
 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [72.00ms]
```

Typecheck (`agents/generators/aanya` package, via repo-root `node_modules/.bin/tsc --noEmit`):
Pre-existing errors unrelated to this change appear both before and after the refactor
(identical set, confirmed via `git stash`/`git stash pop` A-B comparison):
- `src/index.ts` / `../shubham/src/index.ts`: `Property 'appName'/'appDescription' does not
  exist on type 'BuildPlan'` (BuildPlan type doesn't declare these fields; pre-existing, not
  touched by this task).
- `../../../packages/agent-runtime/src/loop.ts`: `ToolResult` not assignable to
  `Record<string, unknown>` (×6).
- `../../../packages/agent-runtime/src/tools/command.ts`: `string | undefined` not assignable to
  `string` (×2).
No new type errors were introduced by this refactor. The only errors that changed between
before/after are exactly the `buildAgentPrompt` not-exported errors going away, as expected.

## Commit

a744b1b802543a13a284d1924146412a87cf20d4
"feat: add preview/integrate mode split to Aanya for Stage 3 UI-first flow"
(2 files changed: agents/generators/aanya/src/index.ts, agents/generators/aanya/src/index.test.ts)

## Concerns

1. **Shared-base wording change (borderline on the "do not remove any existing rule" constraint):**
   The task brief said to keep the entire existing shared prompt body unchanged, but the test
   contract requires the literal substring `Bearer token from useAuth().getToken()` to be absent
   from preview mode. Since that exact phrase originally lived in the always-included STACK
   section, I moved the specific auth-header instruction into the integrate addendum (verbatim)
   and replaced the STACK bullet with a pointer to "see the MODE-specific instructions." This is
   a reasonable, minimal resolution of a real conflict between the two instructions, but it is a
   textual change to the shared body, not a pure addition — flagging it explicitly per your
   ambiguity-resolution guidance.

2. **Existing call site not updated (explicitly out of scope per task brief):**
   `pipeline/activities/index.ts:73` calls `runAanyaAgent(getPlan(projectId))` with only one
   argument. Now that `run()` requires a second `mode` argument, this call site will fail
   TypeScript checking for the `pipeline` package (not caught by `agents/generators/aanya`'s
   scoped `typecheck`, which only includes its own `src/`). Per your instructions I did not touch
   this file — it's presumably addressed by whichever task wires Stage 3 (`stage3-ui-preview.ts`,
   referenced in the plan around Task 8's stress-test checkpoint) into the orchestrator, which
   will need to pass `"preview"` or `"integrate"` explicitly.

3. **Pre-existing, unrelated repo state:** `bun.lock` has an uncommitted modification (adding
   `@nexsidi/agent-runtime` as a workspace dependency somewhere) and a `.nexsidi/` directory is
   untracked — both predate this task's changes (confirmed via `git stash` before I started) and
   were left untouched, only used `.nexsidi/sdd/reports/` to write this report as instructed.
