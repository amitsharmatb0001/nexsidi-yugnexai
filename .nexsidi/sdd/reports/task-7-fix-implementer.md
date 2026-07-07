# Task 7 Fix Report

Status: DONE

## What I did

Fixed the path-traversal guard bug in `packages/agent-runtime/src/tools/screenshot.ts`
found by independent code review. The guard used a bare string-prefix check
(`outAbs.startsWith(cwdAbs)`), which incorrectly allows sibling directories that share
a string prefix with `cwd` — e.g. if `cwd` resolves to `.../foo`, a path resolving to
`.../foo-evil/x.png` passes the check even though it is a completely different,
sibling directory outside `cwd`.

Fix: imported `sep` from `path` and changed the guard to require either exact equality
with `cwdAbs` (writing directly into the root) or a prefix match against
`cwdAbs + sep` (a real path separator boundary), so `foo-evil` no longer matches `foo`.

```ts
import { resolve, sep } from "path";
...
const outAbs = resolve(args.outputPath);
const cwdAbs = resolve(process.cwd());
if (outAbs !== cwdAbs && !outAbs.startsWith(cwdAbs + sep)) {
  return { status: "error", summary: "screenshot outputPath escapes the working directory" };
}
```

Added a regression test to `packages/agent-runtime/src/tools/screenshot.test.ts`
reproducing the exact sibling-directory case the reviewer found.

Note on the test path: I first verified empirically what `process.cwd()` actually is
when running `bun test packages/agent-runtime/src/tools/screenshot.test.ts` from the
repo root (the working directory given for this task). It resolves to the **repo
root** (`E:\ai yug\.claude\worktrees\eager-varahamihira-967edb`), not
`packages/agent-runtime` as the task's example assumed. I confirmed this by running a
throwaway test file that printed `process.cwd()`.

Rather than hardcode a path tied to this specific worktree's directory name (which
would break if the report/fix is later applied against a differently-named checkout,
e.g. a plain `nexsidi/` clone or a different worktree suffix), I made the test derive
the sibling name dynamically from the actual `process.cwd()` basename:

```ts
const cwdName = process.cwd().split(/[\\/]/).filter(Boolean).pop()!;
const result = await execScreenshot({ url: "http://localhost:3200", outputPath: `../${cwdName}-evil/x.png` });
```

This guarantees the constructed path is always a genuine sibling of `process.cwd()`
that shares a string prefix, regardless of what that cwd is named, so the test
reproduces the bug reliably in any environment. I also asserted on the specific
rejection message (`escapes the working directory`) rather than just `status: "error"`,
because with a bare `startsWith` bug still present, this particular case would still
return `status: "error"` eventually (Playwright fails to connect to
`localhost:3200` since nothing is listening there) — but for the wrong reason. Asserting
the summary text ensures the test actually exercises the guard, not a downstream
connection failure, and would have caught the original bug (which resolves the
sibling path as "inside" cwd and proceeds past the guard into the browser-launch path).

## Test output

```
$ bun test packages/agent-runtime/src/tools/screenshot.test.ts
bun test v1.3.14 (0d9b296a)

 3 pass
 0 fail
 5 expect() calls
Ran 3 tests across 1 file. [442.00ms]
```

All 3 tests pass (2 original + 1 new regression test).

## Commit

2e82847dcfaf50a6723b51255115cda30d2f5698

fix: path-traversal guard in screenshot tool allowed sibling directories via bare prefix match

## Concerns (if any)

- I deviated slightly from the exact literal test snippet given in the task prompt
  (which used a hardcoded `outputPath: "../agent-runtime-evil/x.png"` assuming cwd is
  `packages/agent-runtime`). Empirically, cwd is the repo root when running the
  specified `bun test` command from the repo root, so the literal snippet as given
  would NOT have reproduced the bug (it would resolve to a nonexistent sibling of the
  repo root's *parent*'s... actually it would just resolve to
  `<repo-root-parent>/agent-runtime-evil/x.png`, which shares no meaningful prefix with
  the actual cwd and would have been correctly rejected even under the old buggy code,
  making it a weak/non-reproducing regression test). I used a dynamic, cwd-derived
  sibling name instead, per the task's own instruction to "adjust the exact relative
  path in the test if needed" and verify empirically what cwd resolves to. I verified
  this by running a throwaway `console.log(process.cwd())` inside `bun test`.
- Did not touch `.nexsidi/sdd/reviews/task-7.diff` per the task note — the missing
  `index.ts` export hunk discrepancy vs. commit `4fbcdf3` remains unaddressed, as
  instructed.
- No other callers of `execScreenshot` were found to need changes; the fix is
  localized to the guard check.
- Running `bun test`/`bun install` in this workspace incidentally rewrote `bun.lock`
  to register the previously-unlisted `@nexsidi/agent-runtime` workspace package
  (pre-existing drift, unrelated to this fix). Per the task's explicit commit
  instructions (only `screenshot.ts` and `screenshot.test.ts`), I did NOT stage or
  commit `bun.lock` — it remains as a local uncommitted modification in the working
  tree for Amit/Tilotma to decide on separately.
