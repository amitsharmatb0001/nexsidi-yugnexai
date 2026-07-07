# NexSidi Full System Audit — 2026-07-03

**Scope:** Every file on the execution-critical path, read in full, with findings cross-referenced
against 10 real stress-test runs (attempts 1-10, logs preserved in `.nexsidi/sdd/progress.md`).
**Method:** Code-first. Every finding cites file:line and, where applicable, the run log that proves it.
No theoretical findings — if it wasn't observed or provable from code, it's marked as risk, not fact.

**Files audited (complete list):**
`packages/agent-runtime/src/{loop,claude-loop}.ts`, all 8 tools in `packages/agent-runtime/src/tools/`,
`packages/llm-client/src/{nim,claude,router,types,circuit-breaker,token-bucket}.ts`,
all 6 stages in `pipeline/orchestrator/stages/`, `pipeline/orchestrator/{run,gateway,checkpoint,dag,flags}.ts`,
`agents/{saanvi,arjun}/src/index.ts`, `agents/generators/{shubham,aanya,pranav}/src/index.ts`,
`agents/qa/{navya,karan,deepika}/src/index.ts`, `agents/tilotma/src/{tier3-review,orchestrator,index}.ts`,
`agents/riya/src/index.ts`, `nexui-publish/{nexui,nexui-react}/package.json`.
**Not audited (not on execution path):** legacy Temporal pipeline (`pipeline/workflows/`,
`pipeline/activities/`), `apps/api`, `apps/web`, sandbox/ (Rust), docs.

---

## 1. Executive summary

The stage machine, gates, checkpoint format, hash chain, QA scoring contracts, and escalation
*trigger* are sound. The execution layer underneath them has **31 concrete defects**, of which
**6 are structural walls** that guarantee failure on a level-2/3 app regardless of any prompt
tuning. The open-source models are NOT the primary problem: the harness truncates their output
mid-JSON, poisons their conversation history with the truncated corpse, hides build errors from
them, and blocks their event loop — then we conclude they "can't code." A 7B local model (Pranav)
succeeds 10/10 runs because it bypasses the loop entirely.

**The one-sentence diagnosis:** this system currently converts model capability into failure
through harness defects, then pays Claude to dig it out — the exact inverse of the intended
cost model.

---

## 2. Findings register

Severity: 🔴 blocks delivery / guarantees failure at scale · 🟡 wastes time or money · 🟢 hygiene.
Each entry: evidence → blast radius of the fix → risk of the fix.

### Layer 0 — Environment / scaffold

**E1 🔴 Vendored NexUI devDependencies break every frontend build.**
`nexui-publish/nexui-react/package.json` declares `devDependencies: @types/react@^18` +
`@types/react-dom@^18`. Generated apps pin React 19. `npm install` of a `file:` dep installs its
devDependencies → `vendor/nexui-react/node_modules/@types/react` (v18) conflicts with root v19 →
`next build` type errors. **Evidence:** runs 8/9/10 — every model (glm, mistral, Claude) fought
this; Claude wrote `clean-types.js`/`_cleanup.js` to delete nested node_modules each run.
Ate 30-50% of all frontend iterations. **Fix:** strip devDependencies in `vendorNexui()`
(`agents/generators/aanya/src/index.ts:55-70`) + add `overrides` to the scaffold package.json.
**Blast radius:** one function; nothing depends on vendored devDeps. **Risk:** none.

**E2 🟡 Scaffold package.json has no `overrides` block** — related mitigation for E1; also protects
against future transitive type conflicts. Same file, same fix window.

**E3 🟡 Platform Clerk keys copied into generated user apps.**
`aanya/src/index.ts:365-366`: `.env.local` gets `process.env.CLERK_SECRET_KEY` — the PLATFORM's
secret key ships inside every generated app. Works for local demo; unacceptable for delivery
(user receives your credentials). **Fix:** per-project Clerk app provisioning or explicit
placeholder + setup instructions. Design decision needed, not a code patch.

### Layer 1 — LLM transport (`packages/llm-client`)

**T1 🔴 THE ROOT CAUSE CHAIN: 8192-token cap → truncated tool JSON → poisoned history → circuit-breaker death spiral.**
- `nim.ts:102`: tool-call `max_tokens = Math.min(8192, ...)`. A complete Next.js page is 9-12K
  tokens of JSON-escaped `write_file` arguments → truncated mid-string, `finish_reason: "length"`.
- `nim.ts:83` declares `"length"` as a possible finish_reason; `loop.ts:133-138` never checks it.
- `loop.ts:125-130` pushes the truncated assistant message into history as-is; every subsequent
  request replays the malformed JSON; NIM 400s on it. **Evidence:** run 5 —
  `"Expecting ',' delimiter: line 1 column 837"` at the SAME column 14 consecutive times.
- `circuit-breaker.ts`: 5 failures → OPEN 60s; poisoned history guarantees the HALF_OPEN probe
  fails → re-OPEN forever. Remaining iterations burn as `sleep(5000)` (`loop.ts:115`).
- Claude escapes only because `claude-loop.ts:52` builds a FRESH history with
  `TOOL_CALL_MAX_TOKENS=16000` + streaming (`claude.ts:36,211`).
**Fix bundle (must land together):** (a) handle `finish_reason==="length"` — respond with a
"your output was truncated, write this file in smaller pieces or use edit_file" tool error and DO
NOT push the truncated tool_calls; (b) sanitize any unparseable tool_call `arguments` to `"{}"`
before storing in history; (c) pair with L7 (edit tool) which makes large single-shot writes rare.
**Blast radius:** loop.ts only. **Risk:** low; raising the 8192 cap alone WITHOUT compaction would
accelerate 32K context exhaustion — do (a)+(b), not a blind cap raise.

**T2 🔴 `nim.ts` fetch has NO timeout.** `http.ts:23-25` uses AbortController; `nim.ts:33` does not.
A hung NIM connection stalls the entire pipeline indefinitely. Likely implicated in run 9's
empty-response crash and the stale "mistral-nemotron ❌ timeout" note. **Fix:** AbortController,
120s. **Risk:** none.

**T3 🟡 Zero fallback observability.** `router.ts:44` returns `modelUsed`; every caller
(`saanvi:57`, `arjun:64`, QA agents) destructures `{content}` only. Nobody knows which model
actually served any one-shot call. Arjun's primary (`mistral-nemotron`) is marked
"❌ timeout" in `types.ts:15` comments yet is still `AGENT_MODELS.arjun` — it may be silently
failing every call, adding a full timeout of latency to every Stage 1 (invisible without T2's
timeout, unbounded). **Fix:** log `modelUsed` + accumulated errors on every agentChat return.

**T4 🟡 Token bucket permits 4× the real rate.** `token-bucket.ts` comment: "4 keys = 4× capacity…
client round-robins keys." `nim.ts` takes ONE key; no round-robin exists anywhere. Limits set to
160 RPM against a real 40. Either build multi-key round-robin or set limits honestly to 40.

**T5 🟢 Circuit breaker is global per-model in-process** — one agent's poisoned history opens the
breaker for all agents on that model (`circuit-breaker.ts` module-level Map). Compounds T1;
acceptable once T1 is fixed.

**T6 🟡 No temperature on NIM tool calls** (`nim.ts:111-117` sends no `temperature`). Server
default (typically 1.0) maximizes JSON malformation probability in tool arguments. **Fix:**
`temperature: 0.2` for tool-calling requests. **Risk:** marginally less varied code; correct trade.

**T7 🔴 (cost) No prompt caching in `claude.ts`.** No `cache_control` anywhere in the file.
Every iteration resends full context at $3/MTok. Measured effect: ~$10 for 32 iterations.
With ephemeral cache on system+tools+prefix: cached reads at $0.30/MTok → same session ≈ $2-3.
**Blast radius:** claude.ts request builders only. **Risk:** none.

**T8 🟢 Adaptive thinking on every turn at default (high) effort** — thinking tokens are output
tokens. Consider effort reduction for routine tool turns after T7 lands; measure first.

### Layer 2 — Agent loop (`packages/agent-runtime`)

**L1 🔴 Poisoned-history replay** — see T1(b).

**L2 🟡 `write_file` object-content not coerced.** Run 7 iterations 9-14: model sent `content` as
a JSON object 5× in a row; `writeFileSync` throws; generic error teaches the model nothing.
**Fix:** coerce (`typeof content === "object" → JSON.stringify(content, null, 2)`) or return
"content must be a STRING" pointed error.

**L3 🟡 Transport failures consume the iteration budget.** `loop.ts:99-116` — `iterations++`
precedes the call; breaker-open failures are sleep(5s)+continue. Runs 3/5/7: 30+ "iterations"
with zero model interaction. **Fix:** iterations count model turns; 5 consecutive transport
failures → abort pass to escalation immediately.

**L4 🟡 No stuck detection.** Run 6: identical `read_file("/api/v1/notes")` 20+ consecutive times.
**Fix:** hash last N (tool,args); 3 identical **read-class** calls with no intervening write →
abort to escalation. Careful: repeated `run_command` builds interleaved with writes are LEGITIMATE
debugging — only flag pure read/list repetition.

**L5 🔴 (scale) No context management at all.** `messages.push` forever (`loop.ts:214`,
`claude-loop.ts:165`); re-reads append duplicate copies (run 10: `DashboardClient.tsx` in context
5×). Quadratic token growth; NIM's 32K ceiling is hit around iteration ~20 with real files.
**Fix (preferred):** A1 per-task decomposition bounds each conversation naturally.
**Fix (secondary):** replace tool results older than N turns with `[stale — re-read if needed]`.

**L6 🟡 Escalation cold start.** `claude-loop.ts:52-55` — fresh `[system, initialMessage]`;
NIM pass's `errors` (contains the actual failing build output!) and `filesWritten` are discarded.
Run 10: Claude's first 3 iterations = 16 `read_file` calls re-reading what mistral just read.
**Fix:** append a `PREVIOUS ATTEMPT SUMMARY` block (errors tail + filesWritten) to Claude's
initial message. ~5 lines.

**L7 🔴 (cost+T1 synergy) No `edit_file` tool.** Only whole-file `write_file` exists
(`file.ts:85-98`). Full-file rewrites: (a) burn output tokens at $15/MTok, (b) are the very
payloads that trip T1's 8192 truncation. An anchor-based find/replace edit tool removes both.
**Blast radius:** new tool + one prompt paragraph per generator + `filesWritten` bookkeeping.

**L8 🟡 No search tool (grep).** Agents must list+read whole files to find anything; drives L5
context growth. Cheap to add (read-only, sandboxed).

**L9 🔴 (scale) `MAX_ITERATIONS=40` is the wrong unit and the wrong size.** It counts transport
failures and sleeps (L3), and the notes app already used 37 productive iterations for 15 files.
A level-2/3 app (30-50 files) cannot fit. **Fix:** count productive tool calls; size per task
via A1, not per whole-app pass.

**L10 🟡 Zero cost telemetry.** `NimResponse.usage` and Claude usage are discarded everywhere
(`loop.ts:106` ignores it; `claude.ts` never reads `response.usage`). A system whose pitch is
cost-efficiency does not measure cost. **Fix:** accumulate per-run tokens into `AgentRunResult`,
log per stage, persist in checkpoints.

### Layer 3 — Tools

**TO1 🔴 Error output decapitated.** `command.ts:62-63`: `stdout.slice(0, 6000)` keeps the HEAD.
`next build` / `npm install` put the real error at the END. Models saw webpack noise and never the
failure line — hence 6 blind rebuild attempts per run. **Fix:** keep tail (`slice(-6000)`) or
head(1000)+tail(5000). **Blast radius:** every agent's debugging ability, immediately.

**TO2 🟡 Allowlist landmines.** `command.ts:6-15`: `rm` absent (agents provably need it — run 10
`rm -rf .next` blocked; Claude worked around via `node -e fs.rmSync` — an allowlist bypass through
an allowlisted binary, worth acknowledging: `node -e` makes the allowlist advisory, not a boundary).
Pipes silently broken (`spawnSync` without shell passes `|` as literal arg). Tool description
(`command.ts:90`) doesn't enumerate the rules — every agent rediscovers them by wasted iterations.
**Fix:** document allowlist + "no pipes" in the tool description; add `rm` with arg validation
(resolved paths must stay within sandboxDir).

**TO3 🔴 (scale) `spawnSync` blocks the Node event loop.** `command.ts:55`, `docker.ts:27`.
During any `npm install` (2-3 min) or `docker build` (10 min), EVERYTHING in-process freezes —
including the "parallel" Pranav+Shubham of Stage 4 (`stage4:148` `Promise.all` is fake parallelism
when tools are synchronous). **Fix:** async `spawn` wrapped in a promise. **Blast radius:** all
run_command/docker call sites (signatures go async — loop already awaits results); enables P3.

**TO4 🟢 `read_file` has no line numbers** — models can't map `tsc` line errors onto content.
Minor efficiency loss.

### Layer 4 — Agents

**A1 🔴 (scale — the structural fix) Generators throw away Arjun's task decomposition.**
Arjun produces `aanyaTasks`/`shubhamTasks` with exhaustive `outputFiles` per task
(`arjun/src/index.ts:169-201`, verified in prompt schema) — and `buildAgentTask` concatenates
everything into ONE prompt for ONE 40-iteration loop. The decomposition the architecture is named
for exists as data and is discarded as structure. **Fix:** iterate tasks — one bounded `runAgent`
call per task (fresh context, shared sandboxDir, per-task verification), escalation per-task.
This single change bounds context (kills L5 at the root), right-sizes budgets (L9), makes NIM
models viable at level 2-3 (each task fits 32K), and gives resume granularity.
**Proof the pattern works:** Pranav (`pranav/src/index.ts:17-45`) — deterministic rendering from
Arjun's structured spec + one tiny LLM call — succeeded 10/10 runs on a 7B local model.

**A2 🟡 Extend the Pranav lesson:** config/wiring files (`routes/index.ts`, `package.json`,
`next.config.ts`, `tsconfig.json`) should NEVER be LLM-written mid-loop — the logs show models
rewriting package.json 5× (runs 7/8). Render them deterministically from the plan; agents write
business logic only. (Shubham's prompt at `index.ts:91` even claims routes/index.ts is
"auto-generated" — nothing auto-generates it; the claim is stale and models overwrite it manually.)

**A3 🔴 (scale) QA-by-blob architecture fails at level 2-3.**
`stage5:129` `MAX_CODE_CHARS=200_000` (~50K tokens) vs NIM 32K context → overflow OR silent
truncation → **unreviewed code shipping past a security gate that reports PASS**. Also 3× duplicate
payload (all three agents get the identical blob). **Fix:** make QA agents tool-using with
READ-ONLY tools (list/read/grep — D26-compliant: no write tools, fresh context); each walks the
repo itself, scoped (Karan: backend+auth surfaces; Deepika: queries/hooks; Navya: everything).

**A4 🟡 Fault isolation never actually routes.** `stage4:52-58` matches `file.startsWith("backend/")`
but `collectCode` (`stage5:171`) strips roots — real paths are `src/controllers/notes.ts`.
Run 10's `faultAgent:"shubham"` was the default, not routing; frontend findings would misroute to
Shubham. **Fix:** prefix `backend/`/`frontend/` in collectCode's relPath.

**A5 🔴 LATENT: Tier 3 reviews a URL nothing has started.** `tier3-review.ts:48` defaults to
`http://localhost:3000`; Tier 3 runs inside Stage 5 (`stage5:113`), but the app is only started by
Riya in Stage 6 (`run.ts:120`). The Reality Checker's contract (unreachable app = NEEDS_WORK,
`tier3-review.ts:156-174`) means **the first time static QA passes, Tier 3 will fail 100% of the
time, every run, forever.** Never observed only because QA has never passed. **Fix:** move Tier 3
after Stage 6's deploy (matches the design doc's "live testing" placement), gate final delivery
on it, or start a dev server inside Stage 5.

**A6 🔴 No QA→fix loop — the delivery blocker.** `run.ts:116-118`: `pass:false` → return. The
design doc's fault-isolated fix-retest loop (and Patent Claim 10's 100% retest) is unimplemented.
Run 10 ended exactly here with genuine SQL-injection findings and a correctly-identified culprit —
and no mechanism to hand the findings back. **Fix:** loop (max N, stuck-detection per D19):
findings → responsible agent as a focused fix task (small context: findings + affected files
only) → full re-QA. Depends on A4 for routing.

**A7 🟡 Saanvi/Arjun one-shot with no retry.** Run 9: one empty NIM response crashed the whole
pipeline in 12s. Both have solid fence-stripping parsers (`saanvi:88-99`, `arjun:157-168`) but
zero retry. **Fix:** one retry on empty/unparseable content before throwing.

**A8 🟢 Prompt hygiene:** Shubham prompt's stale "auto-generated" claim (A2); Aanya's prompt
hardcodes NexUI API docs — see Skills section.

### Layer 5 — Pipeline orchestration

**P1 🔴 Checkpoints are write-only theater.** `writeCheckpoint` at every stage (`run.ts:94-121`);
`readCheckpoint` is never called by the orchestrator. A crash at minute 80 re-runs (and re-bills)
everything from Stage 1. **Fix:** on start, read existing checkpoints and skip completed stages
(`--fresh` flag to override). **Blast radius:** run.ts only; staleness is acceptable in dev.

**P2 🟡 Frontend built twice in full.** Preview (Stage 3) + integrate (Stage 4) are each a full
40+40-iteration campaign; integrate re-runs `npm install`, re-triggering E1. Run 10: ~136 LLM
round trips for one frontend. **Fix (design):** preview generates the real API client behind a
mock/live switch; integrate becomes a small diff pass. Product gate (user approves design first)
is preserved.

**P3 🟡 Backend could run parallel to Stage 3.** Shubham/Pranav depend only on the BuildPlan
(locked in Stage 1). Requires TO3 first (else parallelism is fake). Saves 20-30 min wall clock.

**P4 🟢 DAG is decorative.** `stage1:61` hardcodes `dependsOn: []`; `stage4:136` `void dag`.
Fine today; becomes real when level-2/3 features have cross-dependencies.

### Layer 6 — Scale walls (level-2/3 app: ~8 tables, ~25 endpoints, 30-50 frontend files)

In the order the system would hit them:
1. **L9/A1** — iteration cap: 37 iterations for 15 files → cap-out at ~20 files → both tiers fail.
2. **L5** — NIM 32K context exhausted ~iteration 20 with real file sizes → 400s → death.
3. **A3** — QA blob: 300-500K chars source > 200K cap → truncated security review = silent
   vulnerability pass-through; > 32K context = QA crash.
4. **A5** — Tier 3 dead-URL: guaranteed fail the first time everything else passes.
5. **P1** — no resume: a multi-hour run with any crash restarts from zero.
6. **T7/L7 economics** — without caching + edits, extrapolated level-2/3 cost ≈ $30-60/run.

**Conclusion: the current system cannot deliver a level-2/3 app.** Every wall above has a named
fix; none requires research; A1 is the keystone.

---

## 3. The skills question — YES for knowledge, NO for discipline (with proof)

**YES — add a skill system for versioned knowledge.**
Aanya's system prompt hardcodes the entire NexUI component API (`aanya/src/index.ts:101-134`) —
sent every iteration whether relevant or not, stale the day NexUI v2.1 ships, invisible to Neha
(the agent designed to keep knowledge current). The right shape is exactly Claude Code's:
`skills/` directory (`nexui-components.md`, `nextjs-16-gotchas.md`, `clerk-integration.md`,
`drizzle-conventions.md`, `express-security.md`) + a `load_skill` read-only tool + one prompt line
("load the relevant skill before writing code for that area"). Progressive disclosure cuts
steady-state prompt tokens and gives Neha a single write-point for knowledge updates.

**NO — skills cannot carry enforcement.** The proof is in this session's own data: Shubham's
prompt already contains `"SQL: use $1, $2 placeholders — NEVER string interpolation"`
(`shubham/src/index.ts:101`) and run 10's generated code string-concatenated SQL anyway — Karan
caught real injection. Instructions are probabilistic on mid-tier models. Your own architecture
decision D28 states the principle: skills fire 50-80%, hooks fire 100%. Discipline must be
deterministic: **post-write validation hooks in `execWriteFile`** — regex-scan written
`controllers/*.ts` for interpolation inside SQL strings, scan frontend files for forbidden
imports (tailwind/shadcn), reject the write with a pointed error at write time. Catch the
SQL injection when it's typed, not 40 minutes later in QA.

---

## 4. What is sound — do not touch

Stage machine + gateway + checkpoint format (`run.ts`, `gateway.ts`, `checkpoint.ts`) ·
hash-chain handoffs (real, cheap, exercised) · QA scoring contracts (zero-tolerance vs weighted,
D25 default-FAIL — proven by catching real SQLi) · escalation trigger logic (3 proven rescues) ·
glm-5.2 roster decision (evidence-based, validated by run 10) · Pranav's deterministic-render
pattern (10/10) · path traversal guards in tools · Saanvi/Arjun fence-stripping parsers.

---

## 5. Remediation roadmap (dependency-ordered)

**Phase A — stop sabotaging the models (≈1 day, all mechanical):**
E1+E2 (vendor devDeps), TO1 (error tails), T1 bundle (length handling + history sanitize),
T2 (fetch timeout), T6 (temperature), L2 (content coercion), L3 (failure budget), A7 (one-shot
retry), A4 (fault-path prefixes), T3+L10 (modelUsed + usage telemetry).
*Gate: re-run stress1 — expectation: NIM tier completes preview solo, no escalation.*

**Phase B — stop overpaying (≈0.5 day):**
T7 (prompt caching), L6 (escalation context handoff), L7 (edit_file), TO2 (allowlist docs + rm).
*Gate: re-run stress1 — expectation: ≤25 min, ≤$1.50 total, measured by L10 telemetry.*

**Phase C — actually deliver (≈1-2 days):**
A6 (QA-fix loop) + A5 (Tier 3 after deploy) + P1 (resume from checkpoint).
*Gate: stress1 reaches Stage 6, user gets localhost URL. First full delivery.*

**Phase D — survive level 2-3 (≈2-3 days):**
A1 (per-task decomposition — keystone), A3 (QA with read-only tools), TO3 (async spawn) + P3
(backend ∥ preview), L4 (stuck detection), A2 (deterministic config rendering).
*Gate: stress2 (level-2 app: multi-entity + relations + dashboard) delivers in ≤60 min.*

**Phase E — knowledge + enforcement (≈1 day):**
Skills system (`load_skill` + skills dir) + deterministic write-hooks (SQL/import validation),
L8 (grep tool), P2 (preview/integrate diff pass).

Do not reorder C before A/B: the QA-fix loop multiplies whatever the loop economics are —
looping a broken, expensive loop makes cost worse, not delivery better.

---

## 6. Measurement contract (no "hope it works")

Every phase gate is a real stress-test run with three recorded numbers (enabled by L10):
wall-clock minutes, total tokens per tier (NIM/Ollama/Claude), and furthest stage reached.
Baseline (run 10): 94 min, unmeasured tokens (~$10+ Claude), Stage 5.
A system change with no measured delta against baseline is reverted, not kept on faith.
