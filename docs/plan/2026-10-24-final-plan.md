# NexSidi — final plan (2026-10-24)

The single plan to take to the live server. Every item rests on a measurement from our own builds or a cited source;
anything not measured says so. Root cause: `docs/root-cause/2026-10-24-brewline.md`. Security: kept separately in
`docs/plan/2026-10-24-security-for-live-server.md`. Build log of each change: `docs/patent/build-notes.md`.

---

## 1. Done today, with proof (B–D)

| Item | What was wrong (measured) | What changed | Proof |
|---|---|---|---|
| Proof gate | 4 of 5 findings in Brewline's last round were false; nothing checked live findings | A finding the project proves partly false is flagged (quoted code in no file, cited files missing, endpoints outside the contract) | Replayed against the exact code each round reviewed: 0 of 84 flagged in Trailhead ×2 and Ledgerly; Brewline's false ones all flagged |
| Chief AI check | The Chief AI looked only at disputed findings, after the round was paid for | One call per round: each model-written finding is fix (named plan item) / later / not true, judged on the approved plan and the real code | Tests incl. Brewline round 11; if the call fails nothing is lost |
| Reviewer instructions | "List AT LEAST 3-5 issues", "Default to NEEDS WORK"; every live round reported exactly 5 | Quota and fail-by-default removed; the approved plan is the yardstick; every finding names its plan item | Plan list on Brewline's real data: 8 criteria, 9 endpoints, 1 role, design, 8 security rules |
| Reviewer failures | A reviewer timeout became a CRITICAL app bug sent to a builder (3 of 4 builds) | The review alone is run again; never routed to a builder | Test: no builder called, no redeploy |
| Dead-button check | Flagged a deliberate "Sold out" button twice | Always-disabled buttons are not dead UI | Test |
| CRUD check | Skipped what it could not do and printed "every resource confirmed" | Uses the contract's roles; reports what it cannot do as not checked | Test with a staff-only create |
| Design reaches builders | The design agent's café brief was rejected by the builders' evidence rule; a generic fallback was used silently | Design agent exempt from that rule; JSON briefs read; brief from the spec's own colours when needed; spec colours always first; source shown on the approval page | Brewline's spec gives exactly its 5 colours; loop tests |
| Builder self-checks | Emoji/colour problems found only after "done" | Emoji, dead buttons, spec colours checked by the system when the frontend builder finishes | Loop test: "done" refused once, then allowed |
| Phases | Backend builder idle 54 of 86 min waiting at phase ends | Each builder runs its own phases; only real dependencies wait | Exact order test (no timing) |
| Fewer model-driven checks | 28–73% of builder calls were one-action checks; backend proved live checks every phase | Backend middle phases need a passing build; the full live check once, at the end | Wiring tests |
| Backup region | 36 calls failed with 404 there (13 min) | A missing model is retried on the primary and not sent there again | Tests |
| Time limit by size | 43 calls cut at 120 s (86 min); successful reviews reached 119.1 s | ~1.8 s per 1,000 tokens, never under 120 s, max 6 min | Tests |
| Parallel reviewers | All three started on the same model | Each starts on its own model, in the tier's order | Tests |
| Redeploy | 11–19 agent calls per redeploy; a new JWT secret each time (leaked, would sign users out) | A running app is rebuilt by the system and keeps its secret | Live: Brewline redeployed in 104 s, no model call |
| Builder batching (earlier today) | 117 single-file reads, one edit per call | read_files, edit_files, own-files preload | Tests through the real loop; live round: 10 files read in 3 calls |

Tests across agent-runtime, agents, pipeline and llm-client: 2,160+ pass; type checks clean. **Not yet proven in a
build:** the effect of all of this on time and cost — that needs one paid test build (section 5, item 2).

---

## 2. Why one agent is faster, and what we keep from multi-agent

**Our data:** the builders spent about 30 min (backend) and 44 min (frontend) waiting on the model, but 86 and 77 min
of wall time, and the whole build made 1,099 model calls (a single agent: roughly 60–100, estimate). The difference was waiting, re-reading,
one-action calls and review loops — not "multi-agent" itself.

**Research:**
- Parallel agents that do not share context make conflicting decisions; Cognition recommends one writer per piece of
  work and full shared context ([Cognition](https://cognition.ai/blog/dont-build-multi-agents)). Brewline's lost design
  was exactly this: the builders never saw the design that was made.
- Multi-agent systems use about 15× the tokens of a chat and suit breadth-first research better than tightly linked coding
  ([Anthropic, multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system); figures via
  secondary write-ups, not verified in the original text).

**Decision kept:** one writer per area (backend, frontend, database) working from one locked contract and one approved
plan that every agent sees (done today); no extra writing agents. Agents that only read (reviewers, checkers, research)
stay separate — they cannot conflict.

---

## 3. Tests first (TDD) and sub-agents — the answer

**Today, measured:** no generated app has a single test file; the test agent (Aarav) was never built; builders "test" by
clicking through the running app one model call per action (28–73% of their calls).

**Plan — tests from the approved plan, written by the system, before the builders start:**
1. From the locked API contract, generate API tests deterministically (no model call): every endpoint answers with the
   contract's status and shape, protected endpoints refuse a request without a token, role-limited ones refuse other
   roles, a user cannot read another user's record. From the success criteria, generate page checks (the page exists,
   loads, shows the named content).
2. The builders' exit check (built today) runs these tests; a builder may finish only when they pass.
3. Reviewers and the Chief AI judge against the same plan items, so build, test and review use one yardstick.

**Evidence:** a test-first prompt improved results over reasoning-only prompting in TDD-Agent
([arXiv 2608.16742](https://arxiv.org/pdf/2608.16742)); no clean controlled study isolates test-first alone (stated
plainly). Our own data: 13 real app bugs were found only by review. Some would fail a contract or page test at the builder (the
role and sign-in redirect ones); the visual and edge-case ones would not, and stay with review. Generating tests from
the contract costs no model calls and replaces model-driven clicking — it reduces calls, it does not add them.

**Builder teams — a builder splits its own work across helpers (Amit, 2026-10-24: "Aanya can launch 2 sub-agents …
they divide the work … finish fast … then test … all follow the user-approved plan").**

Today (checked): a `spawn_subagent` tool exists and is offered to every agent, but in four builds no builder used it. A
helper gets 12,910 characters of instructions against Aanya's 56,431 (none of her design and component rules), no
approved plan, contract or design, and two helpers run one after the other, not in parallel (`for … of
response.toolCalls` awaits each). Used as it is, it would be slower and worse.

Design, with the approved plan as the only source:
1. **Split from the plan, not by guess.** Arjun's plan already gives every task its own files with no overlap (Brewline:
   10 frontend tasks, e.g. the menu page owns `app/menu/page.tsx`, `MenuGrid.tsx`, `MenuFilter.tsx`; 4 backend tasks,
   e.g. orders own `orders.routes.ts`, `orders.controller.ts`). The system groups the tasks into at most 3 helpers.
2. **Shared files first.** The lead builder writes what every task uses — layout, header and footer, the theme with the
   approved colours, the API client and types (backend: app, middleware, database pool) — then the helpers start.
3. **Helpers run in parallel**, each with the builder's full instructions, the approved plan items, the contract, the
   design, the shared files already loaded, its own tasks — and permission to write only its own files (the existing
   write guard). Each starts on a different model (the rate-limit pool is per model).
4. **Each helper tests its own work:** unit tests for its logic (controller rules, form validation, price and date
   helpers), its type check passing, before it reports done.
5. **The lead integrates and compares code to plan:** the build passes; a plan-vs-code check finds every task's files,
   every planned page's route, every contract endpoint's handler and the approved colours; then the integration tests the
   system writes from the contract (section 3) run against the running API — the frontend's final check waits for the
   finished backend, as the phases already do. A failure goes back to the helper that owns the file.
6. **Fix rounds use the same split:** each finding goes to the owner of its file, owners fix in parallel.

Why this can work where parallel writers usually conflict (Cognition, section 2): no two helpers share a file, all of
them build on the same shared files and the same plan, and one lead integrates and tests.

Expected (an estimate to be measured, not a promise): Brewline's frontend builder spent ~44 min on 175 model calls one
after another; shared files plus 2–3 parallel helpers should bring that near 15–20 min. Cost should stay close: each
helper re-sends the instructions (~14k tokens), cached at a 90% discount after its first call.

---

## 4. Context, tokens, caching and batching

**Measured on Brewline:**

| Agent | Calls | Input per call | Served from cache |
|---|---|---|---|
| Frontend builder | 349 | ~61k tokens | 76.8% |
| Backend builder | 189 | ~50k tokens | 76.0% |
| Browser checker | 268 | ~17k | 74.6% |
| Reality checker | 88 | ~31k | 63.0% |
| Logic review | 23 | ~85k | 27.5% |
| Performance review | 12 | ~74k | 24.0% |
| Deploy agent | 101 | ~12k | 0% (an NVIDIA model with no cache reporting) |

Fixed instructions are 98–100% identical across tasks and carry no timestamps (good for caching). Reviewers' fixed
instructions are ~3,500 tokens — below Google's minimum cacheable prefix of 4,096 (Gemini 3/4) or 6,144 (some 3.x Flash
previews) ([Vertex context caching](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview)),
and the changed code follows right after, so almost nothing repeats.

**Principles (cited):** keep the start of the conversation byte-identical and append-only — one changed token breaks the
cache from that point; Manus treats the cache hit rate as the most important production metric, with ~100:1 input to
output ([Manus](https://manus.im/en/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)); cached input is
billed at a 90% discount on Vertex; compaction, notes outside the context and sub-agents with clean context are the
standard tools ([Anthropic context engineering, via summaries](https://agentic-ai.readthedocs.io/en/latest/ContextEngineering/anthropic/)).

**Actions, in order of measured effect:**

| # | Action | Basis | How we prove it |
|---|---|---|---|
| K1 | Reviewer request order: instructions + approved plan + unchanged files (sorted) first, changed files last | Reviewers cache 24–28%; their stable part is below the minimum | `cached_in` share in `agent_spend` on the next build |
| K2 | Batched reads/edits/preload (built today) | 117 single reads, 9 single edits on Brewline | Calls per builder and tools per reply on the next build |
| K3 | One browser tool call that runs a list of actions (navigate, fill, click, read) | Browser checker: 268 calls, one action each | Calls of the browser checker |
| K4 | Compaction only at the threshold, and old tool output hidden (not summarised) when it runs | Hiding old output works as well as summarising (JetBrains "Complexity Trap"); each compaction rewrites the prefix and breaks the cache | Count compactions and the cache rate after each |
| K5 | Write whole files per reply (write_files) rather than many small edits for new pages | ~550 output tokens per builder call | Output tokens per call |
| K6 | Gemini Batch API (cheaper, not interactive) only for non-urgent jobs such as a nightly re-review | Batch and cache discounts stack on Gemini 3+ | — |

Explicit (paid) caches are not available on gemini-4-argon; implicit caching is automatic and needs no code.

---

## 5. What is left, in order

| # | Item | Why (evidence) | Needs |
|---|---|---|---|
| 1 | Security A1–A7 | `docs/plan/2026-10-24-security-for-live-server.md`; A1 is live on this laptop | Your go (A1 restarts the dev stack for ~1 min) |
| 2 | One paid test build to measure everything above | Nothing in sections 1 and 4 is measured in a full build yet | Your cap |
| 3 | Tests from the approved plan, and builder teams (section 3) | 13 real bugs found only by review; 28–73% of calls are checks; the frontend builder's 175 calls ran one after another | Your go (new feature) |
| 4 | K1 reviewer cache order, K3 browser batch, K4 compaction | Section 4 table | — |
| 5 | One live review round after the fixes, then deliver with a known-issues list | The open-ended review never converged in any build (e.g. Trailhead 2: 4, 7, 8, 6, 6 findings) | Your decision: it changes what "done" means |
| 6 | Builder model order | Measured: 3.5-flash 98% ok / 6.8 s, 3.6-flash 95% / 5.6 s, 3.8-flash 73% / 20.3 s, 3.7-flash 75% / 30.1 s; 3.8-flash leads by your 2026-09-28 request | Your decision |
| 7 | First deploy from a fixed template (redeploys done today) | First deploy: 16–19 agent calls for a ~1 KB file | — |
| 8 | Audit the parts not yet traced: planning agents (spec, plan, database), the design score agent, the web UI, other app types, multi-user use | Not covered by the 2026-10-24 audit | — |

### Status of section 5 (2026-10-25)

| # | Status |
|---|---|
| 3 | Done: builder teams, review teams, contract check of the compiled backend against the approved API contract (`contract-route-check.ts`). Frontend unit tests are still not built. |
| 4 | K1 done (reviewer cache order: 0.4% to 74.8% of the code block identical on Brewline's last fix round), K3 done (`browser_steps`, also for the design-score agent), K4 not built: compaction never fired on Brewline (aanya averaged 67K input tokens a call, 76% cached), and teams already shorten each run; revisit only if the next build shows long runs. |
| 6 | Done (all four flash models, ordered by measurement; leads on 3.1-pro). |
| 7 | Done: the system writes the standard compose file and starts and checks it (13 s on a copy of Brewline; the agent's first deploy was 25 min); also a fresh-database migration check, which found a fix-round migration that stops Postgres on a new install. |
| 8 | Done as far as the records allow, see below. |
| new | Product-image rule, hold-page wording, footer logo as a file, broken-image check in the page sweep, starter content for public catalogs, port reservation for concurrent builds. |

**Audit result (item 8):**
- Planning (Brewline): spec to contract 9 of 9 endpoints, schema equals migrations, every contract route has a backend task. No gap found. Not checked: how the planner behaves on other kinds of spec (only one recorded plan was traced).
- Design-score agent: structurally sound (four scores required, "no score" is unscored and never a pass, screenshots required and its images checked). Brewline never reached it (budget stopped first), so its scores are not traced on this build. It now has the grouped browser call.
- Web UI: only the failure texts were checked (the guessing texts are gone, a test guards it). Not checked: the other screens.
- Other app types: the planner only produces `web` apps today (mobile, desktop and system apps are Phase 2); nothing to check.
- Multi-user: projects are scoped by user in the API, the worker runs 6 activities at once, and ports were picked with no hold between picking and starting: two builds deploying together could pick the same port. Fixed (ports held per build for 45 minutes). Not checked: two real builds running at the same time.

---

## 6. How the next build is judged (targets from Brewline's baseline)

| Measure | Brewline | Target |
|---|---|---|
| Builder idle (waiting) | backend 54 of 86 min | under 10% of its time |
| Builder calls that are one-action checks | 28–73% | under 25% |
| Single-file reads by builders | 117 | under 10 |
| Model calls failed | 98 (123 min) | under 15 |
| Findings sent to builders that the proof gate or Chief AI rejects | 3 false + 12 system-made + 16 outside the plan | 0 |
| Reviewer failures sent to builders | 4 | 0 |
| Cache share of input (reviewers) | 24–28% | over 60% |
| Total cost | $28.11, not delivered | delivered, under the cap you set |
