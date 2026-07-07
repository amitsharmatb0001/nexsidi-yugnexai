# Task 9 Review

Verdict: APPROVED

## Spec compliance

`scoreSecurityFindings` in `agents/qa/karan/src/index.ts` (lines 40-52) matches the plan's Step 3
implementation verbatim:

```ts
export function scoreSecurityFindings(findings: SecurityFinding[]): { pass: boolean; reason: string } {
  if (findings.length === 0) {
    return { pass: true, reason: "No vulnerabilities found" };
  }
  return { pass: false, reason: `${findings.length} vulnerabilit${findings.length === 1 ? "y" : "ies"} found — zero-tolerance policy blocks any finding` };
}
```

- Zero findings → `pass: true`. Any finding, of any severity → `pass: false`. The function never
  inspects `severity` at all — it branches purely on `findings.length === 0`, so there is no way for
  severity to influence the outcome. This is correct zero-tolerance semantics and correctly separate
  from Navya/Deepika's `>=85` severity-weighted score (Global Constraint honored — the two scoring
  systems are not mixed; `scoreSecurityFindings` doesn't touch or reference the `100 - CRITICAL*20...`
  formula at all).
- `scoring.test.ts` matches the plan's Step 1 test file verbatim (byte-for-byte), so there's no drift
  between spec and implementation.

## Test verification

Ran it myself:

```
$ bun test agents/qa/karan/src/scoring.test.ts
bun test v1.3.14 (0d9b296a)

 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [108.00ms]
```

All 3 tests pass (zero findings passes, single LOW-severity finding still fails, multiple findings of
mixed severity fail with count "2" in the reason string).

## Findings

**None found in Task 9's own scope.** Specifically:

1. **Existing code untouched** — confirmed via `git diff 31b8a65^:agents/qa/karan/src/index.ts` vs the
   new version: the entire diff is a pure append (`git show --stat` reports `14 insertions(+)`, `0
   deletions(-)` for `index.ts`). Lines 1-38 (the `QAResult`/`Finding`/`run()`/`QA_SYSTEM_PROMPT`
   pre-existing code) are byte-identical before and after. Nothing pre-existing was altered or removed.

2. **No off-by-one / logic bug** — the branch is `findings.length === 0` (pass) vs. the implicit else
   (fail), not `> 0`/`>= 1` reasoning that could hide an edge case. There is no path where exactly 1
   finding accidentally passes; verified both by reading the code and by the "single LOW-severity
   finding still fails" test actually passing.

3. **No literal type-naming collision** — `SecurityFinding` is a brand-new name; grepping the whole repo
   confirms it doesn't already exist under another name anywhere else (`agents/qa/navya/src/index.ts`
   and `agents/qa/deepika/src/index.ts` only have the pre-existing `Finding` type, not
   `SecurityFinding`). So the implementer didn't create a duplicate of an existing type name.

**One forward-looking risk worth flagging for whoever picks up Task 10** (not a defect in Task 9's
committed diff, so not blocking this task, but real and concrete):

`agents/qa/karan/src/index.ts` now has *two* structurally incompatible "finding" shapes in the same
file:
- `Finding` (pre-existing, line 15-19): `{ severity: "🔴"|"🟡"|"🟢"|"💡"; category: string; detail: string }`
  — used by `QAResult.findings` (System A, severity-weighted).
- `SecurityFinding` (new, line 40-43): `{ severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"; description: string }`
  — used by `scoreSecurityFindings` (zero-tolerance).

Keeping them separate is *correct* per the Global Constraint ("never mix the two scoring systems") and
per the plan's own Task 9 interface note ("new, separate from any existing severity-weighted scorer").
However, the plan's own Task 10 snippet calls `scoreSecurityFindings(karanResult.findings)` where
`karanResult` is Karan's `run()` output — typed as `QAResult` whose `.findings` field is `Finding[]`
(emoji severity, `detail` field), not `SecurityFinding[]` (string-enum severity, `description` field).
As written, that call will not type-check, and there is currently no converter between the two shapes
anywhere in the codebase. `run()` itself still returns `findings: []` unconditionally (line 33, pre-existing
TODO), so nothing exercises this path yet — it's latent, not currently triggered. This needs to be
resolved when Task 10 is implemented (either give `run()` a second, real code path that emits
`SecurityFinding[]`, or add an explicit mapping step before calling `scoreSecurityFindings`). Flagging
this now since the review brief specifically asked me to check for exactly this class of issue.

## Recommendation

Approve Task 9 as committed (31b8a65) — it satisfies the plan's Steps 1-5 exactly, the zero-tolerance
logic is correctly implemented and tested, and no pre-existing code in `index.ts` was touched. Before
starting Task 10, resolve the `Finding` vs `SecurityFinding` shape mismatch described above so the
`scoreSecurityFindings(karanResult.findings)` call in Task 10's Step 3 snippet actually type-checks
against real data.
