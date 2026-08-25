# NexSidi Quality & Architecture Plan — 2026-08-23

> For agentic workers: use nexsidi-subagent-dev (preferred) or nexsidi-planning
> execute mode to implement task-by-task. Checkboxes track progress.

**Goal:** Close the gap between what NexSidi generates today and a real
company website (calibrated against yugnex.com, read in full this session)
— and fix the process gaps that let bugs reach delivery undetected.

**Why now:** Everything below is root-caused from this session's actual
findings, not speculation — each workstream cites the real bug or gap that
motivated it.

---

## Workstream 1 — Real skills architecture for generator agents

**Root cause:** `packages/agent-runtime/skills/*.md` (aanya.md, arjun.md,
pranav.md, ...) already exists, written exactly like a real skill system —
but is never loaded by any runtime code. Zero references outside one code
comment. The actual prompts agents receive are giant inline template-literal
strings in each `index.ts`, which is where every fix this session had to go.
`aanya.md` is also stale and factually wrong (`<NexuiProvider>`, a component
that no longer exists) — proof the dead file already drifted from reality.

- [ ] Design how an agent decides which skill(s) to load for a given task
      (task-type routing, e.g. "building a public form" loads a
      `public-forms.md` skill; "building a comparison/pillar page" loads a
      `content-patterns.md` skill) instead of one monolithic always-on prompt
- [ ] Wire real loading: replace the giant inline prompt strings in
      `agents/generators/{aanya,arjun,pranav,shubham}/src/index.ts` with
      composed skill-file reads
- [ ] Delete or rewrite every stale skill file so it matches current reality
      (start with aanya.md's NexuiProvider reference)
- [ ] Turn every fix from this session into its own skill file instead of a
      comment buried in a 1300-line index.ts: public-forms auth pattern,
      role-gated middleware, mandatory Header/Footer wiring, reference-format
      normalization
- [ ] Add a lint/CI check that fails if a skill file references a symbol/
      component that no longer exists in the codebase (closes the drift class
      that produced the NexuiProvider bug)

## Workstream 2 — Clarifying questions that actually get answered

**Root cause:** the planner asked "match existing site, or fresh design?" —
the UI offered only a choice, no follow-up field for the URL a "match
existing site" answer obviously requires. The user picked it, was never
asked for a link, and the build proceeded on a provisional fallback design.

- [ ] Audit every `ask_user` question in `agents/planner/src/index.ts` for a
      choice that implies required follow-up data (e.g. "match_site" → needs
      a URL; "have brand assets" → needs a file/link) and is missing it today
- [ ] Add a real follow-up field (URL input, file reference) directly in the
      elicitation widget when the selected option requires one — not a
      second freeform chat turn the user has to think to provide unprompted
- [ ] The planner must not treat the question as answered until the required
      follow-up is present — no silent fallback-and-proceed path

## Workstream 3 — UI preview before build, and a real edit loop after

**Root cause, two related gaps confirmed this session:**
1. The spec-approval screen shows pages/API/DB/design-tokens as *text* —
   never a visual mockup. You approve a description of a design, never a
   picture of it.
2. Once a project reaches `status: done`, there is no chat composer, no
   "request changes" route, nothing — if you don't like the result, there is
   currently no way back in. (The "Approve with changes" bug fixed today
   only covers the *pre-build* gate.)

- [ ] Design a real pre-build visual preview step — at minimum, a rendered
      static mockup of the landing page using the locked design tokens
      (palette, typography, layout concept) before code generation starts
- [ ] Design a post-delivery edit path: a real composer on a `done` project
      that can submit a change request, re-open the pipeline at the right
      stage (targeted regeneration, not a full rebuild), and re-verify
      before re-marking `done`
- [ ] Reuse the now-working reject-and-redo signal plumbing
      (`approveSpecSignal` with attached feedback, fixed today) as the
      pattern for this — same idea, new entry point

## Workstream 4 — Match real company-website depth (calibrated against yugnex.com)

**Root cause:** confirmed live, page-by-page, against a real 15-page
production site. The structural gap isn't prompt wording — it's that
nothing *requires* the output categories or content depth a real site has.

- [ ] Make `not-found.tsx`, `error.tsx`, an `ErrorBoundary`, and a real
      favicon/icon a **required** scaffold output (same pattern as this
      session's Header/Footer fix — deterministic, gated by the existing
      `next build` check) — confirmed today: the generated app had zero of
      these; the reference site has all of them
- [ ] Build typed content-schema patterns per page archetype, matching what
      actually works on the reference site: a comparison-table pattern (old
      vs. new), a tabbed pillar/console pattern with per-item detail, a
      timeline/ledger pattern — so distinct pages actually look distinct,
      instead of one repeated card-grid template
- [ ] Separate content from presentation the way the reference site does
      (`content/{locale}/page.ts` typed objects feeding a component) — even
      for a single-language project, this is the structural pattern that
      makes "distinct page identity" enforceable rather than aspirational
- [ ] Require real specificity in copy (named comparisons, real metrics,
      real founder/company facts pulled from the spec/context) over generic
      section text — tie this to Workstream 5, since specificity requires
      real source material

## Workstream 5 — Read what the user actually gives it (brochure/doc upload)

**Root cause:** the Context panel's "Add files" is a disabled "Soon" stub —
confirmed no storage, no parsing, nothing reads an uploaded document today.
Directly blocks Workstream 4's "real specificity" requirement — there's no
source of real company facts to pull from besides the typed context field.

- [ ] Real file upload (company brochure/profile, logo image, etc.) in the
      Context panel, with actual storage
- [ ] Parse uploaded documents for extractable facts — company name, logo,
      services, address, contact details — surfaced to the planner/spec step
- [ ] If a logo image is present, use it directly; if not, generate one and
      say so honestly (matches the existing "Soon" tag discipline — never
      silently fabricate)

## Workstream 6 — Smaller, already in motion

- [x] Header/Footer required + wired (done this session)
- [x] Role-gated admin middleware, generic + safe for role-less apps (done)
- [x] Public-form auth pattern (auth=false + nullable user_id + name/email)
      (done)
- [x] Reference-format normalization in Pranav's schema generator (done)
- [x] Approve-with-changes signal plumbing, pre-build gate only (done)
- [ ] Verify your own site's `/ip`, `/privacy`, `/terms` — all three
      rendered empty in this session's automated browser (`ERR_BLOCKED_BY_CLIENT`
      in console). Unconfirmed whether this is a real production bug or
      specific to the tooling used to check it — needs a human look, not
      assumed either way.

---

## Sequencing note

Workstream 1 (real skills) is foundational to doing 2–5 well — every other
workstream currently means editing more giant inline prompt strings, the
exact pattern being replaced. Recommend Workstream 1 first, even though it
delivers no visible output on its own, so 2–5 land in the right place from
the start rather than needing a second migration later.
