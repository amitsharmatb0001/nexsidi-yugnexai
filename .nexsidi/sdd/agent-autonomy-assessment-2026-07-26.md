# Agent autonomy assessment — why agents behave as prompt-workers, not engineers
## 2026-07-26. Every finding cites file:line and was verified against running code.

Triggered by: `complex1` (Greenway Estates) hitting a genuine stuck-state after 6 QA
fix rounds on 3 real bugs (2 TOCTOU races, 1 hardcoded JWT fallback). Root-cause
question asked: why can't the agents fix them?

Answer: with one exception (F8), **none of this is a model-capability limit.** It is
harness design. Every generator is handed a bug report with no spec, no contract, no
schema, and an explicit instruction not to look around — then judged for not thinking
holistically.

---

## F1 — The fix prompt explicitly forbids root-cause work

`agents/generators/shubham/src/index.ts:169` and
`agents/generators/aanya/src/index.ts:135`, verbatim in both:

> "Fix ONLY these specific issues — do not rewrite unrelated files, do not refactor
> working code that wasn't flagged."

This is an instruction to point-fix. When QA reports "line 46 races," the agent is
forbidden by its own prompt from redesigning the locking strategy across the file.
It did exactly what it was told.

**Live proof:** across 6 rounds Shubham fixed 3 *different, real* sub-bugs in
`applicationsController.ts` — added the missing availability check, then added
`SELECT ... FOR UPDATE` on the approve path, then added
`pg_advisory_xact_lock(user_id, property_id)`. Each was a correct point-fix for that
round's complaint. It never unified them, so a 4th angle remained: the availability
check still runs on the unlocked pool *before* the transaction opens, and the advisory
lock is keyed on `(user_id, property_id)` so it only blocks the same tenant applying
twice — not two different tenants racing on the same property.

## F2 — Fix runs are system-blind: the spec/contract/schema are dropped

Compare the two prompts for the same agent:

| Context | Generation (`buildAgentTask`, shubham:446) | Fix (`buildFixTask`, shubham:168) |
|---|---|---|
| Project name + description | ✅ | ❌ |
| Full API contract | ✅ | ❌ |
| DB schema (exact tables/columns) | ✅ | ❌ |
| Shared types | ✅ | ❌ |
| File manifest | ✅ | ❌ |
| QA findings | — | ✅ (only this) |

`runFix(plan, findings)` at shubham:181 **does receive `plan`** — it is used solely for
`getOutputDir(plan.projectId)` to locate the folder. The prompt call at line 194 is
`buildFixTask(findings)`: the plan is never passed through.

Identical in Aanya (`aanya:147`/`aanya:160`). Pranav's fix path
(`pranav:68`) receives only `readExistingSchema(outputDir)` + findings — no plan either.

**Consequence, proven live:** the correct fix for both `complex1` races is a DB
`UNIQUE` constraint on `(user_id, property_id)`. Shubham was never shown the schema
during any fix round, so it could not see the constraint was missing — and kept writing
application-level locks that cannot close a gap only a DB constraint closes.
QA itself said so in round 5 (worker log): *"Because the DB table lacks a unique
constraint on (user_id, property_id), querying for rows that do not exist yet locks
nothing (no gap locking)."* Shubham could not act on that: it cannot see or edit the schema.

## F3 — Rigid path-based ownership; no cross-layer escalation exists

`pipeline/orchestrator/stages/stage4-multi-agent-dev.ts:62-67`:

```ts
function agentForFile(file: string): string {
  if (file.startsWith("backend/"))  return "shubham";
  if (file.startsWith("frontend/")) return "aanya";
  if (file.startsWith("db/"))       return "pranav";
  return "shubham"; // fallback
}
```

Routing is purely the file path the QA agent happened to cite. A finding whose correct
fix lives in another agent's layer can never reach that agent, and no agent has any
mechanism to say "this isn't mine — it belongs to Pranav." The `applicationsController.ts`
race was routed to Shubham on all 6 rounds. It was never once routable to Pranav.

## F4 — Nobody owns the system, so the schema silently forked

`complex1` contains **two competing schemas**:
- `db/migrations/0000_initial.sql` — Pranav's (the one `docker-compose.yml` mounts to
  `/docker-entrypoint-initdb.d`, verified in `simple1`)
- `backend/init.sql` — Shubham wrote its own

Nothing detected the duplication. Worse, QA reviewed `backend/init.sql` (repeatedly
flagging missing indexes on it) and, per F3, routed those findings to Shubham — while
the schema the database actually loads is Pranav's. `simple1` has only `db/migrations`,
so this drift is nondeterministic across builds.

## F5 — QA is spec-blind

`agents/qa/navya/src/index.ts:147` (`QA_SYSTEM_PROMPT`) and its Karan/Deepika
equivalents receive: the code, via `read_file`. They receive **no** spec, **no** API
contract, **no** DB schema, **no** app description.

Consequences:
- QA can only pattern-match code. It structurally cannot report "this violates what the
  user asked for" — the highest-value class of finding.
- With no scale/deployment context, it re-flagged missing DB indexes as HIGH on
  *every single round*. The debate step correctly dropped them as false positives every
  time — burning a QA agent's full budget each round to rediscover and re-discard the
  same non-bug.

## F6 — Nothing reconciles the built app against the locked spec

`findMissingLockedPages` (`agents/arjun/src/index.ts:198`) has exactly one call site:
`agents/arjun/src/index.ts:175` — inside Arjun, at planning time, checking the *plan*
covers the locked pages. There is no post-build reconciliation anywhere in
`pipeline/workflows/project-build.ts`. Nothing ever asks "did we actually build what
the user asked for?" after code exists.

## F7 — Learned instincts are written during fixes but never read during fixes

`loadKnownMistakesPrefix()` (`shubham:62`, `aanya:22`) queries recorded instincts and
prefixes them to the system prompt — but it is called only from `run()` (generation).
`runFix()` (shubham:181, aanya:147) passes the raw `SHUBHAM_AGENT_SYSTEM_PROMPT` with
no instinct prefix.

So Patent Claim 2's memory is *written* by the fix loop
(`stage5-qa-fix-loop.ts:265` calls `recordInstincts`) and never *read* by it. The loop
that most needs "you already made this mistake" is the one place it's absent.

## F8 — Correction to an earlier claim: memory exists, the instruction overrides it

Earlier in this session I stated the agents had no cross-round memory. That was wrong.
`gemini-loop.ts:134-141` loads prior conversation history per `(projectId, agentName)`,
and `COMPACTION_THRESHOLD_TOKENS = 750_000` (gemini-loop.ts:59) while these runs peaked
near 85k — so nothing was dropped. Shubham **had** its previous rounds in context.

This makes the finding sharper, not weaker: it could see it had already edited
`jwt.ts` twice, and still oscillated hardcoded → random → hardcoded, because F1's
per-round instruction reframes every round as an isolated ticket. The instruction
dominates the memory.

## F9 — Every "visual" QA agent is structurally blind to what it screenshots

`packages/agent-runtime/src/tools/browser.ts:61-65` — `browser_screenshot` writes the
PNG to disk and returns the string `"Screenshot saved to <path>"`. The image bytes are
never returned. A repo-wide search for any path that reads a screenshot back and
attaches it as image content to the next model call returns **zero results** in both
`loop.ts` and `gemini-loop.ts`.

So the Tier-3 Evidence Collector, the Reality Checker, and the System-B Live Evaluator
all take screenshots as a matter of record and **no model ever sees one**. Their actual
inputs are `browser_get_text()` (DOM text) and `browser_console_errors()` (JS errors).

**Live proof (`simple1`, delivered):** the shipped site renders corrupted glyphs
sitewide — nav reads "Meñu"/"Sıqn In", the sign-in form reads "Eฟall" for "Email". All
three visual agents passed it; System B scored it 7.47/10. Root cause found via network
inspection: the vendored NexUI library ships a second, unbundled `@font-face` source
(`frontend/vendor/nexui/src/assets/typography.ts:21`, whose own header comment says
*"Next.js: copy packages/nexui/fonts/ to public/nexui-fonts/ and update the paths
below"* — a manual step nobody performs), so `/fonts/NexuiSans-*.woff2` 404s while the
Next-bundled copy loads. A font 404 produces **no console error**, and the DOM text is
the correct string "Email" — so every signal these agents can see was clean.

Two defects, one gap: (a) the vendoring step is unwired, and (b) no visual agent can
see pixels or network failures, so this class of bug is undetectable by design.

---

## Summary

| # | Finding | Type |
|---|---|---|
| F1 | Fix prompt forbids refactoring/root-cause work | Prompt |
| F2 | Fix runs get no spec/contract/schema (generation does) | Wiring |
| F3 | Path-based ownership, no cross-layer escalation | Architecture |
| F4 | No system owner → duplicate competing schemas | Architecture |
| F5 | QA has no spec — can't check intent, re-flags same false positives | Wiring |
| F6 | No post-build spec reconciliation | Missing stage |
| F7 | Instincts written by fix loop, never read by it | Wiring |
| F8 | Memory present but overridden by per-round instruction | Prompt |
| F9 | Screenshots never reach any model; no network-failure check | Wiring |

Eight of nine are harness defects we authored. None require a better model.
