# Task 13 Review

Verdict: APPROVED

## deployTarget gate verification

Ran `bun test agents/riya/src/deploy-target.test.ts` directly:

```
bun test v1.3.14 (0d9b296a)
 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [231.00ms]
```

`resolveDeployTarget("gcp")` genuinely throws `Error("GCP deploy target not yet implemented — per design doc Open Follow-Up #5, build when Amit says it's needed")` — confirmed by reading `agents/riya/src/index.ts:28-35` and by the passing throw-assertion test. This is not a silent fallback: there is no try/catch around the throw, no default-to-local branch, and no swallowed rejection anywhere in the call path. Cross-checked the "per design doc Open Follow-Up #5" claim against `docs/superpowers/specs/2026-07-01-full-agentic-pipeline-design.md:173` — item 5 reads "Design + build the GCP deploy path | Claude builds it, triggered whenever Amit says it's needed — timing is Amit's call, the build is Claude's." The claim is accurate, not invented.

`run()` (`agents/riya/src/index.ts:42-43`) calls `resolveDeployTarget(deployTarget)` as the literal first statement in the function body — before `mkdirSync(buildDir, ...)`, before `findFreePort`, before `runAgent(...)` (the actual docker/deploy work), and before any DB write. A `"gcp"` request throws synchronously before any side effect occurs. Also confirmed `deployTarget` defaults to `"local"` in `run()`'s signature, matching `pipeline/orchestrator/flags.ts`'s `resolveFlags().deployTarget` default (`process.env.NEXSIDI_DEPLOY_TARGET === "gcp" ? "gcp" : "local"`) and `FeatureFlags.deployTarget` in `pipeline/orchestrator/types.ts`. Global Constraint satisfied.

## Dynamic import justification check

Verified TRUE, empirically — not just taken on the implementer's word. Read `packages/db/src/client.ts`:

```ts
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
```

This runs at module top level (not inside a function), and `packages/db/src/index.ts` re-exports `db` straight from `client.ts`, so any `import { db } from "@nexsidi/db"` transitively executes this throw immediately at import time if `DATABASE_URL` is unset.

I reproduced this directly: with `DATABASE_URL` unset in this shell (confirmed via `env | grep -i database_url` → empty), I wrote a throwaway file `agents/riya/src/__scratch_db_import_check.ts` containing only `import { db } from "@nexsidi/db";` and ran `bun run` on it. It failed exactly as claimed:

```
error: DATABASE_URL is not set
      at packages/db/src/client.ts:6:34
```

(scratch file deleted after the check; `git status --short` confirms it left no trace). So moving `@nexsidi/db`/`drizzle-orm` to point-of-use dynamic imports inside `run()` is a real, necessary fix to keep `deploy-target.test.ts` infra-free — not unjustified scope creep. It is scoped tightly to exactly the two modules that needed it, and the top-of-file comment in `index.ts` explaining the reasoning is accurate.

## Confidentiality check

Read `buildDeliverySummary` (`pipeline/orchestrator/stages/stage6-deployment.ts`): it returns exactly `{ status, appUrl, githubRepo }` — three fields, none of which are ever populated from an agent name in the current code paths (`appUrl` is `http://localhost:{port}`, `githubRepo` is `https://github.com/{org}/nexsidi-{projectId}`, `status` is a literal `"delivered" | "failed"`). Deploy `errors` (which could theoretically contain agent-flavored LLM output) are deliberately NOT threaded into `deliverySummary` — they only appear in `Stage6Result.findings`, a separate, non-summary field.

The `INTERNAL_AGENT_NAMES` test (`buildDeliverySummary never contains any internal agent name`) is real in the sense that it does construct an actual `DeployResult` + `LiveRetestResult`, call the real `buildDeliverySummary`, `JSON.stringify` the real output, and scan it against the name list — it is not a tautological no-op assertion. However, it is structurally weak as a leak *detector*: because `DeliverySummary`'s shape has no field capable of carrying an agent name today, the test can't currently fail regardless of whether "real" confidentiality logic exists — there's no redaction/sanitization step being exercised, just a type that happens not to include risky fields. Its actual value is as a regression trip-wire: if someone later adds a field like `qaBreakdown: { navya: 90, ... }` to `DeliverySummary`, `JSON.stringify` would serialize the key name too and this test would catch it. That's a legitimate, if narrow, purpose.

One completeness gap worth flagging (non-blocking): `INTERNAL_AGENT_NAMES` (11 names: tilotma, saanvi, arjun, vanya, aanya, shubham, pranav, riya, navya, karan, deepika) omits **Aarav** (the Phase-1 test-runner agent from CLAUDE.md's active roster) and all Phase 2/Red-Blue/Ops names. Irrelevant to whether *this* test passes today (nothing in `DeliverySummary` could contain any agent name), but if this list is ever promoted to a shared/canonical confidentiality checker reused elsewhere, its incompleteness would matter. Scoped correctly for what Task 13 needed.

## Live-retest stub obviousness

Read `runLiveRetestStub` (`pipeline/orchestrator/stages/stage6-deployment.ts`). It cannot be mistaken for real QA:

- A ~15-line file-header comment block ("Stage 5 live-retest status — read before touching this file") explains exactly why the stub exists, what's missing (Task 12 / `stage5-adversarial-qa.ts` not landed), and precisely how to replace it later.
- The function itself is named `runLiveRetestStub` (not `runLiveRetest`), with an inline comment above it: "STUB... this MUST be replaced with the real Stage 5 live retest before this pipeline is considered production-ready; do not remove this warning without wiring the real call."
- At runtime it emits `console.warn` on every invocation: `` `[stage6] Stage 5 live-retest STUBBED for project ${projectId} against ${appUrl} — ... Treating as pass with no findings so deployment is not blocked on it, but this is NOT real QA coverage.` `` This will show up in any log stream, not just source code — satisfies "obvious in logs" as well as "obvious in code."
- It always returns `{ pass: true, findings: [] }` unconditionally — a genuine functional gap (no deploy-config-drift detection happens yet), but it is loudly self-reported rather than silently masquerading as a real check.

Minor gap (non-blocking): no test exercises `runStage6(projectId, stage4Result)` with the *default* `deps` (i.e. `defaultDeps.liveRetestFn = runLiveRetestStub`). All 5 `runStage6` tests inject explicit `deps`, so nothing currently asserts the default wiring stays pointed at the stub, or that the `console.warn` message survives future edits. Worth adding later, not a blocker for this task — the stub's obviousness today is a property of the code/comments/log line itself, which I verified directly by reading it, not by relying on a test asserting it.

## Test verification

```
$ bun test agents/riya/ pipeline/orchestrator/stages/
bun test v1.3.14 (0d9b296a)
 17 pass
 0 fail
 34 expect() calls
Ran 17 tests across 3 files. [304.00ms]
```

3 files matched: `agents/riya/src/deploy-target.test.ts` (2 tests), `pipeline/orchestrator/stages/stage6-deployment.test.ts` (7 tests), and `pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts` (8 tests — this is the "different task that landed after Task 13" file mentioned in the brief; it's unrelated to this diff and all its tests pass too, so it doesn't muddy the result). All Task-13-relevant tests pass.

Also ran `bunx tsc --noEmit -p agents/riya/tsconfig.json` and a scratch include of `pipeline/orchestrator/**/*.ts` + `agents/**/*.ts` against `tsconfig.bun.json`: zero new type errors touching `agents/riya/src/index.ts` or `pipeline/orchestrator/stages/stage6-deployment.ts`. The only errors present (`packages/agent-runtime/src/loop.ts`, `packages/agent-runtime/src/tools/command.ts`, `agents/tilotma/src/orchestrator.ts`, `pipeline/orchestrator/run.test.ts`) are pre-existing and unrelated to any file this commit touched (confirmed the same `agent-runtime`/`orchestrator.ts` errors are called out as pre-existing in `.nexsidi/sdd/reviews/task-10-review.md`).

## Legacy caller compatibility

`pipeline/activities/index.ts:400-406`'s `runRiya` Temporal activity calls `runRiyaAgent(projectId)` — one argument only, unchanged from before this diff. Since `run()`'s new second parameter (`deployTarget: "local" | "gcp" = "local"`) has a default value, this call site still type-checks and still behaves exactly as before (deploys local, since that was the only behavior that existed pre-Task-13). Confirmed via `bunx tsc --noEmit -p pipeline/tsconfig.json`: zero errors on `activities/index.ts` or anything referencing `runRiya`/`runRiyaAgent`. `pipeline/orchestrator/stages/stage6-deployment.ts` is not itself wired into `pipeline/orchestrator/run.ts` yet (grepped — no references), which is expected: Task 13's own scope is "create `stage6-deployment.ts`," not "wire it into the top-level orchestrator," and Stage 5 (its logical predecessor) hasn't landed either.

## Findings

None blocking. Two non-blocking observations already noted above:
1. `INTERNAL_AGENT_NAMES` in `stage6-deployment.ts` omits Aarav and all Phase-2/Red-Blue/Ops agent names — irrelevant today given `DeliverySummary`'s narrow shape, but would matter if this list is ever reused as a shared confidentiality checker.
2. No test exercises the default `Stage6Deps` (i.e., that `runStage6` really wires up `runLiveRetestStub` by default, or that its `console.warn` message stays intact) — all current tests inject explicit stubs.

Also note (not a defect): `DeliverySummary` only carries `{status, appUrl, githubRepo}`, not the "feature list" the design doc's confidentiality table (`docs/superpowers/specs/2026-07-01-full-agentic-pipeline-design.md:69`) mentions as part of final delivery. This is consistent with Task 13's scope — `runStage6` only receives `Stage4Result` (backend/frontend output dirs + files written), not `ProjectSpec.features` — so a feature list isn't available to construct here. Presumably a later/higher-level assembly step (Tilotma) combines Stage 1's feature list with Stage 6's delivery summary. Flagging so it isn't lost, not asking for a fix in this task.

## Recommendation

Approve as-is. The `deployTarget` gate is real and fires first, the dynamic-import justification is verified true (not just claimed), the stub is unambiguous in both code and runtime logs, and the legacy Temporal caller keeps compiling and behaving identically. The confidentiality test is honest about what it checks (real assertion, not a stub) but structurally can't fail today given the summary's narrow shape — worth strengthening later (e.g. add a case where a deploy error message containing a name attempts to leak into the summary) but not a reason to block this task.
