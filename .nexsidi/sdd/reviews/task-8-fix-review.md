# Task 8 Fix Re-Review

Verdict: APPROVED

## Original finding addressed?

Yes. Both call sites in `pipeline/activities/index.ts` now pass an explicit
`"integrate"` second argument to Aanya's `run()`:

- `pipeline/activities/index.ts:73` (inside `runAanya(projectId)`):
  `const result = await runAanyaAgent(getPlan(projectId), "integrate");`
- `pipeline/activities/index.ts:359` (inside `runCodeFix`'s retry
  `Promise.all`): `runAanyaAgent(patchedPlan, "integrate"),`

Confirmed via `git diff 1880afb~1 1880afb -- pipeline/activities/index.ts` —
exactly these two lines changed, matching `task-8-fix.diff` byte for byte.

## Semantic correctness of "integrate" mode choice

Correct at both sites. Read `pipeline/workflows/project-build.ts` in full
(the only Temporal workflow currently wired up) to check whether either call
site is actually on the new preview-only path:

- Stage 3 ("generate", `project-build.ts:71-77`) runs `runShubham`,
  `runAanya`, and `runPranav` **in parallel** — i.e. backend, frontend, and
  DB migrations are generated together, with no UI-approval gate in between.
  It is immediately followed by a TypeScript compile gate, then a QA loop,
  then Stage 2 live execution (`runLiveCheck` — Docker build, container
  start, and a real `curl` against the running endpoint,
  `project-build.ts:159-162`). A live curl check can only pass if the
  frontend is actually issuing real `fetch()` calls against the real
  backend — which is exactly what `"integrate"` mode produces and what
  `"preview"` mode explicitly forbids (per `AANYA_PREVIEW_ADDENDUM`: "no
  fetch() calls anywhere"). Using `"preview"` here would make `runLiveCheck`
  meaningless. So `runAanya`'s call site is unambiguously on the
  real-backend-exists / integrate path.
- `runCodeFix` (`activities/index.ts:320-364`) is the shared retry function
  invoked from three places in the QA loop: post-compile-check failure,
  `qa_fail`, and `live_check_fail` — all of which run *after* the initial
  Stage 3 "integrate" generation already produced real `fetch()` + Bearer
  token code. Switching to `"preview"` mid-loop would rip out working
  integration code the QA/live-check loop is actively trying to fix,
  contradicting the addendum's own framing (`AANYA_INTEGRATE_ADDENDUM`
  talks about wiring "already-approved" UI to the backend — this loop is
  strictly downstream of that). `"integrate"` is the only consistent choice.
- Grepped the full codebase (`pipeline/`, `agents/generators/aanya/`) for
  any `"preview"` mode usage: it appears only in
  `agents/generators/aanya/src/index.ts` (the mode type/addendum
  definitions and the `mode === "preview"` branches) and in
  `agents/generators/aanya/src/index.test.ts` (`buildAgentPrompt("preview")`
  unit test). No file named `stage3-ui-preview.ts` or any orchestrator
  stage exists yet anywhere in the repo (`Glob **/stage3*` → no matches),
  confirming Task 10 (the new preview-mode orchestrator wiring referenced
  in the original review) has not been built. There is currently no live
  call site in the codebase that should be using `"preview"` — so this fix
  cannot have chosen the wrong mode for either site.

## Typecheck verification

Ran it myself, matching `pipeline/package.json`'s `typecheck` script
(`tsc --noEmit`) exactly:

```
$ cd pipeline && bunx tsc --noEmit
[... 17 error lines across 4 files, see Findings ...]
```

Grepped specifically for `TS2554`: **zero matches**. Both errors from the
original review (`activities/index.ts(73,26)` and `activities/index.ts(359,7)`,
both "Expected 2 arguments, but got 1") are gone.

To independently corroborate the "11 pre-existing, unrelated" claim beyond a
spot check, I temporarily restored the pre-fix version of the file
(`git checkout 1880afb~1 -- pipeline/activities/index.ts`), re-ran
`bunx tsc --noEmit`, and diffed the two outputs:

- Pre-fix run: same 17 error lines (identical files, identical line numbers,
  identical messages) **plus** the two `TS2554` lines at the end.
- Post-fix run: the same 17 error lines, with the two `TS2554` lines gone.

This is stronger than a 2-3 item spot check — it's a full byte-level diff of
tsc's output before and after, over the entire pipeline workspace. The 17
remaining errors (grouped as: 6× `appName`/`appDescription` missing on
`BuildPlan` in `agents/generators/aanya/src/index.ts` and
`agents/generators/shubham/src/index.ts`; 1× `ModelId | undefined` in
`agents/tilotma/src/orchestrator.ts:45`; 8× `ToolResult` not assignable to
`Record<string, unknown>` in `packages/agent-runtime/src/loop.ts`; 2×
`spawnSync` overload / `string | undefined` errors in
`packages/agent-runtime/src/tools/command.ts`) are byte-identical before and
after this diff, in files this diff never touches. They are genuinely
pre-existing and out of scope for this fix. (The implementer's report says
"11" — actual count of distinct error *sites* is 17 by my tsc run, likely a
miscount or different grouping on their end, but the substance of the claim
— pre-existing, unrelated, untouched by this diff — checks out fully
either way.)

I restored the working tree to the post-fix state
(`git checkout HEAD -- pipeline/activities/index.ts`) immediately after this
check; `git diff HEAD -- pipeline/activities/index.ts` is empty, confirming
no residual change from this verification step. (An unrelated pre-existing
`bun.lock` modification and an untracked `.nexsidi/` directory were present
in the working tree before I started and are outside this review's scope —
noted here only for completeness, not flagged as a finding.)

## Findings

None found.

## Recommendation

Approve as-is. The fix is minimal (2 lines, 1 file, exactly the two call
sites identified in the original review), `"integrate"` is semantically
correct at both sites (confirmed against the live workflow — no reachable
call site should be using `"preview"` since Task 10's preview stage isn't
built yet), `TS2554` is fully resolved, and the remaining 17 typecheck
errors are verified pre-existing and unrelated via a full before/after
diff of `tsc --noEmit` output.
