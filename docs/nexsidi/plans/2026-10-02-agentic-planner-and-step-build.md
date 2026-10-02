# Agentic planner and phased build — implementation plan

> **For agentic workers:** use nexsidi-subagent-dev (preferred) or nexsidi-planning execute
> mode, task by task. Steps use checkbox (- [ ]) syntax.

**Goal:** NexSidi works like a senior product team: it researches, asks the questions that
matter for this product, suggests what would make it great, and its agents work in phases
so they never burn out and stay focused — no fixed limits on how deep they research or
how many phases a job needs.

**Architecture:** the planner runs a research step in code before it talks to the user,
generates its questions from that research instead of a fixed list, and suggests features
the user ticks. The plan divides the work into phases — as many as the app needs — and
every agent works from those same phases. Each builder handles one phase at a time in a
fresh, focused conversation; each phase is checked and saved before the next; a failure is
retried or reported, never a whole-run loss. The rule pile is then cut to what really
matters, backed by code checks instead of "never" lines.

**Tech stack:** unchanged — Bun + TypeScript, Temporal, Gemini (the planner is already on
gemini-3.1-pro-preview), existing agent loops. **No model changes** (decided by Amit: the
system is the problem, not the model).

## Decided by Amit (2 Oct 2026)
- No model changes.
- No hard-coded limits on agents' work: research time, number of searches, number of
  questions, number of suggestions and number of phases are decided by the agents from what
  the job needs. Safety comes from the run's own time limit and stop-and-save, not from caps.
- Web search: 2 minutes by default; an agent asks for more time when its research needs it.
- Phases are how our agents work, so they do not burn out and stay relevant: a fresh,
  focused conversation per phase. The phases are written in the plan so every agent refers
  to the same ones. A small app gets few phases, a big app as many as it needs.

## Why (evidence from Ledgerly runs 2 and 3, 2 Oct 2026)

| Symptom | Root cause in the system |
|---|---|
| No research | Every web search is cut off at 10 s (`packages/llm-client/src/gemini.ts:715`); a real search takes about 17 s. All 7 searches in run 3 failed. Nobody except the design agent is ever asked to research. |
| Same generic questions every time | `agents/planner/INTAKE_RULES.md` lists the questions word for word ("Who is sign-in for?", "Do you have brand assets?") — written for the Nextech website. |
| Stays in a small box | The same file: "Do NOT add questions purely out of thoroughness", "One round of questions maximum", "Keep responses under 350 words". The requirements skill: "Never add features the brief did not ask for". |
| Agents burn out and lose focus | One builder carries the whole app in one conversation: 10 pages, about 18,000 tokens of rules and every earlier step, in one 90-step attempt with one final judgement. Run 3's frontend spent its last 30 steps on a side problem; runs 2 and 3 both died at step 4. |
| Rules instead of goals | Frontend builder: ~18,000 tokens of rules on every call, 55 "never" lines; backend: ~11,000 tokens before its own prompt. |

## Global constraints
- The user's own rules stay word for word (the Rules section of the plan) — suggestions never override them.
- Nothing is built that the user did not approve: suggested features are built only if ticked.
- Every agent does only its own work; only Tilotma sees everything.
- No hard-coded caps on agents' work (see "Decided by Amit"); the run time limit and stop-and-save bound everything.
- In-house fonts only (Inter, JetBrains Mono); no Google Fonts.
- Tests first for every task; verify live before claiming done.

## Order of work

Five parts, each its own commit, each approvable on its own: **A → B → C → D → E**.
After A–C, benchmark run 4 shows whether it worked.

---

## Part A — Research actually works

### Task A.1: Web search time

**Files:**
- Modify: `packages/llm-client/src/gemini.ts` (geminiWebSearch: default time, no clamp, abort signal)
- Modify: `packages/agent-runtime/src/tools/websearch.ts` (tool default and description)
- Test: `packages/agent-runtime/src/tools/websearch.test.ts`

- Default 2 minutes for a normal search.
- The agent sets its own time for a search (`timeout_ms`) when it needs longer research. No
  ceiling in the tool; the run's time limit and stop-and-save cancellation end a stuck search.
- The tool description tells agents they can ask for more time for deep research.

- [ ] Failing tests (no network): default is 2 minutes; a requested 10 minutes is used as
      given; a cancelled run aborts an in-flight search.
- [ ] Remove the 30 s clamp; default 2 minutes; pass the run's abort signal into the search.
- [ ] Live check: one real search returns sources (measured today: 16.9 s).
- [ ] Commit.

---

## Part B — The planner thinks like a senior product team

### Task B.1: Research before the first question, done in code

Models skip optional tools, so starting the research is not left to the model. How deep
it goes is the model's decision.

**Files:**
- Create: `agents/planner/src/research.ts` — `researchBrief(brief): Promise<ResearchNotes>`
- Modify: `agents/planner/src/index.ts` — run it once per session before the first model
  turn; keep the notes in the session and in the planner's prompt
- Modify: `agents/planner/src/types.ts` — `PlannerState.research?: ResearchNotes`
- Test: `agents/planner/src/research.test.ts`

`researchBrief` is a small research loop on the plan-tier model: it decides what to search
(the domain's rules and regulations, similar products and what their users expect, common
failure points), reads the results, and keeps searching until it has answered what it
needs or decides further searching adds nothing. Then it writes short notes with sources:
must-know rules, features users expect, open questions worth asking the user.

- [ ] Failing tests (search and model injected): research runs before the first `ask_user`,
      once per session; the number of searches is the model's choice (a fake model asking
      for 2 or 9 searches gets exactly that); a failed search is skipped, not fatal; notes
      keep their sources.
- [ ] Implement; the user sees "Researching your product…", then a collapsible "What I
      found" in the chat.
- [ ] Live check: Ledgerly brief → notes cover GST invoice requirements and name similar
      products.

### Task B.2: Questions come from the research, not a template

**Files:**
- Modify: `agents/planner/INTAKE_RULES.md`
- Test: `agents/planner/src/intake-rules.test.ts`

Remove the fixed question list, "One round of questions maximum", "Keep responses under 350
words" and "Do NOT add questions purely out of thoroughness". Replace with:
- Ask every question whose answer changes what gets built and that neither the brief nor
  the research answers — as many as that takes, no more.
- Each question says in one line why it matters ("GST invoices to registered businesses
  must show the buyer's GSTIN — do your clients have one?").
- Options come from the research, not generic choices.
- Widget mechanics stay (ask_user, one question at a time, a recommended option).

- [ ] Failing tests: the rule file no longer contains the fixed question texts or the limits
      above; it requires a "why it matters" line.
- [ ] Rewrite the section.
- [ ] Live check: Ledgerly brief → questions about GST and invoicing, not "who is sign-in for".

### Task B.3: Suggested features the user ticks

**Files:**
- Modify: `agents/planner/src/index.ts` — `propose_plan` gains
  `suggestedFeatures: [{ name, why, size }]`; how many is the planner's call, from what the
  research shows would make this product better
- Modify: `agents/planner/src/types.ts`
- Modify: `apps/web/app/build/[id]/page.tsx` — the plan panel shows them as checkboxes, all
  unticked; Accept sends the ticked ones
- Modify: `apps/api/src/routes/chat.ts` — ticked suggestions join the plan's rules as
  "Also build: …" before `planToUserRequest`
- Modify: `packages/agent-runtime/skills/library/requirements-coverage/SKILL.md` — "Never add
  features the brief did not ask for" becomes "Never build what the user did not approve —
  propose extras as suggested features instead"
- Test: `agents/planner/src/plan-handoff.test.ts`, web page source check

- [ ] Failing tests: schema has suggestedFeatures with no fixed count; unticked suggestions
      never reach the build request; ticked ones do, word for word; the skill line changed.
- [ ] Implement.
- [ ] Live check in the browser: ticking two suggestions puts exactly those two in
      `user-request.txt`.

---

## Part C — Agents work in phases

**Purpose (Amit):** our agents work in a phased way so they do not burn out and stay
relevant. In phases, each agent works on a small, focused piece with a fresh conversation
and only what that piece needs.

### Task C.1: Phases written in the plan

**Files:**
- Modify: `agents/planner/src/index.ts` — `propose_plan` gains
  `buildPhases: [{ name, goal, pages, endpoints, tables }]`; the planner decides how many
  from the app's size
- Modify: `agents/planner/src/types.ts` (ProposedPlan, BuildPlan)
- Modify: `agents/planner/INTAKE_RULES.md` — how to divide: phase 1 is the foundation the
  rest needs (accounts, layout, settings); each later phase is one usable piece of the
  product; size each phase so one agent can build it in one focused session; as many phases
  as the app needs; every page, endpoint and table belongs to exactly one phase
- Modify: `planToUserRequest` — a "Build phases" section; the plan panel shows the phases
- Test: `agents/planner/src/plan-handoff.test.ts`

- [ ] Failing tests: at least one phase, no upper limit; every page, endpoint and table is
      in exactly one phase (a code check sends the plan back to the planner otherwise); the
      build request lists the phases word for word; the panel shows them.
- [ ] Implement.
- [ ] Live check: the Ledgerly plan shows its phases.

### Task C.2: Spec and contract keep the same phases

**Files:**
- Modify: `agents/saanvi/src/index.ts` — each spec feature names its phase
- Modify: `agents/arjun/src/index.ts` — every builder task names its phase and gets a size
  estimate; the contract and schema stay complete for the whole app (a later phase never
  changes an earlier phase's contract)
- Test: their test files

- [ ] Failing tests: every spec feature and builder task has a phase from the plan; an
      unknown or missing phase is rejected; every task has a size estimate.
- [ ] Implement.

### Task C.3: Phase runner

**Files:**
- Create: `pipeline/activities/build-phases.ts` — progress in `<build>/phases.json`
- Modify: `pipeline/workflows/project-build.ts` — the generate stage loops over the phases
- Modify: `pipeline/activities/index.ts`, `agents/generators/{aanya,shubham,pranav}` —
  builders take one phase at a time
- Test: `pipeline/activities/build-phases.test.ts`, workflow test with fakes

For each phase, in order:
1. Skip it if `phases.json` says it is done (resume after a crash or retry).
2. Database, backend and frontend build that phase's tasks, in parallel, each in its own
   folder. Each builder starts a **fresh conversation** for the phase, with only: this
   phase's tasks, the parts of the contract and schema they use, and a short summary of what
   earlier phases built (files, endpoints, components to reuse). Skills are picked for this
   phase's tasks.
3. **Steps are not a fixed number:** each phase's budget comes from its tasks' size
   estimates (C.2). An agent that is still making progress — writing files, checks getting
   better — can ask for more steps; one going in circles is stopped by the existing stuck
   and blocked detectors.
4. The system runs the required checks for each builder.
5. Pass → mark the phase done and save. Fail → the builder retries with the check output;
   if it still fails it reports to Tilotma, the run stops at this phase as "needs review",
   and Retry resumes from this phase, never from the start.
6. After the last phase: compile check, review, deploy and live review on the whole app.

- [ ] Failing tests with fake builders: phases run in order; each builder gets only its
      phase's tasks in a fresh conversation with the earlier-phase summary; the step budget
      follows the size estimates; an agent making progress gets more steps on request, one
      going in circles does not; progress is saved after each phase; a resumed run skips done
      phases; a failing builder retries, then the run stops at that phase with a blocked report.
- [ ] Implement.
- [ ] Live check: a real build shows each phase finishing in the log and on the build page.

---

## Part D — Cut the rule pile

### Task D.1: Audit and cut

**Files:** `packages/agent-runtime/skills/{aanya,shubham,…}/*.md`, `core-reasoning.md`,
`agents/generators/*/src/index.ts` prompt constants.

For every rule: keep (still needed, no code check covers it), move into an on-demand skill
(only some apps need it), or delete (a code check already enforces it, or the bug it
guarded is gone). Each kept "never" line names the real failure it prevents.

- [ ] Measure each builder's assembled prompt before and after (today: frontend ~18,000
      tokens, backend ~11,000); a test keeps it from growing back past the new size.
- [ ] Do the audit; record every removed rule and why in this plan's appendix.
- [ ] Full test suite green; live check in Part E.

---

## Part E — Pipeline self-test before paid runs

### Task E.1: Golden run

**Files:** create `pipeline/selftest.ts`, `docs/nexsidi/selftest-brief.txt`.

A small fixed brief ("a notes app: sign up, sign in, add, edit, delete and search notes")
goes through the whole pipeline with gates auto-approved. Then checks that need no AI:
sign-up and sign-in work; a note can be created, listed, edited and deleted over HTTP and in
the browser; headings render in a real font; no agent touched another agent's folder.
Run it after every system change, before any benchmark run.

- [ ] Failing test: the check functions work against a small fake app.
- [ ] Implement; first live run.
- **Cost:** about $1–2 per run (needs Amit's OK).

---

## Still open for Amit
1. Order A → B → C → D → E?
2. Part E self-test cost, about $1–2 per run?

## Success measure
Benchmark run 4 on the same Ledgerly brief: the planner shows its research and asks
GST-specific questions with reasons; it suggests features; the agents work phase by phase
and the build reaches delivery with 0 interventions; a failed piece is retried or
reported, never fatal.
