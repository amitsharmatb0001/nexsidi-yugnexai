# Task 8 Review

Verdict: NEEDS_FIXES

## Spec compliance

- `buildAgentPrompt(mode: "preview" | "integrate")` exists and is exported (`agents/generators/aanya/src/index.ts:183-186`). Matches the plan's declared interface exactly.
- `run(plan: BuildPlan, mode: "preview" | "integrate")` matches the plan's declared new signature (`agents/generators/aanya/src/index.ts:23`).
- Global constraint "still `@yugnex/nexui-react`, never Tailwind/shadcn" — untouched, verified by diff (no changes to that section besides the one `API calls:` line).
- Global constraint "don't remove any existing rule from the shared prompt body" — verified. See Findings below: confirmed byte-for-byte against the pre-diff prompt, nothing dropped except the one line that was intentionally replaced with a pointer to the mode addendum.
- No placeholders/TODOs — none found in the diff.
- Task 8's own file scope (per the plan: `agents/generators/aanya/src/index.ts` + its test only) is respected — no unrelated files touched in this diff.

## Test verification

Ran the specified test directly:
```
$ bun test agents/generators/aanya/src/index.test.ts
bun test v1.3.14 (0d9b296a)

 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [357.00ms]
```
Both tests pass as written.

## Findings

**1. (Blocking) `run()`'s new required `mode` parameter breaks two existing call sites in `pipeline/activities/index.ts`, and CI's typecheck job will fail.**

Grepped the codebase for other callers of Aanya's `run` (imported there as `runAanyaAgent`) and found two call sites still using the pre-diff one-argument form:

- `pipeline/activities/index.ts:73` — `const result = await runAanyaAgent(getPlan(projectId));` (inside `runAanya(projectId)`, the Temporal activity wired to Stage `generate` in `pipeline/workflows/project-build.ts:75`)
- `pipeline/activities/index.ts:359` — `runAanyaAgent(patchedPlan)` (inside the QA-fix-iteration retry path, run in parallel with `runShubhamAgent(patchedPlan)`)

`mode` has no default value and is not marked optional, so both calls now fail to typecheck. Confirmed directly:
```
$ cd pipeline && bunx tsc --noEmit
...
activities/index.ts(73,26): error TS2554: Expected 2 arguments, but got 1.
activities/index.ts(359,7): error TS2554: Expected 2 arguments, but got 1.
```
I verified these two errors are newly introduced by this diff and not pre-existing noise: I checked out the pre-diff version of `agents/generators/aanya/src/index.ts` (commit `1460f5b`, single-arg `run`) — that version cannot produce a "TS2554: Expected 2 arguments, but got 1" error against a 1-arg call site by construction, and the other errors present in both before/after runs (`appName`/`appDescription` missing on `BuildPlan`, `ToolResult` not assignable to `Record<string, unknown>` in `packages/agent-runtime/src/loop.ts`, `command.ts` spawn overload errors, `orchestrator.ts` `ModelId | undefined`) are pre-existing and unrelated to this diff — they reproduce identically with the old file in place.

CI (`.github/workflows/ci.yml` → `typecheck` job) runs `bun run typecheck`, which is `bun run --filter '*' typecheck` at the root, and `pipeline/package.json`'s `typecheck` script is a plain `tsc --noEmit` with no exclusions — so this will fail CI on the `pipeline` workspace as committed.

Note: the plan's Task 8 file scope is intentionally narrow (only `agents/generators/aanya/src/index.ts` + test), and Task 10 (orchestrator wiring, `pipeline/orchestrator/stages/stage3-ui-preview.ts`) is where the *new* preview-mode call site is meant to be added. But `pipeline/activities/index.ts` is pre-existing code with two call sites that are not part of Task 10's new file — they are the *old* Stage-4/retry wiring, and nothing in the plan reassigns fixing them to a later task. As committed, this task leaves the repo in a non-compiling state for the `pipeline` workspace, which is more than a documentation gap — it's a build break at `git log`-visible commit `a744b1b`, and it would fail CI if pushed. This needs a minimal fix now, e.g. passing `"integrate"` at both call sites (preserving prior behavior — the old prompt always did real `fetch()` calls, so `"integrate"` is the behavior-preserving choice), or making `mode` default to `"integrate"` in `run()`'s signature. Whichever fix is chosen, it belongs in this task's commit (or an immediately-following one) rather than left dangling until Task 10.

**2. No dropped prompt content — refactor is clean.**

Diffed the pre-diff `AANYA_AGENT_SYSTEM_PROMPT` block (extracted from commit `1460f5b`) against the new `AANYA_SHARED_PROMPT_BASE` line by line. Every section is preserved verbatim: workflow steps, STACK rules, the "NEVER use Tailwind/shadcn/@radix-ui" rule, the "NEVER use @apply in CSS" rule, NEXUI COMPONENT USAGE examples, NEXUI CSS VARIABLES list, LAYOUT PATTERNS example, STATIC FILES ALREADY WRITTEN list, FILES YOU MUST WRITE list, all 7 CRITICAL RULES, and the VERIFICATION GATE line. The only change inside the shared base is the single `API calls:` line, intentionally replaced with a pointer to the mode-specific addendum — which is exactly the kind of change Task 8 is meant to make (mode-gating the one line that differs between preview and integrate). Nothing was silently dropped.

Minor (non-blocking) observation: `CRITICAL RULES` items 3 and 4 in the shared base still unconditionally say `API URL: const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"` and `Auth token: const token = await getToken() from useAuth() hook`, regardless of mode. In preview mode this is slightly redundant (the preview addendum already says "no fetch() calls anywhere" and "no hooks that call the backend"), and could nudge the LLM into writing an unused `API_URL` constant. It's not contradictory — `useAuth().getToken()` talks to Clerk, not "the backend" as the addendum means it — so this isn't a real bug, just a small polish opportunity if iterated further.

**3. Mode addenda read clearly and should produce the intended behavior.**

- `AANYA_PREVIEW_ADDENDUM` (`index.ts:163-173`): explicitly says "no fetch() calls anywhere," "Do NOT write hooks that call the backend (no useEffect fetching from an API, no API client, no SWR/react-query against a real endpoint)," and to mock data using shapes from the API contract "as a reference only." This is unambiguous and should stop an LLM from calling `fetch()`. The paired `buildAgentTask` preview branch (`index.ts:195-197`) reinforces this by labeling the API contract "reference only — NOT running yet, do NOT call it."
- `AANYA_INTEGRATE_ADDENDUM` (`index.ts:175-181`): says to wire the "already-approved" UI to the real backend, restores the original `fetch()` + Bearer token instruction, and explicitly says "Do NOT change layout or visual design from the locked preview — only replace mock data with real fetch calls." This correctly instructs wiring-only, not a redesign.

Both addenda are self-consistent with the shared base and with each other.

**4. Test coverage is adequate but narrow.** The two tests only assert presence/absence of specific substrings (`"mock"`, `"Bearer token from useAuth().getToken()"`) in the returned prompt string for each mode. They don't assert anything about `run()`'s behavior or the `buildAgentTask` mode branching (e.g., that preview mode's task message doesn't include the "BACKEND API (running at ...)" phrasing). Not a blocker since it matches the plan's Step 1 test exactly, but worth flagging as thin coverage for future iterations.

## Recommendation

Fix Finding 1 before merging: update `pipeline/activities/index.ts:73` and `:359` to pass an explicit `mode` argument (`"integrate"` preserves current behavior at both sites, since both are on the existing real-backend code path) — or give `mode` a default value in `run()`'s signature — so `bun run typecheck` (and therefore CI) passes on the `pipeline` workspace. Everything else in this diff (prompt-content preservation, mode addendum wording, exported `buildAgentPrompt`, passing test) is solid and needs no changes.
