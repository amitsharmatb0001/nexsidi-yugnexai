# Evidence Only — remove guesswork from the whole system

> **For agentic workers:** implement task by task, tests first. Steps use
> checkbox (- [ ]) syntax.

**Goal:** every decision in the pipeline rests on a fact the system can show —
the actual code, the running app, the user's requirements and approvals, the
locked spec, or research with sources. Where no fact exists, the system says
"not checked" or asks; it never fills the gap with a guess.

**Why (Ledgerly benchmark run 4, 3 Oct 2026):**
- The colour check read the wrong theme variables, saw nothing, and reported
  "colours missing" on a site that showed them exactly. The frontend builder
  then "fixed" a correct theme. Nobody checked the finding.
- The security and performance reviews returned zero findings while their
  model calls were failing; a review that stops early with no findings counts
  as a clean 100/100.
- The deploy agent guessed at an app bug and edited another agent's migration.

## The rule (applies to every agent and every check)

1. **A claim needs evidence.** A finding, a pass, a dispute or a decision
   carries what it rests on: a file and the exact lines, a request and the
   response, a command and its output, a screenshot, the spec or approval
   text, or a research source.
2. **No evidence, no verdict.** A check that could not look returns
   "not checked" with the reason. It is never a pass and never a failure.
3. **Missing input is asked, not invented.** An agent without a fact it needs
   asks (the user, through Tilotma) or reports blocked; it never picks a
   default.
4. **Before acting on someone else's claim, confirm it.** A builder confirms a
   finding before fixing it, and can dispute it with evidence.
5. **Tilotma settles disputes with her own tools** — she is the only agent
   that sees everything.

## Inventory — every place found that guesses today, and its fix

| # | Where | Guess today | Fix |
|---|---|---|---|
| 1 | Builders' fix tasks (Shubham, Aanya, Pranav `buildFixTask`) | Findings are given as "ISSUES TO FIX"; no way to say a finding is wrong | First step: reproduce/confirm each finding. New `dispute_finding` tool (finding, what was checked, what was seen). Disputed findings are not changed |
| 2 | Disputes | Nowhere to go | Tilotma re-checks each dispute with browser / DB / code tools; real → back to the builder with her evidence; false → dropped, does not block delivery, recorded as a checker or reviewer mistake |
| 3 | Stage 5 debate (`stage5-qa-fix-loop.ts`) | Judges a finding from its wording alone ("you cannot open the file") | Replaced by an evidence check: the cited file and lines are read and must say what the finding claims; a finding whose evidence doesn't match goes to Tilotma, not to a builder |
| 4 | Reviewer submissions (Navya, Karan, Deepika `submit_findings`) | A finding without file/lines or reproduction is accepted; unknown severity becomes MEDIUM | The tool refuses a finding without evidence or without a stated severity and tells the reviewer what is missing |
| 5 | Reviewer "clean" result (Karan, Deepika, Navya) | Zero findings after running out of steps or never submitting = 100/100 pass | A clean result needs a coverage record (files read, endpoints exercised). Out of steps / no submit / model failures = "review incomplete", which blocks like a failure and is shown to Tilotma with the reason |
| 6 | Automatic checks that fail open (`stage6-deployment.ts` spec / stack conformance, `spec-compliance.ts`) | "Could not run — skipping" = pass | Result becomes "not checked" with the reason; delivery cannot be called complete while a required check is "not checked" |
| 7 | Checks that read nothing (colour check "found: none") | Reading zero values = the app is wrong | Zero values read = "not checked: could not read the theme"; the check also reports what it did read |
| 8 | Deploy test data (`realisticValueFor` in Riya) | Field formats guessed from field names (gstin, phone…) | Values come from the API contract's declared field formats (the contract states each field's format, from the spec); the app's own validation message is the second source; no name-based table |
| 9 | Deploy error owner (`deployErrorsToFindings`) | Owner picked by matching error text | Owner is the agent that owns the failing endpoint in the contract; the finding carries the request, response and log lines |
| 10 | Planner questions in the benchmark harness (my gatekeeper script) | Every question answered "Use your best judgement" | Answers come from the benchmark's written brief; a question the brief does not answer is shown to Amit, not auto-answered |
| 11 | Agent instructions that say to use a default when something is missing (e.g. Shubham "use a sensible default" for a missing secret) | Picks a value | Report blocked / ask; secrets come from the system's own generated config |

## Tasks (each: failing test first, then code, then live check)

- [ ] **T1 — Evidence on every finding.** `submit_findings` (qa-loop.ts) refuses findings without file+lines or reproduction and without severity; remove the MEDIUM default in Karan/Deepika parsers.
- [ ] **T2 — "Review incomplete" is not a pass.** Karan/Deepika/Navya: steps exhausted, no submit, or model failures with zero findings → incomplete (blocks, reason shown). A clean pass carries a coverage record.
- [ ] **T3 — "Not checked" result.** New third state for automatic checks; fail-open branches and zero-read checks return it; delivery summary and Tilotma see it; a required check that is "not checked" blocks "delivered".
- [ ] **T4 — Evidence check replaces the text-only debate.** Read the cited lines; match → builder; mismatch → Tilotma.
- [ ] **T5 — Builders confirm before fixing; `dispute_finding` tool.** All three builders' fix tasks and loops; disputes returned in the fix result.
- [ ] **T6 — Tilotma settles disputes.** Stage 5 and Stage 6 send disputes to Tilotma's tool-using review; outcome recorded (instinct memory for checker/reviewer mistakes).
- [ ] **T7 — Test data from the contract.** Arjun's contract carries field formats from the spec; Riya builds payloads from them; name table removed.
- [ ] **T8 — Deploy error owner from the contract.**
- [ ] **T9 — Instructions: missing input → ask or report blocked.** Sweep every skill file for "default"/"sensible"/"assume"-style permissions and replace them.
- [ ] **T10 — Benchmark harness answers from the brief.** Gatekeeper reads a written answer sheet; anything else waits for Amit.

## Proof (live, not just tests)

- A deliberately false finding (e.g. the run 4 colour finding replayed) is
  disputed by the builder with evidence and dropped by Tilotma — no code change.
- A reviewer forced to run out of steps produces "review incomplete", not 100.
- The colour check with an unreadable theme reports "not checked".
- A new Ledgerly run: every finding in the log has evidence attached; no
  "best judgement" answers in the planner transcript.
