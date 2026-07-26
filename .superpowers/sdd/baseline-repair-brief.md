# Baseline Repair Task Brief

## Objective

Repair the existing repository baseline so the full Bun test suite is deterministic, isolated from the real worktree and user data, and passing before the approved autonomous workspace implementation begins.

## Required workflow

1. Read this brief completely.
2. Use the `superpowers:systematic-debugging` skill before changing code.
3. Use the `superpowers:test-driven-development` skill for every production fix.
4. Reproduce each failing category with the smallest targeted test command.
5. Determine and record the root cause before making a fix.
6. Preserve all pre-existing dirty worktree changes. Do not reset, checkout, clean, or overwrite unrelated files.
7. Do not call live LLMs, the network, PostgreSQL, Redis, Temporal, or Docker from tests.
8. Tests must never write to the real repository, the user's home data, or create real Git commits. Use injected paths/dependencies and disposable temporary directories.
9. Commit only files intentionally changed for this repair. Do not stage unrelated dirty files.
10. Write the final evidence report to `.superpowers/sdd/baseline-repair-report.md`.

## Repository and runtime

- Worktree: `E:\ai yug\.claude\worktrees\eager-varahamihira-967edb`
- Branch: `feat/nexsidi-pipeline-v2-eager`
- Base commit before repair: `f85fa95`
- Existing Bun binary: `C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe`
- Do not install or download another Bun runtime.

## Known failing categories from the full baseline run

The last full run reported 400 tests: 389 pass, 11 fail, and 2 loader/unhandled errors.

### 1. Async strike evaluator tests

- File: `packages/agent-runtime/src/loop.test.ts`
- `evaluateCommandStrike` is now async because it can request diagnostics after repeated failures.
- Production callers in `loop.ts` and `gemini-loop.ts` await it, but five unit tests still use it synchronously.
- Preserve the async production contract. Update the tests to await every call and keep the strike-order assertions exact.

### 2. Persistent fallback mock crashes the module loader

- File: `packages/agent-runtime/src/persistent-fallback.test.ts`
- Its `mock.module("@nexsidi/db", () => { throw ... })` throws during module construction, producing an unhandled test-loader error instead of exercising runtime fallback.
- Mock the database API so the relevant DB operation throws when called.
- Isolate build/history files under a unique disposable temp directory and restore environment/global state.

### 3. Gemini missing-project validation

- File: `packages/llm-client/src/gemini.test.ts`
- Expected behavior: missing `GOOGLE_CLOUD_PROJECT` must fail before authentication or network activity.
- Current `geminiChat` appears to call `projectIdOrThrow()` first, so determine whether the failure is test pollution/module mocking/cached state rather than blindly editing production code.
- Add or adjust isolation only after reproducing the targeted failure.

### 4. Custom-auth prompt expectation drift

- File: `agents/generators/aanya/src/index.test.ts`
- The codebase has migrated from Clerk to custom auth. The integrate prompt correctly describes reading the token cookie/helper and sending `Authorization: Bearer <token>`.
- Replace stale expectations for `useAuth().getToken()` with precise assertions for the custom-auth contract, and assert the Clerk helper is absent.

### 5. Incomplete logic QA module

- File: `agents/qa/navya/src/index.ts`
- The module currently only exports a short prompt and config, while its tests and Stage 5 require `run`, `runExploring`, parsing/scoring helpers, and result types.
- Restore a complete implementation consistent with sibling QA modules and the existing `agents/qa/navya/src/index.test.ts` contract.
- Preserve default-fail behavior, evidence-gated exploratory review, retry semantics, and objective severity scoring.
- Do not expose internal identities in any user-facing string or UI; internal source/test labels can remain where required by existing contracts.

### 6. ProjectSpec contract fixture drift

- File: `packages/agent-runtime/src/enforce/contracts.test.ts`
- Runtime schema correctly requires custom authentication; fixture still says `provider: "clerk"`.
- Update the fixture to the current producer/schema contract. Do not loosen the runtime schema back to Clerk.

### 7. Bun `execSync` output compatibility

- File: `packages/agent-runtime/src/tools/git.ts`
- Under Bun 1.3.14, `execSync(..., { encoding: "utf-8" })` may return a Buffer-like value, so `.trim()` throws.
- Normalize string/Buffer output explicitly while keeping the public `execGit` return type as `string`.
- Existing git transaction tests must pass in a disposable repository.

### 8. Repository-mutating meta tests

- Files: `pipeline/instinct-cron.test.ts`, `pipeline/meta-supervisor.test.ts`
- These currently write to real paths under `process.cwd()`/the user's home and attempt to spy on a destructured `execSync` import. The prior full run overwrote the actual QA module during the test and logged attempted commits.
- Refactor the production functions to accept narrowly scoped optional dependencies/paths (filesystem root, observations/build directory, LLM call, git command/commit function) with safe existing defaults.
- Tests must use unique temporary directories and injected mocks; no real repo file or Git state may change.
- Production behavior may still perform its intended commit when invoked outside tests, but its test must not.

## Verification requirements

Run targeted tests for every changed area, then run the complete suite with the existing Bun binary.

At minimum include:

```powershell
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/agent-runtime/src/loop.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/agent-runtime/src/persistent-fallback.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/llm-client/src/gemini.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test agents/generators/aanya/src/index.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test agents/qa/navya/src/index.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/agent-runtime/src/enforce/contracts.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test packages/agent-runtime/src/tools/git.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test pipeline/instinct-cron.test.ts pipeline/meta-supervisor.test.ts
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' test
```

Before and after the full suite, capture `git status --short` and prove the test run introduced no new tracked or untracked repository changes beyond the intentional repair/report files.

## Deliverables

- Minimal production/test repairs with focused comments only where the reason is non-obvious.
- A clean repair commit containing only intentional repair files.
- `.superpowers/sdd/baseline-repair-report.md` with:
  - root cause per category,
  - files changed,
  - targeted test commands/results,
  - full-suite result,
  - before/after worktree mutation comparison,
  - commit hash,
  - remaining concerns (or `none`).
