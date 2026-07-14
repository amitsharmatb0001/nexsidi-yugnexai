# NexSidi Phase 2–5 Handoff — Claude Code Execution Document

> **Read this file FIRST in any Claude Code session executing this work.**
> Then follow nexsidi-master-workflow as normal (read CLAUDE.md,
> PROGRESS.md, check worktree). This document tells you WHAT was built
> in the July 2026 planning sessions, WHERE it is, the DECISIONS that
> govern it, and the EXACT execution order. Do not re-derive or
> re-design anything decided here — execute it.

**Repo:** nexsidi (branch base: feat/nexsidi-pipeline-v2-eager)
**Produced:** 2026-07-07 planning sessions with Claude (Fable 5)

---

## 1. Artifact Inventory

| Artifact | Contents |
|---|---|
| `nexsidi-skills-phase2.zip` | 1 fixed + 6 new dev skills |
| `nexsidi-skills-phase3.zip` | core-reasoning skill + eval harness (runner + eval set) |
| `nexsidi-skills-phase4-secwing.zip` | 3 cybersecurity-wing skills |
| `phase5-harness-enforcement-plan.md` | 8-task implementation plan for packages/agent-runtime |
| `PHASE-HANDOFF.md` | this file |

### Phase 2 — dev skill pack (install as skills)
- `nexsidi-cfo` — **REPLACES existing installed copy.** Frontmatter fixed
  (`trigger:` → `description:`); body content unchanged. Without this
  fix Manan does not trigger reliably in Claude Code.
- `nexsidi-intake` (Maya) — 5-job scope, ≤3 questions, Layer 7 rules,
  exact `__READY_TO_BUILD__` JSON contract
- `nexsidi-cve-response` (Neha) — KnowledgeUpdate shape, severity
  triage (CRITICAL-only Tilotma alerts), lockfile relevance gate
- `nexsidi-deployment` (Riya) — act/observe/fix/retry loop, fail-loud
  deploy-target gate, port conventions, dynamic-DB-import pattern
- `nexsidi-observability` — three channels (Health WS / Layer-7 SSE /
  Temporal heartbeats), log conventions, fixed stuck-diagnosis order
- `nexsidi-incident-response` — contain → rollback → observe →
  diagnose → fix → record; Claim-3 rollback; no hotfix shortcuts
- `nexsidi-token-budget` — four mechanical guards in llm-client,
  routing ladder, 3-strike as budget rule, context trim rules

### Phase 3 — the "core" layer
- `nexsidi-core-reasoning` — 12-rule working discipline injected into
  EVERY agent's system prompt. Base layer for all other skills. Ends
  with a "For the Harness" section listing which rules Phase 5 makes
  structural.
- `nexsidi-skill-evals` — eval doctrine + working tooling:
  - `scripts/run-evals.ts` — Bun runner, any OpenAI-compatible
    endpoint via `--base-url/--model/--api-key`. Verified compiling
    (tsc clean with @types/node). NOT yet run against a live endpoint.
  - `evals/core-reasoning.json` — 10 trap-style cases (validated JSON)
  - Ship gate: skill effect (with − baseline) ≥ +20 on target model

### Phase 4 — cybersecurity wing (Wing 2)
- `nexsidi-secwing-charter` — roster (Rudra, Ishani, Veda, Advait,
  Kiara — 5 agents, each mapped to a proven Wing-1 pattern), service
  lines, pipeline mapping, HARD boundaries (see Decisions D-6/D-7)
- `nexsidi-security-audit` — fixed audit order, category checklist
  with coverage records, severity rules, finding format, Kiara
  verification gate (no unverified finding ships)
- `nexsidi-threat-modeling` — STRIDE per trust boundary + the four
  agentic-system boundaries (injection, agent→tool, agent→agent,
  memory writes)

### Phase 5 — enforcement plan (execute, don't design)
`phase5-harness-enforcement-plan.md`: 8 tasks making Rules 6/7/9
mechanical in `packages/agent-runtime` + runtime prompt assembly +
Wing-2 authorization primitive. Full file map, interfaces, and TDD
steps per task are in the plan — follow it verbatim via
nexsidi-subagent-dev.

---

## 2. Decisions Log (binding — do not relitigate)

- **D-1 Provider-agnostic everywhere.** No skill, eval, or enforcement
  module may assume NIM/Ollama specifically. Targets: open-source,
  Gemini, Claude, and future in-house models, all via OpenAI-compatible
  interfaces. (Amit, Phase-3 approval.)
- **D-2 Both formats.** Skills serve Claude Code sessions AND runtime
  injection into API agents (Phase 5 Task 6 is the injection bridge).
- **D-3 Skills teach; the harness enforces.** For small models,
  instructions alone are insufficient — Rules 6, 7, 9 become
  structural gates (Phase 5). Never rely on doctrine text where a
  mechanical gate is possible.
- **D-4 Eval ship gate.** No skill ships to the pipeline without an
  eval set (5–10 trap cases) and ≥ +20 effect on the target model,
  3 runs per case, mean reported.
- **D-5 Escalation is exceptional.** Strong-model escalation fires
  once, with a logged reason; it is never the routine default.
- **D-6 Wing 2 is defensive-only.** Assess, harden, monitor, respond.
  No offensive/exploit deliverables. Findings contain remediations,
  never attack recipes.
- **D-7 Wing 2 authorization gate is blocking.** No engagement work
  without a verified written authorization record — fail-loud,
  checked FIRST (Phase 5 Task 7 provides the primitive).
- **D-8 Confidentiality (standing rule).** Agent names, counts, and
  architecture NEVER appear in external material. Wing-2 roster is
  internal; externally it is "YugNex security services."
- **D-9 Naming.** The real package is `packages/agent-runtime`. Docs
  saying `nexsidi-agent-tools` are stale — fix docs (Phase 5 Task 8),
  do not rename the package.
- **D-10 Positioning (business, for reference).** Public messaging
  stays sharp on autonomous software engineering; expansion wings are
  the vision story, not the homepage headline, until a demo exists.
- **D-11 Repo/installed skill sync.** Any skill change updates BOTH
  the installed set and `nexsidi-skills-complete.zip` in the repo,
  same session. Drift is a defect.

---

## 3. Execution Order — Do It Exactly Like This

### Step 1 — Install skills (Phases 2–4)
```bash
# from the directory containing the three zips
unzip nexsidi-skills-phase2.zip && unzip nexsidi-skills-phase3.zip \
  && unzip nexsidi-skills-phase4-secwing.zip
# move each skill folder into the skills location this project uses
# (same place the existing 42 nexsidi-* skills live)
# nexsidi-cfo REPLACES the existing folder — back it up first:
mv <skills>/nexsidi-cfo <skills>/nexsidi-cfo.bak-$(date +%F)
```
Then verify: every new SKILL.md has `name:` + `description:`
frontmatter (they were machine-checked at build time; re-verify after
the move).

### Step 2 — Sync the repo zip (D-11)
Add all 11 skill folders (7 + 2 + 3, counting the cfo replacement) to
`nexsidi-skills-complete.zip` in the repo root. Add the new skills to
CLAUDE.md's skill list. Commit.

### Step 3 — Baseline evals BEFORE any enforcement work
```bash
cd nexsidi-skill-evals
bun run scripts/run-evals.ts --base-url <URL> --model <PIPELINE_MODEL> \
  --api-key <KEY> --skill ../nexsidi-core-reasoning/SKILL.md \
  --evals evals/core-reasoning.json --runs 3 --baseline
# then again WITHOUT --baseline
```
Record both scores in `evals/results/` and note them in PROGRESS.md.
This is the "before" number for the entire enforcement layer — do not
skip it; it cannot be reconstructed after Phase 5 lands. Expect some
regex assertions to need loosening against real small-model phrasing —
tune assertions, not the ship gate.

### Step 4 — Execute the Phase 5 plan
Open `phase5-harness-enforcement-plan.md`. Execute Tasks 1→8 in order
via nexsidi-subagent-dev (D-3). Tasks 1–7 are parallelizable ONLY per
the plan's interface graph (1→2→3 sequential; 4, 5, 6, 7 independent
after 1). Task 8 last, always. Every task: failing test first, evidence
before its commit, existing suites stay green.

### Step 5 — Post-enforcement measurement
Re-run Step 3's eval (with-skill condition) against the pipeline with
prompt-assembly active (plan Task 8 Step 3). Record the delta. This
number feeds the investor narrative (D-10) — hand it to Manan.

### Step 6 — Wing-2 eval sets (before any Wing-2 build work)
Write 5–10 trap cases each for `nexsidi-security-audit` (tempt
unverified findings; tempt severity inflation) and
`nexsidi-threat-modeling` (tempt skipped STRIDE cells; tempt abstract
scenarios). Gate per D-4. Only then is Wing-2 implementation planning
allowed to start.

---

## 4. Definition of Done for This Handoff

- [ ] 11 skills installed; cfo replacement verified triggering
- [ ] Repo zip + CLAUDE.md synced and committed (D-11)
- [ ] Baseline + with-skill eval results stored (before numbers)
- [ ] Phase 5 Tasks 1–8 complete, all suites green, live-run
      transcript evidence read and referenced in PROGRESS.md
- [ ] Post-enforcement eval delta recorded
- [ ] Wing-2 eval sets written and passing the D-4 gate
- [ ] PROGRESS.md updated with evidence references at each step

## 5. Known-Open Items (report-only; do not fix unprompted — Rule 8)

- Eval runner has never hit a live endpoint (compile-verified only)
- OTP/PIN approval UI (Claim 8) — future; Task 7 is only its primitive
- Evidence-ledger/authorization persistence to DB — future
- Website improvements (proof asset, twitter:card, viewport zoom,
  audience line) — separate workstream, owner: Amit
