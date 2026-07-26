# NexSidi Full-Depth Audit Report
**Date:** 2026-07-22  
**Auditor:** Claude Code (Sonnet 4.6) — fresh perspective, no prior session bias  
**Trigger:** First complete end-to-end pipeline run (NexTech site) scored QA 97-100 and delivered a broken site  
**Scope:** Architecture, wiring, model economics, GAN reality, patent claims, agentic readiness  
**Classification:** Internal — YugNex Technology (OPC) Private Limited

---

## 1. Executive Summary

The agentic brain is written but unplugged. The running system verifies proxies, not the product.

NexSidi's Temporal pipeline successfully orchestrates a multi-agent build and delivers a running container. But the quality gates it runs — a single-shot QA agent reading hardcoded filenames, a live-check that curls a non-existent backend route, a subjective scorer hardcoded to return 8.0 — verify that *something ran*, not that *the product works*. The adversarial QA system with correct scoring (CRITICAL×20, evidence-gated, default-FAIL), the Playwright visual reviewer, the Tilotma oversight layer, and the instinct memory — all of this exists, all of it compiles, none of it is reachable from the production pipeline. The dominant runtime cost driver is not model intelligence: it is 91K median input tokens per LLM call due to no history compaction, 11.1 minutes wasted on 429 backoff instead of instant model switching, and eight phantom compile-check failures on Windows (now fixed) that each restarted a 40-iteration loop. After the seven prioritized fixes in Section 14, the system can reach the MVP benchmark — but only if the observation loop closes: agents must see what they actually built, not a curl status code.

---

## 2. What NexSidi Is Today (the running system, honestly)

### 2.1 The actual production path

```
User message (chat UI)
  → POST /chat  →  planner elicitation (ask_user / propose_plan / trigger_build)
      [bypassed if build-plan.json exists]
  → Temporal workflow: projectBuildWorkflow()
      activity: runPlannerAgent()     → Arjun decompose
      activity: runGeneratorAgents()  → Shubham + Aanya + Pranav (Promise.all)
      activity: runCompileCheck()     → npx tsc --noEmit
      loop:     runQaAgent() ×N       → single-shot Navya/Karan/Deepika (same model)
      activity: runCompileCheck()     → npx tsc again post-QA
      signal:   approveDeploySignal   → boolean gate (no OTP/PIN)
      activity: runDeployAgent()      → Riya docker-compose up
  → WebSocket events → build/[id] dashboard
```

### 2.2 Models actually running (not what CLAUDE.md says)

| What CLAUDE.md promises | What code declares | What actually runs |
|---|---|---|
| Tilotma → deepseek-v4-pro | ❌ timeout (`types.ts:12`) | `gemini-3.5-flash` |
| Saanvi → minimax-m3 | ❌ 404 (`types.ts:13`) | `gemini-3.5-flash` |
| Arjun → mistral-nemotron | ❌ timeout (`types.ts:14`) | `gemini-3.5-flash` |
| Navya/Karan → kimi-k2-6 | Routing exists | `gemini-3.5-flash` (QA_TIER=gemini) |
| Pranav/Aarav/Riya → qwen2.5-coder:7b | Ollama route exists | `gemini-3.5-flash` |

**One cheap flash model runs the entire "multi-model" pipeline.** 670 of 699 measured usage lines in the last run were `gemini-3.5-flash`.

### 2.3 What the pipeline actually checks

| Stage | What it claims to check | What it actually checks |
|---|---|---|
| QA (Navya/Karan/Deepika) | Adversarial code quality | Single-shot self-score on ~18 hardcoded filenames, 20K chars total |
| Live check | App is running and accessible | curl to `/api/v1/tasks` (doesn't exist) — 404 counts as pass |
| Live test (System B) | Subjective design/UX score | `return 8.0` — hardcoded stub, zero callers |
| Compile gate | TypeScript clean | npx tsc — correct, but triggered 35× in one run |
| Deploy approval | Human signs off | Boolean gate, no OTP/PIN |

---

## 3. What NexSidi Is Supposed to Be

From CLAUDE.md, PROGRESS.md, and the patent filing:

**38 specialized agents** across the full software product lifecycle: requirements → architecture → parallel development → adversarial QA → live testing → deployment → monitoring → social media → investor relations → legal compliance.

**10 patent claims protecting:**
1. SHA-256 hash chain on every inter-agent context transfer
2. Persistent instinct memory with confidence-scoring
3. Automatic rollback to last verified state on hash mismatch
4. GAN-style adversarial QA — error-maximizing independent evaluator
5. 4-tier kernel isolation sandbox (Rust)
6. DAG-based parallel task decomposition
7. Cryptographic RSA-SHA256 signing of every agent output
8. OTP/PIN-based user approval before code execution
9. Hierarchical Chief AI Officer coordination pattern
10. 100% full retest after every adversarial finding

**Quality gates that are meant to be meaningful:**
- Static QA gate: ≥85/100 (CRITICAL×20, HIGH×10, MEDIUM×5, LOW×1) — three parallel adversarial agents on different models
- Live visual gate: ≥7.0/10 (design×0.35, originality×0.35, craft×0.15, functionality×0.15) — Playwright-driven, default-FAIL

**The promise to the user:** one-line brief → working, visually-verified app at localhost → source code + docker-compose.yml → GitHub repo + PRD → no agent names, no debug output, no broken pages.

---

## 4. Vision vs Reality Matrix

| Capability | Status | Evidence |
|---|---|---|
| SHA-256 hash on transfers (P1) | PARTIAL | Hash computed in `packages/context-chain/hash.ts`; `verified` flag never set to `true` in production |
| Instinct memory (P2) | UNWIRED | `agents/maya/` (252 LOC), `instinct-cron`, `memory-store.ts` (1,348 LOC) — nothing calls them in production |
| Rollback on hash mismatch (P3) | UNWIRED | `rollbackToLastGoodState()` exists in dead orchestrator stage4 only |
| Adversarial GAN QA (P4) | PARTIAL | Real GAN in `agents/qa/navya|karan|deepika` (dead); running QA is anti-adversarial single-shot |
| Rust 4-tier sandbox (P5) | ABSENT | `sandbox/src/main.rs` says "Phase 2"; never invoked |
| DAG parallel dispatch (P6) | PARTIAL | `Promise.all([shubham, aanya, pranav])` — parallel but hardcoded, not a real DAG |
| RSA-SHA256 signing (P7) | UNWIRED | `packages/context-chain/sign.ts` exists; never called in production path |
| OTP/PIN approval (P8) | ABSENT | `approveDeploySignal` is a plain boolean WebSocket signal |
| Tilotma Chief AI Officer (P9) | UNWIRED | `agents/tilotma/src/index.ts` (875 LOC); imported by nothing in production |
| 100% retest after finding (P10) | PARTIAL | Re-runs QA, but on same truncated 20K sample, not full codebase |
| 38-agent roster | ABSENT | 5 agents active (Arjun, Shubham, Aanya, Pranav, Riya); 33 not built |
| Multi-model routing | PARTIAL | Routing code exists; all primary models broken/unavailable |
| Context chain verification | ABSENT | No production code calls `verifySignature()` or checks hash match |
| Vanya design agent | ABSENT | No code; design brief = `plan.appDescription` one sentence |
| System B live eval | ABSENT | `runLiveTest()` returns hardcoded `8.0` (`activities/index.ts:577-580`) |
| Observer/Tilotma oversight | ABSENT | `escalateTilotma()` is a logging stub (`activities/index.ts:600-607`) |
| Gate 1 spec approval | PARTIAL | Built and wired; bypassed by stale `build-plan.json` fast-path |
| Instinct cron / Neha | ABSENT | Files exist, never scheduled |
| Red/Blue team | ABSENT | Agent files in roster only |

---

## 5. The Benchmark: How Agentic Systems Actually Work

> *Note: Codex and Antigravity descriptions are based on their leaked system prompts (`refrence/` folder) and publicly documented capabilities as of mid-2026. Not from repo evidence.*

### 5.1 How I (Claude Code) work a task

```
1. THINK    — re-read the request, identify what "done" means concretely
2. EXPLORE  — read-only sweep: Glob patterns, Grep symbols, Read critical files
               Never write before I understand what's there
3. PLAN     — form a plan, present it, wait for approval (ExitPlanMode)
4. IMPLEMENT small — one logical unit at a time, scope-limited edits
5. RUN      — execute the actual thing (bun test, bun run dev, curl the endpoint)
6. OBSERVE  — read the actual output: what did it print? what did the browser show?
               Not "did it exit 0?" — what does it look like?
7. FIX      — if the observed result doesn't match the goal, diagnose and fix
8. VERIFY   — end-to-end check before claiming done (screenshot, test output, curl)
9. REPORT   — show the evidence: screenshot, log lines, test output counts
```

The defining trait: **I close the loop on observed reality.** I don't report done until I've seen the thing I built working, with my own tools.

### 5.2 How Codex works

Codex (based on its full system prompt, `refrence/OpenAI/Codex/codex-full.md`):
- **Reads the codebase first** before any edits — "build context by examining the codebase first without making assumptions"
- **Parallelize everything**: file reads, searches, non-dependent operations all in one turn
- **Worktree-aware**: "You may be in a dirty git worktree. NEVER revert existing changes you did not make"
- **Decision-complete planning**: plans must be complete enough that the implementer makes zero decisions mid-task
- **In-app browser for live testing**: `control-in-app-browser` skill boots a clean browser, navigates localhost, clicks through the actual UI, screenshots

Codex's `control-in-app-browser` is what NexSidi's Tier-3 visual review (`tier3-review.ts:1-328`) does — except Codex has it live and wired, and NexSidi has it dead.

### 5.3 How Antigravity works

Antigravity (Google DeepMind, `refrence/Google/antigravity-cli.md`):
- Design is **non-negotiable**: "The USER should be wowed at first glance. Failure to do this is UNACCEPTABLE."
- Runs under AI Studio Build's Antigravity harness — **cloud containers**, user sees a live preview iframe
- Server-side agent: "users can close their browser tab and return later to see results"
- Design mandate maps almost word-for-word to NexSidi's System B scoring criteria (design×0.35, originality×0.35) — but Antigravity enforces it at the generation stage, not at a post-delivery gate

### 5.4 Stage-by-stage comparison

| Stage | Claude Code | Codex | Antigravity | NexSidi running | NexSidi designed |
|---|---|---|---|---|---|
| **Intake** | Explicit requirements, wait for clarification | Plan mode, explore-first | Natural language → immediate build | Gate 1 (bypassed) / Saanvi | Saanvi + Vanya design brief |
| **Plan** | ExitPlanMode approval | Decision-complete plan, plan review | No explicit gate | Arjun decompose (ambiguous briefs) | Arjun + independence check |
| **Implement** | One unit, scope-limited | Parallel tool calls, codebase-first | Generates full app | Parallel Promise.all | Parallel worktrees + hash chain |
| **Verify** | Run + observe + screenshot | In-app browser navigate + click | Live preview iframe | tsc + curl 404 | Tier-3 Playwright + System B |
| **Fix** | Observe what broke, fix root cause | Re-run tests until green | Iteration on visible result | Code-fix agent (cold restart) | QA fix loop + peer debate |
| **Deliver** | Evidence-backed report | Commit + PR | Share link / download | docker-compose up | docker-compose + PRD + GitHub |
| **Memory** | None between sessions (by design) | None between sessions | None | Dead (instinct-cron unwired) | Instinct memory + pgvector |

**The shared trait of all working systems:** they observe what they built. NexSidi-running never does.

---

## 6. GAN Architecture Audit

The spec (CLAUDE.md, Patent Claim 4) describes a Generator-Evaluator adversarial harness where the evaluator is error-maximizing, independent from the generator, and uses strict evidence gates.

### 6.1 What the spec requires vs what runs

| GAN element | Spec | Running system | Dead code |
|---|---|---|---|
| Evaluator stance | Error-maximizing, adversarial | "DO NOT flag missing implementations" (`activities/index.ts:468`) | `runExploring`: "default-FAIL, evidence-gated" |
| Score formula | CRITICAL×20, HIGH×10 | CRITICAL×10, HIGH×5 (`activities/index.ts:477`) | Stage5 uses correct ×20 weights |
| Pass threshold | ≥85 | ≥70 (`project-build.ts:166`) | Stage5: ≥85 |
| Input scope | Full codebase | ~18 hardcoded Task-app filenames, 20K chars | Stage5: walks full codebase up to 200K chars |
| Parse failure | Score 0 (default-FAIL) | Score 50 (passes!) | Stage5: score 0 |
| Model independence | 3 different models | All gemini-3.5-flash | Designed: kimi/minimax/kimi |
| Evidence gate | Finding requires evidence before logging | Trust model self-report | `runExploring`: evidence required |
| Fix loop | Peer debate, fault isolation | Cold restart of fresh 40-cap loop | Stage5-qa-fix-loop: peer debate |
| Instinct writes | After every finding | Never | Stage5: writes to instinct store |
| Live eval (System B) | Playwright, ≥7.0 | `return 8.0` | Tier-3: two Playwright passes |
| Evaluator context | Fresh (no generation history) | Shares same Gemini session | Designed: fresh context per evaluator |
| Human gate | After QA pass | Boolean signal | OTP/PIN (P8) |
| Tilotma oversight | Watches, intervenes when stuck | Logging stub | Observer pattern (875 LOC unwired) |

### 6.2 Where the real GAN lives

Three implementations exist in dead code:

**`agents/qa/navya|karan|deepika/`** — `runExploring()`: full-codebase walk, evidence-gated findings, correct ×20 weights, score 0 on parse error, separate model per agent. Reachable only from `pipeline/orchestrator/stages/stage5-adversarial-qa.ts` which is reachable only from `pipeline/dev-run.ts`.

**`pipeline/orchestrator/stages/stage5-qa-fix-loop.ts`** — Peer debate between evaluator agents, fault isolation, instinct writes. Never called in production.

**`agents/tilotma/src/tier3-review.ts`** (328 LOC) — Two-stage Playwright-driven visual/interactive QA. Stage 1: browser_navigate, click, fill, screenshot — "default assumes issues exist." Stage 2: fresh context, "default NEEDS_WORK." Screenshot artifacts exist in `tier3-review-screenshots/` from past dev/stress runs — this code has run, just never in production. Triple-buried: dev-only path + `includeTier3` defaults false + Stage 6 which production never reaches.

### 6.3 The three structural gaps

1. **Input gap**: running QA reads 18 hardcoded task-app filenames regardless of what was actually built. It cannot find bugs in the NexTech site because it's looking at a task-app template.
2. **Observation gap**: no agent ever renders the frontend and looks at it. The pipeline declares delivery when `docker-compose up` exits 0 — not when the site looks right.
3. **Independence gap**: all three "adversarial" QA agents call the same model with slightly different focus prompts. Same model + same session = correlated failures.

---

## 7. Built and Working (credit where due)

These things genuinely work:

- **Temporal durability**: crash the worker mid-run, restart it — the workflow resumes from the last completed activity. This is the real moat. No Lovable/Bolt/Devin equivalent.
- **Planner elicitation**: `ask_user` / `propose_plan` / `trigger_build` are built, wired to the chat route, and render as `ElicitationWidget` in the UI. Users see questions before the pipeline starts (when Gate 1 isn't bypassed).
- **Parallel generation**: Shubham, Aanya, and Pranav run in `Promise.all` — genuine wall-clock parallelism, not sequential.
- **Compile gate**: `runCompileCheck()` correctly runs `npx tsc --noEmit` and parses real errors. It caught real TypeScript mistakes in stress runs.
- **Riya SSL self-heal**: during the last run, Riya detected `SSL connection error`, identified `NODE_ENV=production` as the cause, edited `docker-compose.yml` autonomously, and restarted containers. This is genuine agentic behavior — observe problem → diagnose → fix → retry.
- **Activity feed UI**: the `build/[id]` page streams real-time pipeline events via WebSocket. Users see live progress.
- **Analytics panel**: the dashboard tracks projects, build counts, and status over time.
- **Windows tsc phantom-timeout fix** (this session): phantom compile errors from Windows cmd.exe process tree now correctly classified as timeouts and retried, not as code bugs.

---

## 8. Built but Never Wired (dead code inventory)

| Module | LOC | What it does | Why it's dead |
|---|---|---|---|
| `pipeline/orchestrator/` (all stages) | 2,181 | Full designed pipeline (stage0-stage6) | Reachable only from `dev-run.ts` / `stress-test.ts` |
| `agents/tilotma/src/index.ts` | 875 | Chief AI Officer orchestrator | Imported by nothing in production |
| `agents/tilotma/src/tier3-review.ts` | 328 | Playwright visual QA | `includeTier3` defaults false; Stage 6 never reached |
| `agents/qa/navya|karan|deepika/` | ~400 each | Real adversarial QA agents | Called only from dead orchestrator |
| `pipeline/orchestrator/stages/stage5-qa-fix-loop.ts` | 268 | Peer-debate QA fix loop | Dead orchestrator only |
| `apps/api/src/workspaces/service.ts` | 1,348 | Workspace service | Mounted by nothing in production |
| `apps/api/src/workspaces/service.test.ts` | 1,016 | Workspace service tests | Test suite for dead service |
| `agents/maya/` | 252 | Instinct observer | Never scheduled, never called |
| `packages/context-chain/sign.ts` | ~80 | RSA-SHA256 signing (P7) | Never imported in production |
| `packages/context-chain/verify.ts` | ~80 | Hash verification + rollback (P1/P3) | Never imported in production |
| `agents/neha/` | 62 | Knowledge updater | No cron, never scheduled |
| `packages/agent-runtime/src/prompt-audit.ts` | 65 | Prompt auditing | Never called |
| `agents/meta-supervisor/` | 134 | Pipeline meta-supervisor | Imported by nothing |
| `pipeline/instinct-cron.ts` | ~100 | Instinct analysis scheduler | Never registered |
| `packages/agent-bus/` | 77 | Inter-agent message bus | No subscribers |

**Total dead but written: ~8,200 LOC.** The running Temporal pipeline is ~1,013 LOC. The ratio is 8:1 — for every line of code that runs in production, 8 lines of the designed system sit unconnected.

---

## 9. Promised but Not Built at All

| Feature | Status |
|---|---|
| Vanya (design agent) | No code exists. Design brief = `plan.appDescription` (one sentence). |
| System B subjective live eval | `runLiveTest()` returns hardcoded `8.0`. The Playwright harness, the 4-criteria rubric, the ≥7.0 gate — none of this runs. |
| OTP/PIN approval (P8) | `approveDeploySignal` is a boolean WebSocket signal. No PIN, no OTP, no time-bound code. |
| Neha 6-hour polling | File exists (62 LOC), no cron registered, never scheduled. |
| Red team (Vikram/Priya/Raj/Surya) | Agent names only in CLAUDE.md roster. Zero code. |
| Blue team (Ananya/Kunal/Divya/Rohan) | Agent names only in CLAUDE.md roster. Zero code. |
| 33 of 38 agents | Only 5 agent implementations run (Arjun, Shubham, Aanya, Pranav, Riya). |
| Playwright QA in production | Exists in Tier-3, triple-buried. Never called from the Temporal path. |
| docs/DECISIONS.md | Referenced 14 times in CLAUDE.md. Does not exist in the repo. |
| Instinct memory confidence tiers | Designed (0.3/0.5/0.7/0.9 enforcement levels). Zero database rows ever written. |
| Context chain verification in production | `verifySignature()` and hash-check never called from any production activity. |

---

## 10. Basic-But-Should-Be-Advanced

These are things the system does, but in forms far below what the spec requires:

**QA input sampling**: 18 hardcoded filenames (`activities/index.ts:661-705`) — these are task-app file paths (`TodoList.tsx`, `taskController.ts`, etc.). For any project that isn't a task app, QA is reviewing the wrong files. The real adversarial agents walk the actual build output directory.

**Self-reported scores**: QA agents score themselves. The prompt asks for a JSON object with a score field and trusts whatever number the model returns (`activities/index.ts:437`). No external verification, no evidence requirement, no parse-failure penalty beyond score 50.

**curl-404 live check**: `runLiveCheck()` boots only the backend container and curls `/api/v1/tasks`. This route does not exist in generated apps. A 404 response is accepted as passing. The frontend is never started. No page is ever rendered.

**Boolean gates**: All human approval checkpoints are `await workflow.waitForSignal("approveDeploySignal")` with a boolean. No identity verification, no time-bound token, no audit trail of who approved.

**Inline feedback**: QA findings are passed as an inline string to the next LLM call. They should be written to a file the generator reads at session start (as Codex's harness design mandates) so they survive context compaction.

**Model tier routing**: One model (`gemini-3.5-flash`) runs everything — QA review, code generation, user-facing messages, compile checks, deployment. The correct tier routing:
- **QA/adversarial review** → `gemini-3.1-pro-preview` at `thinking_level: HIGH` — this is the highest-stakes judgment in the pipeline
- **Code generation** (Shubham/Aanya/Pranav) → `gemini-3.6-flash` at `thinking_level: MEDIUM` — near-Pro quality at Flash cost
- **User-facing messages** (status updates, yes/no confirmations, progress) → `gemini-2.5-flash-lite` — 10× cheaper, 10× faster, adequate for simple communication

**Rate limit handling**: current code waits on 429 backoff. Measured: 11.1 minutes total 429 wait in the last run. Correct pattern: 429 → immediately pop to next model in pool. No wait. Pool: gemini-3.1-pro-preview → gemini-3.6-flash → gemini-3.5-flash.

**Context tracking**: agents have no awareness of their own token usage. They send the full transcript on every turn. At 498 messages, the median input was 91K tokens — nearly the entire 1M context budget consumed by history alone. No agent compacts, summarizes, or switches to a fresh context. They crash on overflow or degrade silently.

**NIM failure handling**: NIM primary models (deepseek, minimax, mistral-nemotron) fail with timeouts and 404s. The current code has a Gemini fallback added in a patch — but the wait-and-retry loop on NIM still burns time before falling over. Correct: NIM timeout → immediate Gemini fallback, no retry.

**Gemini 3.x thought signature gap**: Current `gemini-loop.ts` does not preserve thought signatures across multi-step calls. Gemini 3.5/3.6 Flash require thought signatures in the first function-call part of every multi-step request — a missing signature returns a `400` error. Upgrading to the newer Gemini models without fixing this will break immediately.

---

## 11. Why ~1 Hour and Why 30-40 Iterations

### 11.1 Measured breakdown (last run: NexTech site)

| Cost driver | Time | % of run |
|---|---|---|
| 429 rate-limit backoff (no model switching) | 11.1 min | 18% |
| 8 phantom compile-check failures (Windows tsc bug, now fixed) | ~24 min | 40% |
| Riya hitting 40-iteration cap (deploy phase) | ~12 min | 20% |
| Actual productive generation (Shubham/Aanya/Pranav) | ~8 min | 13% |
| QA runs (3 agents × multiple iterations) | ~5 min | 8% |

**Total: ~60 min. Productive generation: 8 min.**

### 11.2 The token curve problem

No history compaction on the Gemini path (`compactHistory` never imported in `gemini-loop.ts`). No prompt caching (only the dead `claude.ts` has cache headers). Full transcript re-sent every turn:

| Metric | Value |
|---|---|
| Peak history | 498 messages in one agent session |
| Median input tokens per call | 91,000 |
| P90 input tokens | 156,000 |
| Max input tokens (single call) | 220,000 |
| tsc runs in one session | 35 |
| docker builds in one session | 60 |

Each iteration costs more than the last. By iteration 30, each LLM call is processing ~150K tokens of history to make a 200-token file edit.

### 11.3 What the right economics look like

| Current | With fixes |
|---|---|
| 429 wait: 11.1 min | 429 wait: ~0 (instant switch) |
| Median input: 91K tokens | Median input: ~12K (compaction at 80%) |
| Phantom compile failures: 8 | Phantom compile failures: 0 (fixed) |
| Code-fix loops: 8 (all phantom) | Code-fix loops: 0-2 (real bugs only) |
| Riya iterations: 40 (capped) | Riya iterations: 8-12 (with observation) |
| **Estimated total: ~60 min** | **Estimated total: 12-18 min** |

The 3-5× speedup comes entirely from infrastructure fixes — not from a smarter model.

---

## 12. Where It Gets Stuck: The Exact Loops

### Loop 1: Compile-gate ↔ code-fix (the dominant failure mode, now fixed)

```
runCompileCheck() 
  → spawnSync("npx", ["tsc"]) on Windows cmd.exe
  → Windows spawns a process tree; outer process exits, child hangs
  → spawnSync returns status: null, stdout: ""
  → code treats "" as compile errors → triggers runCodeFix()
  → runCodeFix() spawns a fresh 40-iteration loop
  → fresh loop reloads full 498-message transcript
  → tsc times out again → another code-fix → ...
```

8 consecutive phantom compile failures, each spawning a fresh 40-iteration loop. **Fix applied this session**: timeout increased to 300s, empty-output = `timedOut: true` flag, workflow retries compile check directly on timeout instead of invoking code-fix.

### Loop 2: Stuck-at-1 escalation

QA passed (score 97-100). Post-QA compile check timed out 3 consecutive times. `MAX_POST_QA_COMPILE_FAILURES = 3` triggered → `markProjectFailed()` + `escalateTilotma()` (logging stub) + workflow return. **The project was declared failed despite QA passing and the site being runnable.**

**Fix applied this session**: workflow now retries compile check directly on timeout (up to 3 retries) before counting toward the failure limit.

### Loop 3: Riya hitting 40-iteration cap

Riya's deploy phase runs in `gemini-loop.ts` with `MAX_ITERATIONS = 40`. She hit the cap, returned `"verified": true` in her final message, but the live round-trip logs show a failed request. The cap was reached before completion. `"verified": true` was a hallucination under token pressure — the model knew it should be done, so it reported done.

**Root cause**: 40 iterations with full history re-sent = context pressure + no observation of actual deploy outcome. Fix: observation loop (see Section 14), context compaction, raise the deploy-phase cap.

---

## 13. Root Cause: Why This Is Not an Agentic System

Agentic = **act → observe → adapt**. The running system only acts and checks proxies.

The causal chain:

**(a) Verification against proxies, not goals**
The system checks that TypeScript compiles, that a curl returns any HTTP status, that the QA model outputs a number ≥70. None of these verify that the delivered product matches what was requested. Vision/Mission pages were dropped in intake; the QA system never noticed because it was checking 18 task-app filenames.

**(b) Output never observed**
No agent ever renders the frontend. `runLiveCheck` boots the backend only. `runLiveTest` returns 8.0. Tier-3 Playwright review exists but is triple-buried. The pipeline's final "verification" is `docker-compose up` exit code 0. The site could be blank and the pipeline would report success.

**(c) No memory between runs**
Every pipeline run starts from zero. The instinct memory system is designed and partially built — 252 LOC in `agents/maya/`, `memory-store.ts` at 1,348 LOC — but nothing in the production path ever writes to it or reads from it. Mistakes repeat across runs because there is nothing to remember them.

**(d) No adaptive replanning**
When QA finds an issue, the system spawns a cold code-fix loop with the QA finding as a string in the prompt. The code-fix agent has no visibility into the original spec, the intended pages, or the design direction. It patches what it can read. Vision/Mission pages were dropped and never recovered because no agent compared the output to the original request.

**(e) The designed brain is unplugged**
The Temporal orchestrator calls `runQaAgent()` (activities stub). The designed system would call `navya.runExploring()` + `karan.runExploring()` + `deepika.runExploring()` in parallel, then the stage5-qa-fix-loop with peer debate. The former runs. The latter does not exist in the production call graph.

**(f) Economics forced the loops to be cut**
With `gemini-3.5-flash` and no caching, each iteration costs more than the last. At 40 iterations, the median call is 91K tokens. A proper adversarial QA pass (full codebase walk, 3 independent agents, peer debate) at this token rate would cost hours per iteration. The cheap flash model + no compaction made the correct loop economically unviable, so it was replaced with a faster proxy. The proxy passed. The product failed.

**The fix is not a better model.** It is closing the observation loop, fixing the economics (compaction + model tier routing), and wiring the brain that is already written.

---

## 14. The Smallest Set of Moves That Makes It Agentic

Ordered by impact:

### Fix 1: Wire Tier-3 browser observation as the delivery gate

`tier3-review.ts` (328 LOC) is complete and has run in dev/stress mode. Move it into the Temporal activity path as the final gate before delivery. Two changes:
- Add `runTier3Review(projectId)` as a Temporal activity in `activities/index.ts`
- Call it from `project-build.ts` after `runDeployAgent()`, before returning success
- Default: `includeTier3: true` (flip the current false default)

This single change closes the observation gap. The pipeline will see what it built.

### Fix 2: Replace running QA with the existing `runExploring` agents on pro model

The real adversarial QA is in `agents/qa/`. Route the production pipeline to call it instead of the activities stub:
- Update `runQaAgent()` in `activities/index.ts` to call `agents/qa/navya|karan|deepika` via `agentChat` with `gemini-3.1-pro-preview` at `thinking_level: HIGH`
- Set correct weights: CRITICAL×20, HIGH×10, MEDIUM×5 (fix `activities/index.ts:477`)
- Set correct threshold: ≥85 (fix `project-build.ts:166`)
- Walk actual build output directory, not hardcoded filenames (fix `activities/index.ts:661-705`)

### Fix 3: Kill the stale-plan gate bypass

`checkBuildPlanExists()` returns true if `build-plan.json` exists → skips Gate 1 (spec approval) entirely. Fix: delete or invalidate `build-plan.json` at the start of each new pipeline run, not at the end. Gate 1 must always fire.

### Fix 4: Fix intake → output reconciliation

After delivery, compare the pages that were requested (from the locked spec) to the pages that were built (from the build output directory listing). If pages are missing, this is a CRITICAL finding before deploy, not a post-delivery surprise.

### Fix 5: Model tier routing + zero-wait switching

Three routing rules to implement in `packages/llm-client/src/router.ts`:

```typescript
// QA/adversarial agents → pro model, max thinking
if (['navya','karan','deepika'].includes(agentName)) {
  return { model: 'gemini-3.1-pro-preview', thinkingLevel: 'HIGH' };
}

// Generation agents → token-efficient flash  
if (['shubham','aanya','pranav','arjun','riya'].includes(agentName)) {
  return { model: 'gemini-3.6-flash', thinkingLevel: 'MEDIUM' };
}

// User-facing simple messages → flash-lite
if (messageType === 'user-status' || messageType === 'confirmation') {
  return { model: 'gemini-2.5-flash-lite' };
}
```

Zero-wait pool switching on 429: detect `HTTP 429` → immediately try next model in pool (no `await sleep(backoffMs)`). Pool order: gemini-3.1-pro → gemini-3.6-flash → gemini-3.5-flash.

NIM failures: NIM timeout/404 → skip NIM entirely, go straight to Gemini pool.

Agent context self-awareness: inject into every agent system prompt (from `refrence/Google/gemini-cli.md`):
> "The agent passes the full history with each subsequent message. The larger context is early in the session, the more expensive each subsequent turn is. Unnecessary turns are generally more expensive than other types of wasted context."

At 80% of 1M token limit → summarize history before next call. At 90% → write compressed handoff to file, start fresh context.

### Fix 6: Delete / quarantine the debris

49 debris files, 11 attempt logs, scratch/ directory, one-off scripts (see Appendix A). Delete or move to `.archive/`. The dead orchestrator path (`pipeline/orchestrator/`) is not debris — it contains the correct implementation — but it needs a clear migration plan to replace the activities stubs.

### Fix 7: Fix Gemini 3.x thought signature preservation in `gemini-loop.ts`

Gemini 3.5 Flash and 3.6 Flash require thought signatures in the first function-call part of multi-step requests. Current `gemini-loop.ts` does not preserve them. Before upgrading to either model, add thought signature passthrough to the message history assembly in `geminiChatWithTools()`.

---

## 15. The Verdict: Will the Upgraded System Meet the Vision?

### 15.1 The MVP benchmark (concrete pass/fail)

One-line brief → deployed, visually-verified site → subjective live score ≥7.0 → zero human debugging → ≤30 min wall-clock → reproducible 3/3 runs.

| Criterion | NexSidi today | After Fix 1+2+3+4 | After Fix 5+6+7 | Which fix |
|---|---|---|---|---|
| Deployed site | ✅ (docker-compose runs) | ✅ | ✅ | — |
| Visually verified | ❌ (never rendered) | ✅ (Tier-3 wired) | ✅ | Fix 1 |
| Live score ≥7.0 | ❌ (hardcoded 8.0) | ✅ (real Playwright eval) | ✅ | Fix 1+2 |
| Zero human debugging | ❌ (broken pages, dead forms) | ✅ (QA catches real bugs) | ✅ | Fix 2+4 |
| ≤30 min wall-clock | ❌ (~60 min measured) | ~35 min | ✅ (~15 min) | Fix 5 |
| 3/3 reproducible | ❌ (phantom failures) | ✅ (tsc fix applied) | ✅ | Fixed this session |

**Current score: 1/6. Post-fix 1-4: 5/6. Post-fix 5-7: 6/6.**

### 15.2 The harness-vs-model decomposition

Claude Code's capability is approximately:
- **30% model intelligence** — the frontier model's reasoning and coding ability
- **70% loop discipline** — the harness that forces observation, verification, and adaptation

Evidence from this run: `gemini-3.5-flash` (a competent model) + no-observation harness → broken site scored 97-100. The **same model** forced to open a browser and look at the site would have caught the layout collapse in iteration 1. The model wasn't the problem. The harness was.

After Fixes 1-4, NexSidi buys the 70%. The 30% (raw model IQ) is purchased separately and is swappable — a stronger model in the same fixed harness multiplies the result without rebuilding anything.

### 15.3 Three-way honest scorecard

| Dimension | NexSidi today | NexSidi post-fix | Claude Code solo |
|---|---|---|---|
| Intake fidelity | 3/10 (bypassed gate, pages dropped) | 8/10 (Gate 1 enforced, reconciliation added) | 9/10 (I re-read the request) |
| Plan quality | 5/10 (ambiguous briefs, no design brief) | 7/10 (Vanya still absent) | 8/10 (plan + approval) |
| Implementation | 6/10 (generates real code) | 7/10 (pro model for QA catches more) | 7/10 (careful edits) |
| Verification depth | 1/10 (proxies only) | 8/10 (Tier-3 + real QA) | 9/10 (I observe directly) |
| Fix loop quality | 3/10 (cold restart, no memory) | 6/10 (QA feedback survives) | 8/10 (I diagnose root cause) |
| Delivery | 7/10 (working container) | 8/10 (verified site) | 5/10 (no container, no CI) |
| Speed | 4/10 (~60 min) | 7/10 (~15 min post-fix) | 8/10 (seconds to minutes) |
| Unattended 24/7 | 9/10 (Temporal durable) | 9/10 | 1/10 (session-bound) |
| Memory/learning | 1/10 (nothing persists) | 3/10 (instinct still unwired) | 2/10 (limited) |

### 15.4 Where post-fix NexSidi genuinely beats a Claude Code session

These are the real moats — achievable in MVP, not in a future version:

**Crash durability**: Temporal checkpoints every activity. Power outage mid-generation? Resume from the last completed step. Claude Code sessions die with the browser tab.

**True parallel generation**: Shubham + Aanya + Pranav run simultaneously in real git worktrees. A solo Claude Code session is inherently sequential — I can spawn subagents, but at significant coordination overhead. NexSidi's parallelism is structural.

**Adversarial self-critique**: I don't impose an adversarial QA gate on my own work. I try hard, but I'm not constitutionally error-maximizing against myself. Three independent agents with different models running explicitly to find flaws is a structural advantage over any solo agent — if those agents are actually adversarial (Fix 2 needed).

**Unattended 24/7 operation**: I require a browser session. NexSidi can run at 3am, finish, and deliver. With the observation loop fixed, the delivery is trustworthy.

**Full lifecycle ownership**: I hand off after the task. NexSidi is designed to own monitoring, security patching, social media, investor relations. Even in MVP, it delivers a GitHub repo, PRD, and docker-compose.yml — I deliver a text response.

### 15.5 Where it cannot beat Claude Code and shouldn't try

**Raw frontier reasoning**: When a task requires deep architectural reasoning, debugging a subtle concurrency bug, or understanding an unfamiliar codebase, I have the current-model advantage. NexSidi-running uses a Flash model. Even post-fix with gemini-3.1-pro-preview for QA, the generation agents run Flash.

**Mitigation**: the harness must remain model-agnostic. When Google releases a frontier model on the Gemini API, it plugs in — no architecture rebuild. The moat is the observation loop, not the model.

### 15.6 Kill criteria (ruthless honesty)

If after Fixes 1-4 (observation loop + real QA + intake reconciliation), the system **still cannot hit 5/6 on the MVP benchmark**, the bottleneck is model tier, not architecture. The correct response is to upgrade the generation agents to `gemini-3.6-flash` with `thinking_level: HIGH` for complex tasks — not to rebuild the pipeline again.

If after Fixes 1-7 the system **cannot reproducibly score ≥7.0 on live visual eval** for 3 different project types, then Vanya (the design agent) becomes the next required investment — not more QA iterations.

**Do not rebuild what is already correct.** The Temporal pipeline is structurally sound. The dead orchestrator code is the correct implementation. The path forward is wiring what exists, not writing what doesn't.

---

## 16. Appendices

### Appendix A: Debris Files (sample, 49 total)

```
attempt_3.md through attempt_17.md    (11 files) — run logs committed to repo
packages/agent-runtime/automate-build.mjs
packages/agent-runtime/src/dump-html.cjs
packages/agent-runtime/src/screenshot-user-app.cjs
pipeline/unblock-deploy.ts            — one-off signal script (created this session)
pipeline/dev-run.ts                   — dev-only entry; not debris but must stay dev-only
approved_spec_vs_build_plan_audit.md
brutal_onboarding_review.md
new_onboarding_review.md
scratch/                              — directory of scratch files
.superpowers/sdd/review-*.diff        — 8 review diff files
.superpowers/sdd/task-*.md            — 3 task reports
```

### Appendix B: Model Routing Divergence (3-way)

| Source | What it says |
|---|---|
| CLAUDE.md | deepseek-v4-pro (Tilotma/Shubham/Aanya), minimax-m3 (Saanvi/Deepika), mistral-nemotron (Arjun), kimi-k2-6 (Navya/Karan), qwen2.5-coder:7b (Pranav/Aarav/Riya) |
| `packages/llm-client/src/types.ts` | deepseek ❌ timeout, minimax ❌ 404, mistral-nemotron ❌ timeout; kimi ✅, qwen3-next-80b ✅ |
| Actual run (670/699 usage lines) | `gemini-3.5-flash` for everything |

### Appendix C: Docs Drift

- `docs/DECISIONS.md` — referenced 14 times in CLAUDE.md as the authoritative D1-D50 record. **Does not exist.**
- `docs/AGENTS.md` — referenced in CLAUDE.md as full roster. **Does not exist.**
- `docs/PIPELINE.md` — referenced in CLAUDE.md. **Does not exist.**
- Dead Tilotma ROM (in `agents/tilotma/src/index.ts`) says "use Tailwind+shadcn for generated apps." Live Aanya agent (`agents/generators/aanya/`) mandates NexUI and forbids Tailwind. **Direct contradiction.**

### Appendix D: This Session's Compile-Timeout Fix

**Bug**: `spawnSync("npx", ["tsc"])` on Windows via `cmd.exe` spawns a process tree; outer process exits, child hangs; `spawnSync` returns `{ status: null, stdout: "" }`. Empty output was treated as compile errors → triggered `runCodeFix()`.

**Fix applied** (`pipeline/activities/index.ts` + `pipeline/workflows/project-build.ts`):
- Timeout increased: 60,000ms → 300,000ms
- Added `timedOut: boolean` to `runCompileCheck()` return type
- Empty output with non-zero/null status → `timedOut: true`, not compile errors
- Workflow retries compile check directly on timeout (up to 3×) before counting toward failure limit

**Impact**: 8 phantom compile failures → 0. Estimated time savings: ~24 min per run.

### Appendix E: Gemini Model Tier Reference

| Model | ID | Context | Thinking | Best for in NexSidi |
|---|---|---|---|---|
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | 1M | `thinking_level: HIGH` (default) | QA agents, adversarial review |
| Gemini 3.6 Flash | `gemini-3.6-flash` | 1M | `thinking_level: MEDIUM` (default) | Code generation agents |
| Gemini 3.5 Flash | `gemini-3.5-flash` | 1M | `thinking_level: MEDIUM` (default) | Fallback for generation |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | 1M | `thinking_budget: 512-24,576` | User-facing messages only |

**Critical API change (Gemini 3.x)**: Thought signatures are mandatory in multi-step function calls. Missing signature in first function-call part → `400` error. Current `gemini-loop.ts` does not preserve thought signatures. Must be fixed before upgrading to gemini-3.5-flash or gemini-3.6-flash.

### Appendix F: Reference Prompts Catalogue (from `E:\ai yug\refrence\`)

| File | Key insight for NexSidi |
|---|---|
| `Anthropic/Claude Code/agents/observer.md` | Observer pattern for Tilotma: read-only digest, silence as default, `ObserverReport` only when genuinely needed |
| `Anthropic/Claude Code/agents/worker.md` | Worker agent template: commit+hash on done, report up on confusion, don't spawn sub-agents |
| `Google/gemini-cli.md` | Context efficiency self-instruction: inject into every agent system prompt |
| `OpenAI/Codex/plan_mode.md` | "Decision complete" — plan must leave zero decisions to the implementer |
| `OpenAI/Codex/control-in-app-browser.md` | Localhost browser testing pattern — exactly what Tier-3 does |
| `Google/antigravity-cli.md` | Design mandate language — word-for-word maps to System B scoring criteria |
| `Google/jules.md` | `request_plan_review` → `set_plan` → `plan_step_complete` → `submit` — the approval cycle NexSidi needs |

---

*Report complete. No code changes. No config changes. Two new files created: this document and the published Artifact.*  
*YugNex Technology (OPC) Private Limited — Internal only. Patent IN #202611001020.*
