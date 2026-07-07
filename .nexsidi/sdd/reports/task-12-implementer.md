# Task 12 Implementer Report

Status: DONE

## What I did

Created `pipeline/orchestrator/stages/stage5-adversarial-qa.ts`, the missing
piece that runs Navya/Karan/Deepika in parallel, scores each, does fault
isolation on failure, and calls Tilotma's Tier 3 review on full pass.

Structure mirrors `pipeline/orchestrator/run.ts`'s
`runPipelineWithStages`/`runPipeline` split (explicitly requested in the
brief):

- `runStage5WithAgents(projectId, stage4Result, agents: Stage5Agents): Promise<Stage5Result>`
  — pure, deterministic orchestration logic (scoring + routing), takes an
  injected `Stage5Agents` seam. This is what the test file exercises.
- `runStage5(projectId, stage4Result): Promise<Stage5Result>` — the real
  entry point matching the plan's required signature exactly. Dynamically
  imports Navya/Karan/Deepika's real `run()` and Tilotma's real
  `runTier3Review`, wraps them into `Stage5Agents` closures (each closure
  handles building the `code` string via a new `collectCode()` helper that
  walks Stage 4's `backendOutputDir`/`frontendOutputDir` and concatenates
  readable source files), then delegates to `runStage5WithAgents`.

`identifyFaultAgent`, `Finding`, and `Stage4Result` are imported from
`stage4-multi-agent-dev.ts`, not redefined. `scoreSecurityFindings` is
imported (as a value, statically — it's pure and has no LLM side effects at
module-eval time) from `agents/qa/karan/src/index.ts`, exactly as the brief's
import line specified.

Scoring: Karan is zero-tolerance via `scoreSecurityFindings(karanResult.findings)`.
Navya/Deepika use their own already-computed `.passed` field directly (no
new scorer invented). `allPass = security.pass && navyaResult.passed &&
deepikaResult.passed`. On any failure, all three agents' findings are mapped
into Stage 4's `Finding` shape, concatenated (Karan first, then Navya, then
Deepika — matching the plan's illustrative sample order), and
`identifyFaultAgent` picks the fault agent from the first finding in that
list. On full pass, `runTier3Review` is called with
`stage4Result.frontendOutputDir` and its result mapped into `Stage5Result`
(`tier3.findings` become `Finding[]` with `file: ""`, since Tier 3 findings
are prose strings, not file-scoped).

## Navya/Deepika's real interfaces

Both `agents/qa/navya/src/index.ts` and `agents/qa/deepika/src/index.ts`
export `run(projectId: string, iteration: number, code: string):
Promise<QAResult>` — identical signature to Karan's, confirmed by reading
both files directly (not assumed). Their `QAResult` is
`{ agent: string; score: number; passed: boolean; findings: Finding[] }`
where `score`/`passed` follow the severity-weighted `100 - CRITICAL*20 -
HIGH*10 - MEDIUM*5 - LOW*1`, `passed = score >= 85` convention, and `Finding`
is `{ severity: "🔴"|"🟡"|"🟢"|"💡"; category: string; detail: string }` — no
`file` field.

Both are currently still TODO-stub implementations internally (`run()`
always returns `score: 100, findings: []`, with a `// TODO Phase 1: parse
content into QAResult with findings` comment) — the LLM call happens and its
response is discarded. This is a pre-existing gap in Navya/Deepika
themselves, out of scope for this task (Stage 5's contract with them is
already correct for when that TODO is resolved — no Stage 5 changes will be
needed).

## Finding shape reconciliation

Stage 4's canonical `Finding` is `{ file: string; issue: string }` —
`identifyFaultAgent` only inspects `findings[0]?.file`'s prefix
(`backend/`/`frontend/`/`db/`, defaulting to `"shubham"` otherwise).

- **Karan's `SecurityFinding`** (`{ severity, description, file? }`) maps
  cleanly: `{ file: f.file ?? "", issue: "[security/${severity}] ${description}" }`.
  `file` is optional in the real type (best-effort from the model), so it
  falls back to `""` when absent.
- **Navya/Deepika's `Finding`** (`{ severity, category, detail }`) has **no
  file field at all** in the real type — there is nothing honest to map into
  `file` beyond `""`. Documented explicitly in the source file's
  "Finding-shape reconciliation" comment block: a Navya- or Deepika-only
  failure's findings will fall through `identifyFaultAgent`'s default
  (`"shubham"`) rather than being correctly attributed to Aanya or Pranav.
  This is a genuine limitation of Navya/Deepika's current output shape (once
  their TODO stub is replaced with real parsing, adding a `file` field to
  their `Finding` type would be the natural fix — flagged, not silently
  worked around).
- **Tier 3's findings** (`string[]` prose) map to `{ file: "", issue: <string> }`.

## Test output

`bun test pipeline/orchestrator/stages/stage5-adversarial-qa.test.ts`:
```
bun test v1.3.14 (0d9b296a)

 10 pass
 0 fail
 17 expect() calls
Ran 10 tests across 1 file. [53.00ms]
```

Covers: (1) all-pass calls Tier 3 and surfaces its result, (2) Karan-any-finding
fails regardless of clean Navya/Deepika and short-circuits before Tier 3 is
called, (3) Navya-below-85 and Deepika-below-85 each independently fail even
with a clean Karan, (4) fault routing to shubham/aanya/pranav based on
Karan's `file` prefix, plus a fallback-to-shubham case for a
Navya-only failure (no file info available) and a combined-findings-shape
assertion.

Regression check — `bun test agents/qa/karan/ agents/tilotma/`:
```
bun test v1.3.14 (0d9b296a)

 7 pass
 0 fail
 8 expect() calls
Ran 7 tests across 2 files. [265.00ms]
```

Full `pipeline/orchestrator/` suite (all 8 stage files including the new one):
```
bun test v1.3.14 (0d9b296a)

 55 pass
 0 fail
 87 expect() calls
Ran 55 tests across 10 files. [633.00ms]
```
(Re-ran after the git-recovery incident below to confirm nothing was lost.)

`pipeline`'s `bun run typecheck` shows a handful of pre-existing errors in
`agents/tilotma/src/orchestrator.ts` and `packages/agent-runtime/src/*`
(unrelated `ModelId | undefined`, `ToolResult` index-signature, and
`spawnSync` argument-typing issues) — none reference
`stage5-adversarial-qa.ts`. Confirmed via `grep -i stage5` on the typecheck
output: zero matches.

## Commit

`0986c35` — "feat: complete Stage 5 orchestration - Navya/Karan/Deepika
parallel QA + fault isolation + Tier 3 review"

Files: `pipeline/orchestrator/stages/stage5-adversarial-qa.ts`,
`pipeline/orchestrator/stages/stage5-adversarial-qa.test.ts` (exactly as
specified — nothing else was modified in the final commit).

## Concerns

1. **`collectCode()` is untested by design.** It walks
   `stage4Result.backendOutputDir`/`frontendOutputDir` on disk to build the
   `code` string the real `run(projectId, iteration, code)` calls need. It's
   only reachable from the real entry point `runStage5` (never from
   `runStage5WithAgents`, which is all the test file exercises), so it
   carries the same "real I/O, not unit-tested" status as Riya's real docker
   deploy call in `stage6-deployment.ts`. It fails soft (try/catch around
   `readdirSync`/`statSync`/`readFileSync`, skips unreadable entries) rather
   than throwing, and caps output at 200k chars.

2. **A near-miss git incident during verification, self-corrected.** While
   trying to diff typecheck output against a clean checkout, I ran `git
   stash && ... && git stash pop`. The `stash` step found nothing to stash
   (only untracked files existed) and printed "No local changes to save",
   but `git stash pop` still popped a **pre-existing, unrelated stash**
   (`stash@{0}: WIP on feat/nexsidi-pipeline-v2`) left over from an earlier
   session, causing a merge conflict in `packages/llm-client/src/nim.ts` and
   staging unrelated changes to two `apps/web` files. I caught this
   immediately via `git status`/`git stash list`, confirmed the old stash
   was still preserved in the stash list (pop aborts cleanly on conflict
   without dropping the stash entry), and ran `git reset --hard HEAD` to
   discard the wrongly-applied changes — this only touches tracked files, so
   my new untracked stage5 files were never at risk. Verified afterward:
   `git stash list` still shows exactly the one pre-existing entry, `git
   status` shows only my two new files (plus pre-existing untracked report
   files from earlier tasks), and the full test suite still passes. That old
   stash was not created by me and is unrelated to this task — left as-is
   for whoever owns it.

3. **Navya/Deepika `file`-less findings** (see reconciliation section above)
   mean fault isolation is only reliably precise when Karan is the one who
   fails. This is inherent to their current real type, not something Stage 5
   can fix unilaterally — flagged for whoever next touches Navya/Deepika's
   TODO parsing stub.
