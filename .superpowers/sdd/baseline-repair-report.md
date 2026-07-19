# Baseline Repair Evidence Report

## Status

DONE

Implementation commits: `822ce43` (`test: repair isolated Bun baseline`) and `52be708` (`test: allow deterministic RSA setup`).

## Root causes and repairs

1. **Async strike evaluator tests**
   - Root cause: five tests treated `evaluateCommandStrike()` as a synchronous value after its contract became async. Awaiting the real contract also exposed two isolation details: repeated failures could invoke the diagnostic web-search path, and an empty diagnostic added an observable empty `next_actions` array.
   - Repair: await every call in exact strike order, inject a deterministic no-network diagnostic in unit tests, retain the production diagnostic default, and preserve the original tool result when no diagnostic or pivot action is added.

2. **Persistent fallback loader crash**
   - Root cause: `mock.module("@nexsidi/db")` threw while constructing the module, poisoning Bun's loader rather than exercising the runtime database-operation fallback. The test also reused a shared build directory.
   - Repair: construct a valid database module whose `select().from().where().limit()` operation throws, set `BUILD_DIR` to a unique temporary root, restore the environment, and remove the complete temporary root.

3. **Gemini missing-project validation**
   - Root cause: `geminiChat()` production ordering was already correct. The full-suite failure was cross-file module-mock leakage: `compaction.test.ts` globally replaced the package `geminiChat`, so the Gemini test received a resolved mock instead of the real missing-project rejection.
   - Repair: inject the compaction chat dependency instead of mocking the package module, make Bun test-file isolation the default in `bunfig.toml`, and move compaction's temporary source file outside the repository. The Gemini production module was not changed.

4. **Custom-auth prompt expectation drift**
   - Root cause: the frontend prompt had correctly migrated to custom JWT cookie authentication, while its test still expected Clerk's `useAuth().getToken()`.
   - Repair: assert token-cookie parsing plus `Authorization: Bearer <token>`, and assert the Clerk helper is absent.

5. **Incomplete logic QA module**
   - Root cause: the real QA implementation had been overwritten by the old repository-mutating meta test, leaving only a prompt stub and config.
   - Repair: restore result/finding/dependency types, `run`, `runExploring`, parsing, fence handling, severity normalization, objective scoring, retry behavior, wide output budget, evidence-gated review instructions, and default-FAIL behavior consistent with sibling QA modules and the existing contract tests.

6. **ProjectSpec fixture drift**
   - Root cause: the fixture still used `auth.provider: "clerk"` while both the producer and runtime schema require `"custom"`.
   - Repair: update only the fixture; the runtime schema remains strict.

7. **Bun execSync output compatibility**
   - Root cause: Bun can return Buffer-like output from `execSync()` despite an encoding option, while `execGit()` called string-only `.trim()` directly.
   - Repair: normalize string or Buffer output explicitly and keep `execGit()` returning a string. The transaction test remains confined to a disposable Git repository.

8. **Repository-mutating meta tests**
   - Root cause: production functions hard-coded `process.cwd()`, home/build paths, live chat, and destructured Git execution. Tests wrote real instruction/agent files, wrote home/build data, and attempted real commits; spying after the destructured import did not reliably intercept execution. `instinct-cron.ts` also self-executed during test import because its argv substring check matched the test filename.
   - Repair: add narrow optional dependencies for observations/build/repository roots, chat, and commit functions while preserving safe production defaults; use argument-based Git execution; remove the argv substring auto-run; and rewrite tests around unique temporary roots with injected chat/commit functions and full environment restoration.

## Additional isolation repair

- `subagent.test.ts` no longer uses a shared build/history directory or requests database-backed history; its entire workspace lives under a unique temporary root.
- `compaction.test.ts` no longer writes `temp-code.ts` into the repository and no longer leaks a package-level module mock.
- `bunfig.toml` enables fresh test-file globals so remaining Bun mocks cannot make suite results order-dependent.
- `packages/context-chain/src/verify.test.ts` gives 2048-bit RSA key generation a 30-second setup budget instead of Bun's default 5-second hook timeout, preventing CPU-contention flakes under isolated full-suite concurrency.

## Files changed

- `agents/generators/aanya/src/index.test.ts`
- `agents/qa/navya/src/index.ts`
- `bunfig.toml`
- `packages/agent-runtime/src/compaction.test.ts`
- `packages/agent-runtime/src/compaction.ts`
- `packages/agent-runtime/src/enforce/contracts.test.ts`
- `packages/agent-runtime/src/loop.test.ts`
- `packages/agent-runtime/src/loop.ts`
- `packages/agent-runtime/src/persistent-fallback.test.ts`
- `packages/agent-runtime/src/subagent.test.ts`
- `packages/agent-runtime/src/tools/git.test.ts`
- `packages/agent-runtime/src/tools/git.ts`
- `packages/context-chain/src/verify.test.ts`
- `pipeline/instinct-cron.test.ts`
- `pipeline/instinct-cron.ts`
- `pipeline/meta-supervisor.test.ts`
- `pipeline/meta-supervisor.ts`
- `.superpowers/sdd/baseline-repair-report.md`

## Targeted verification

All commands used the required existing binary at `C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe`, with automatic env-file loading disabled and no live credentials.

| Test target | Result |
| --- | ---: |
| `packages/agent-runtime/src/loop.test.ts` | 11 pass, 0 fail |
| `packages/agent-runtime/src/persistent-fallback.test.ts` | 1 pass, 0 fail |
| `packages/llm-client/src/gemini.test.ts` | 12 pass, 0 fail |
| `agents/generators/aanya/src/index.test.ts` | 10 pass, 0 fail |
| `agents/qa/navya/src/index.test.ts` | 21 pass, 0 fail |
| `packages/agent-runtime/src/enforce/contracts.test.ts` | 13 pass, 0 fail |
| `packages/agent-runtime/src/tools/git.test.ts` | 2 pass, 0 fail |
| `pipeline/instinct-cron.test.ts` + `pipeline/meta-supervisor.test.ts` | 2 pass, 0 fail |
| `packages/agent-runtime/src/compaction.test.ts` + `packages/llm-client/src/gemini.test.ts` interaction check | 16 pass, 0 fail |

## Complete-suite verification

Command shape:

```powershell
$env:DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused'
& 'C:\Users\amits\AppData\Roaming\npm\node_modules\bun\bin\bun.exe' --no-env-file test --reporter=dots
```

The non-routable database URL only satisfies the existing import-time presence check in the DB client. Isolated tests did not execute a database query or connect to that endpoint.

Result: **421 pass, 0 fail, 815 assertions, 64 files** using Bun 1.3.14.

## Repository-mutation proof

- Captured `git status --short` immediately before the complete suite.
- Captured it again immediately after the suite.
- Compared both snapshots in the same PowerShell invocation.
- Result: `STATUS DELTA INTRODUCED BY TESTS: NONE`.
- All extensive pre-existing tracked and untracked worktree changes remained present and unstaged; no unrelated file was reset, overwritten, cleaned, staged, or committed.

## Remaining concerns

None. Expected caught-error logging remains visible in the persistent database-fallback test because the failure is the behavior under test.
