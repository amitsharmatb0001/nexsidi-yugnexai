# Adaptive Requirements Gathering + Full CRUD Verification — Design

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.

**Goal:** Stop Saanvi from guessing business scope, and stop QA from only
verifying one lucky endpoint's data flow.

**Architecture:** Two independently-buildable pieces plus one small,
already-root-caused fix, delivered in the same design because they share
one root cause: the pipeline currently defaults to filling gaps with
plausible-sounding assumptions instead of either asking the user or
actually verifying the result.

**Tech Stack:** No new dependencies. Extends existing agents
(`agents/saanvi`, `agents/riya`, `agents/generators/aanya`) and the
existing Temporal clarification-signal mechanism
(`pipeline/workflows/project-build.ts`'s `answerClarificationSignal`).

## Global Constraints

- Every table still requires `id`/`created_at`/`updated_at` per Saanvi's
  existing DATABASE RULES — unchanged.
- No new agent — the "business management" area (if a request needs one)
  is built by the same Aanya/Shubham/Pranav generation pipeline as
  everything else, planned by Arjun like any other feature.
- Confidentiality rule (no NexSidi/agent internals in user-facing text)
  is unaffected — this design only touches pre-production requirements
  gathering and post-deploy verification, not what ships to end users.
- Real business material the user provides (documents, a short vision
  statement) must be used verbatim as grounding, never discarded in
  favor of an invented substitute — this is the direct fix for the
  Northgate/meridianbk4-class "fabricated business identity" bug already
  documented in `agents/saanvi/src/index.ts`.

---

## Part A — Saanvi: adaptive, multi-round requirements gathering

### Problem (confirmed live, this session)

`agents/saanvi/src/index.ts`'s `SAANVI_SYSTEM_PROMPT` is single-shot:
either it asks up to 3 questions once (`needsClarification`) or commits to
a full spec immediately, and its own explicit instruction is to fill
gaps ambitiously rather than ask. That produced, on meridianbk4:

- Hardcoded dummy product/service data (`db/migrations/0000_initial.sql`'s
  `INSERT INTO services/products`) instead of the business's real catalog.
- No question about whether the business wants to manage its own data
  after launch — so no admin/management area was ever planned, and the
  `contact_messages` table has zero consuming routes anywhere.
- No question about how a service business wants pricing shown (public
  price list vs. contact-for-quote) — Saanvi picked one silently.
- No path for the user to hand over real material (existing site content,
  brand documents, a price list) even though the prompt already claims to
  ask about it ("Do you have ... reference documents I should match?")
  — nothing downstream can actually accept or use an attachment today.

### Goals

1. Classify what kind of build this is from the user's own words — not a
   fixed enum, a genuine read of what THIS request implies (does it
   involve selling something, booking something, just informing people,
   some combination). This classification exists only to decide what to
   ask next, not to select from a fixed template.
2. Ask targeted, scope-defining questions — genuinely multi-round, not
   capped at one round of ≤3 — until nothing structurally important
   (something that changes what gets built) is being guessed. Purely
   cosmetic gaps (exact copy, exact colors) stay fill-in-ambitiously per
   the existing rule — this doesn't relitigate that part.
3. Accept and use real user-provided material: uploaded documents or
   pasted reference content get extracted (existing Layer 2 file-handling
   pipeline: virus scan → MIME verify → text extract → trust wrapper) and
   fed into the SAME requirements reasoning as the text prompt — not a
   parallel, ignored path.
4. A short user-written vision gets enriched into a full one — additive
   grounding (their words, their named specifics, their tone) never
   silently replaced by invented generic content.
5. Explicitly ask whether the business wants to self-manage their data
   after launch (products, services, pricing, bookings, submitted
   messages). This is what decides whether a management area is planned
   at all, and what it needs to contain — never a hardcoded default.
6. Restate the understood scope in plain language before locking the
   spec, so the user can catch a misread before Arjun/generation starts.

### Mechanism

- Replace the current one-shot `gatherRequirements` return shape
  (`{status: "spec", ...} | {status: "needs_clarification", questions}`)
  with a loop-friendly shape:
  ```typescript
  type RequirementsResult =
    | { status: "needs_more_info"; questions: string[]; understoodSoFar: string }
    | { status: "ready_to_confirm"; summary: string; spec: ProjectSpec }
    | { status: "locked"; spec: ProjectSpec };
  ```
  `understoodSoFar` and `summary` exist specifically so the human-facing
  side of the conversation (Tilotma/the pipeline UI) can show the user
  what's been understood at every round, not just at the end.
- The actual multi-turn conversation with the human runs through the
  Temporal workflow's existing clarification signal
  (`answerClarificationSignal`) — that mechanism already exists and
  already pauses the workflow for a real human answer; it just needs to
  be called in a loop (until `status !== "needs_more_info"`) instead of
  once.
- Attachments: accept file uploads or pasted reference content alongside
  the text prompt at the same intake point Saanvi already reads from.
  Extracted text is appended to the reasoning context exactly like a
  clarification answer — no separate, easy-to-ignore code path.
- The "does the business want to self-manage data" question is not
  optional boilerplate — its answer is a real spec field
  (`needsManagementArea: boolean`, plus which entities if yes) that Arjun
  reads to decide whether to plan management pages at all. Saying "no, a
  developer will always update this for me" is a completely valid answer
  that means no management area gets built — this must not default to
  "always build it" any more than it should default to "never build it."

### Testing approach

- The classification/question-generation DECISION logic — what to ask,
  when enough is known, how to merge an attachment's extracted text into
  the reasoning — is pure and DI-testable the same way the rest of this
  file already is (`SaanviDeps`-style injected stubs, no live LLM calls
  in tests).
- The actual multi-turn LLM conversation itself is not unit-testable,
  matching this codebase's own stated convention for every other live-LLM
  path in this pipeline — verified live, same as Navya/Karan/Deepika.

---

## Part B — Full CRUD data-flow verification, every entity

### Problem (confirmed live, this session)

`agents/riya/src/index.ts`'s `verifyLiveAuthenticatedRoundTrip` finds
exactly ONE endpoint (`the FIRST auth:true POST with no path param`) and
verifies only that one create call round-trips. Nothing verifies that
EVERY entity's declared CRUD surface actually persists — a form
submission for any entity besides that one lucky endpoint could silently
go nowhere and nothing in the current pipeline would catch it. (The
concrete instance found live tonight: `contact_messages` genuinely does
persist correctly, confirmed by hand — but nothing in the automated
pipeline was checking that; it was checked only because a human asked
where the data went.)

### Goals

For every resource declared in `api-contract.json`'s `endpoints`, not
just the first one found:

1. If a `POST` (create) endpoint exists: create a record, then verify via
   real `db_query` that the row genuinely exists — not just that the HTTP
   call returned 2xx.
2. If a `GET` (list or by-id) endpoint exists: verify the created record
   is actually retrievable through it.
3. If a `PUT`/`PATCH` (update) endpoint exists: change a field, then
   verify via `db_query` that the DB row actually changed.
4. If a `DELETE` endpoint exists: delete the record, then verify via
   `db_query` that the row is actually gone.

Any step that fails is a real, specific, per-resource finding — not a
single pass/fail for "the deploy," so a broken `PATCH` on one resource
doesn't get conflated with a working `POST` on another.

### Mechanism

- Group `api-contract.json`'s `endpoints` by resource (same grouping
  `resolveForeignKeyId` already does by stripping `_id`/pluralizing —
  reuse, don't reinvent).
- Generalize tonight's proven pattern (register → login → create → real
  DB check → list → confirm appears) from the single hardcoded resource
  in `verifyLiveAuthenticatedRoundTrip` into a loop over every resource
  group, running the same steps plus update/delete where declared.
- Reuse `verifyDbWriteReadRoundTrip` (already exists, already used once
  per deploy for an arbitrary "roundTripTable") per-resource instead of
  picking one table for the whole app.
- Reuse `resolveForeignKeyId` for any dependent field a later resource's
  create call needs (e.g. an `appointments` resource needing a real
  `service_id` from the `services` resource this same pass just verified).

### Testing approach

- Same DI-mockable-HTTP-server pattern already proven in
  `agents/riya/src/verify-live-auth.test.ts` — extend the contract fixture
  to declare 2+ resources with different CRUD verbs and assert every one
  gets its own create/read/update/delete check, not just the first.

---

## Folded in — Aanya's hardcoded page-layout example (already root-caused, small)

`agents/generators/aanya/src/index.ts:469-478`'s "LAYOUT PATTERNS" section
gives one literal, copy-pasteable example page skeleton (nav → 1200px
container → `auto-fill` card grid) in every single generation prompt,
regardless of Vanya's actual per-project `layoutConcept`. This is a real,
identified contributor to generated apps converging on the same DOM
structure even when colors/fonts differ.

**Fix:** keep the NexUI component/CSS-variable usage examples (those are
correctly universal), remove the fixed page-skeleton example, and replace
it with an explicit instruction to derive the actual structure from
`plan.designBrief.layoutConcept` for this specific project.

**Testing approach:** source-string check (matches this file's own
established convention for prompt-content assertions) confirming the
fixed skeleton example is gone and the `layoutConcept`-driven instruction
is present.
