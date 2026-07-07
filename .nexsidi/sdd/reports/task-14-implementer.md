# Task 14 Implementer Report

Status: DONE

## What I did
Applied Karan's proven parse-and-score pattern (Task 9) to Navya (`agents/qa/navya/src/index.ts`) and
Deepika (`agents/qa/deepika/src/index.ts`), which previously called `agentChat(...)` for real but discarded
the response, hardcoding `score = 100, findings: []` — a no-op dressed up as a passing QA result. Each file
now has its own `parseAndScoreFindings(content)` (exported for testing, not shared as a module — matches
Karan's precedent of staying local to its own file). `run()` calls it and returns the real result.

## Severity type + file field change
Both `Finding` interfaces changed from `severity: "🔴"|"🟡"|"🟢"|"💡"` to
`severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"`, matching the scoring formula already documented in both
files' own comments/prompts (`Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1)`) — before this
change the severity labels and the formula didn't even match each other. Added `file?: string` to both,
matching Karan's `SecurityFinding.file?`. Confirmed consistent between the two files (identical Finding
shape, identical parse/score logic, only the agent name / prompt wording / synthetic-finding message text
differ).

## Prompt specialization
Read `docs/superpowers/specs/2026-07-01-full-agentic-pipeline-design.md` Stage 5 Tier 2 table for exact
wording:
- **Navya** (logic): "adversarial logic QA engineer... maximize error detection, NOT to confirm correctness
  and NOT to suggest fixes. Hunt specifically for: type inconsistencies, null/undefined references,
  algorithmic flaws (off-by-one, incorrect boundary conditions, wrong operator precedence), race conditions,
  and unreachable code paths."
- **Deepika** (performance): "adversarial performance QA engineer... Hunt specifically for: Big-O complexity
  blowups (nested loops over large collections, quadratic-or-worse algorithms), memory leaks (via allocation
  pattern analysis — unbounded caches, listeners never removed, closures retaining large objects), and N+1
  query patterns or blocking synchronous calls on the hot path."
Both keep the explicit JSON output contract (`{ findings: [{ severity, category, detail, file }] }`) and a
`{ findings: [] }` clean-pass instruction, following Karan's prompt structure as the template.

## Stage 5 integration check
Read `pipeline/orchestrator/stages/stage5-adversarial-qa.ts` in full. `navyaFindingToFinding` and
`deepikaFindingToFinding` previously hardcoded `file: ""` (with a comment explaining Navya/Deepika's
Finding type carried no file path, so their failures always fell through `identifyFaultAgent`'s "shubham"
default). Updated both to `file: f.file ?? ""` now that the field exists, same pattern already used by
`karanFindingToFinding`. `identifyFaultAgent` (in `stage4-multi-agent-dev.ts`) needed no change — it already
reads `findings[0]?.file` generically by prefix (`backend/`/`frontend/`/`db/`), so it now naturally
fault-isolates Navya/Deepika findings too when the model supplies a file path.

Updated `stage5-adversarial-qa.test.ts`: replaced emoji severities in existing stub `Finding` objects with
CRITICAL/HIGH/MEDIUM/LOW (types would no longer compile otherwise), updated the "combined findings" test's
expected `issue` string accordingly, renamed/clarified the "no file info in their real Finding type" test
(that premise is no longer true — file now exists but can still be omitted by the model) to
"...when the model omits a file path", and added two new tests proving the actual fix: a Navya finding with
a `frontend/` path routes to `aanya`, and a Deepika finding with a `backend/` path routes to `shubham`.

## Test output

```
$ bun test agents/qa/navya/ agents/qa/deepika/
 18 pass
 0 fail
 40 expect() calls
Ran 18 tests across 2 files. [39.00ms]

$ bun test pipeline/orchestrator/ packages/agent-runtime/ packages/context-chain/ agents/qa/ agents/tilotma/ agents/riya/ agents/generators/
 96 pass
 0 fail
 172 expect() calls
Ran 96 tests across 18 files. [683.00ms]
```

Also ran `bunx tsc --noEmit -p pipeline/tsconfig.json` (covers `agents/**` + `pipeline/**`, this repo's
strictest relevant tsconfig, `noUncheckedIndexedAccess: true`). Found and fixed two new-test-only issues:
`result.findings[0].severity`/`.file` needed a `!` non-null assertion (array index access under
`noUncheckedIndexedAccess`, no existing precedent for `?.` chaining in this codebase's test style) — fixed
in both new test files. Remaining tsc errors on that run (`agents/tilotma/src/orchestrator.ts`,
`packages/agent-runtime/src/loop.ts`, `packages/agent-runtime/src/tools/command.ts`) are pre-existing,
untouched by this task — confirmed via `git status` that only the 6 files in this task's commit are modified
in the working tree.

## Commit
9e21927

## Concerns (if any)
- On JSON parse failure I return `score: 0` unconditionally rather than running the synthetic CRITICAL
  finding through the normal weighted formula — a single CRITICAL finding under the normal formula only
  costs -20 (score 80), which would still "pass" the ≥85 threshold and defeat the point of D25 default-FAIL.
  The task brief says "return a synthetic CRITICAL finding (score 0, not passed)" which I read as score
  being pinned to 0 directly, not derived from the formula with one CRITICAL finding — flagging this
  interpretation explicitly since it's a deliberate deviation from "always compute score from findings."
- Stage 5's `navyaFindingToFinding`/`deepikaFindingToFinding` still only ever look at `findings[0]` via
  `identifyFaultAgent` (pre-existing behavior, not changed by this task) — if a real response has multiple
  findings across different files, only the first one's file path drives fault isolation. Out of scope for
  this task (identifyFaultAgent itself wasn't touched), noting for visibility.
