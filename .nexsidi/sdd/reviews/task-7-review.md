# Task 7 Review

Verdict: NEEDS_FIXES

## Spec compliance

- `execScreenshot` localhost check: matches `http_request`'s pattern exactly — same two-hostname allowlist (`localhost`, `127.0.0.1`), same error-message style. Compliant.
- Uses Playwright's `chromium` (`import { chromium } from "playwright"`, `chromium.launch()`, `browser.newPage()`, `page.goto()`, `page.screenshot()`). Compliant.
- Path-traversal guard: present and modeled on `write_file`'s `guardPath()` in `packages/agent-runtime/src/tools/file.ts` (resolve + `startsWith` prefix check). Structurally similar, but the underlying logic is **not actually correct** — see Findings.
- `loop.ts`: **not modified** — confirmed via `git show 4fbcdf3 --stat` and the diff file; only `package.json`, `src/index.ts`, `src/tools/screenshot.ts`, `src/tools/screenshot.test.ts` changed. Correctly honors the Global Constraint to defer loop-wiring to a later task.
- `index.ts` export: the actual commit `4fbcdf3` **does** add `export { SCREENSHOT_TOOL_DEF, execScreenshot } from "./tools/screenshot.ts";` to `packages/agent-runtime/src/index.ts`, matching the plan's Task 7 file map (`Modify: packages/agent-runtime/src/index.ts`). Verified live in the repo — this export is present and correct.
- **Note on the review package itself:** `.nexsidi/sdd/reviews/task-7.diff` (the file I was told to review) is missing this `src/index.ts` hunk — it only shows 3 of the 4 files that commit `4fbcdf3` actually touched. I caught this by cross-checking `git show 4fbcdf3` directly. The real commit is fine; the diff artifact handed to the reviewer is incomplete. Worth fixing the diff-generation step so future reviews aren't working from a partial picture.

## Test verification

Ran:
```
bun test packages/agent-runtime/src/tools/screenshot.test.ts
```
Output:
```
bun test v1.3.14 (0d9b296a)

 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [356.00ms]
```
Both tests pass. Also ran the full `packages/agent-runtime` suite (4 tests across 2 files, all pass) to confirm no regressions from the websearch task alongside this one.

Confirmed `playwright` actually resolves: `packages/agent-runtime/node_modules/playwright` exists (bun workspace-linked to `node_modules/.bun/playwright@1.61.1`), satisfying the declared `^1.50.1` range. The test file's `import { chromium } from "playwright"` load-succeeds (if it didn't resolve, the test file would fail to even load, not just fail assertions).

## Findings

### 1. Path-traversal guard has a real prefix-matching bypass (should-fix, security)

`outAbs.startsWith(cwdAbs)` (screenshot.ts lines 49-53) does a raw string-prefix comparison with no path-separator boundary check. This is the exact bug class flagged in the review brief. Concretely reproduced against the actual repo:

```js
const { resolve, sep } = require('path');
const cwdAbs = resolve(process.cwd());
// cwd: E:\ai yug\.claude\worktrees\eager-varahamihira-967edb\packages\agent-runtime
const outAbs = resolve('../agent-runtime-evil/x.png');
// outAbs: E:\ai yug\.claude\worktrees\eager-varahamihira-967edb\packages\agent-runtime-evil\x.png
outAbs.startsWith(cwdAbs)        // → true  (WRONG — this is a sibling directory, not inside cwd)
outAbs.startsWith(cwdAbs + sep)  // → false (correct)
```

An `outputPath` of `../agent-runtime-evil/x.png` (or, more realistically in this repo's layout, anything targeting a sibling directory whose name happens to start with the cwd's directory name, e.g. `eager-varahamihira-967edb-evil`) passes the guard and writes outside the intended tree. This is a textbook "prefix without separator" path-guard bug, not a hypothetical.

The shipped test suite does not catch this — it only tests `../../etc/shot.png`, which climbs far enough that the resulting path shares no prefix at all with cwd, so it correctly errors for the wrong reason (doesn't exercise the boundary case).

**Fix:** require an exact match or a match followed by the path separator:
```ts
if (outAbs !== cwdAbs && !outAbs.startsWith(cwdAbs + sep)) {
  return { status: "error", summary: "screenshot outputPath escapes the working directory" };
}
```
(or use `path.relative(cwdAbs, outAbs)` and reject if the result is absolute or starts with `..`).

**Scope note:** `write_file`'s `guardPath()` in `packages/agent-runtime/src/tools/file.ts` (lines 13-19) has the same latent weakness (`abs.startsWith(resolve(sandboxDir))`, no separator check) — it's pre-existing, out of scope for this diff, but since `screenshot.ts` was explicitly modeled on it, fixing one without the other leaves an inconsistency. Flagging as a follow-up (spawned separately) rather than blocking this task on it, since Task 7's own diff is what introduced this instance of the bug and is what's under review here.

### 2. Resource safety — no issue found

`try { browser = await chromium.launch(); ... } catch { ... } finally { await browser?.close(); }` is correctly structured:
- If `chromium.launch()` throws, `browser` stays `undefined`, `browser?.close()` is a safe no-op.
- If `page.goto()` or `page.screenshot()` throws mid-operation, `browser` is already assigned, the `catch` returns the error result, and `finally` still runs and closes it.
- No leak path identified.

## Recommendation

Fix the path-traversal guard (`startsWith(cwdAbs)` → separator-aware check) before merging — this is a genuine, reproducible bypass, not a style nit, and the task brief specifically called out this bug class for scrutiny. Everything else (localhost check, Playwright usage, loop.ts untouched, dependency wiring, test pass) is correct and matches spec. Once the guard is fixed and a boundary-case test is added (e.g. an outputPath resolving to a sibling directory sharing the cwd's name as a prefix), this is approvable.
