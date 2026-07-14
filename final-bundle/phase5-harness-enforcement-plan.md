# Harness Enforcement Layer Implementation Plan (Phase 5)

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make core-reasoning Rules 6 (evidence), 7 (3-strike), and 9
(output contracts) mechanically unskippable for every agent on every
provider, and inject skill doctrine into agent system prompts at
runtime.

**Architecture:** All enforcement lives in `packages/agent-runtime` as
provider-agnostic modules consumed by the shared `runAgent` while-loop
pattern. The NIM loop (`loop.ts`) is the primary integration point;
`claude-loop.ts` and `gemini-loop.ts` reuse the same modules exactly as
they already reuse `buildToolList()` and the tool exec functions —
additive integration, no rewrite of the parallel loops. Enforcement is
default-FAIL: the `task_complete` tool call is *rejected* (not
discouraged) when gates aren't satisfied.

**Tech Stack:** TypeScript + Bun (existing), zod for contract schemas
(add to agent-runtime), no new services.

## Global Constraints

- Provider-agnostic: nothing NIM/Ollama/Gemini/Claude-specific in any
  new module — loops pass plain data in, get plain decisions out
- Naming: real package is `packages/agent-runtime` (docs/skills saying
  "nexsidi-agent-tools" are stale — update refs in Task 8, do not
  rename the package)
- All new modules unit-testable with zero infra (no DB/Temporal/network
  at import time — follow Riya's dynamic-import pattern where needed)
- Existing tests (`loop.test.ts`, `claude-loop.test.ts`,
  `deploy-target.test.ts`) must stay green after every task
- Every task: bun test cycle per nexsidi-testing; evidence per
  nexsidi-verification before its commit

---

### Task 1: Evidence Ledger (Rule 6, structural)

**Files:**
- Create: `packages/agent-runtime/src/enforce/evidence.ts`
- Test: `packages/agent-runtime/src/enforce/evidence.test.ts`

**Interfaces:**
- Produces: `createEvidenceLedger(): EvidenceLedger` with
  `record(kind: "command_output" | "file_read" | "http_check", ref: string): void`,
  `hasFreshEvidence(): boolean`, `consume(): EvidenceRecord[]`

Per-run in-memory ledger. Tool executors report into it; completion
gate reads it. `consume()` returns-and-clears so the NEXT completion
claim needs fresh evidence (same consume semantics as the bash
verify-gate hook in nexsidi-master-workflow — closing its stated gaps:
ledger is per-run and typed, not a shared file).

- [ ] **Step 1: Write failing tests** — fresh ledger has no evidence;
  record→has; consume returns records and clears
- [ ] **Step 2: Run, verify FAIL** — `bun test evidence.test.ts`
- [ ] **Step 3: Minimal implementation**
- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit** — `feat(agent-runtime): per-run evidence ledger`

### Task 2: Wire Tool Executors into the Ledger

**Files:**
- Modify: `packages/agent-runtime/src/tools/command.ts` (execRunCommand)
- Modify: `packages/agent-runtime/src/tools/http.ts` (execHttpRequest)
- Modify: `packages/agent-runtime/src/tools/file.ts` (execReadFile)
- Test: extend `evidence.test.ts` with executor-integration cases

**Interfaces:**
- Consumes: `EvidenceLedger` from Task 1 (passed as optional param —
  executors stay callable without a ledger so existing call sites and
  tests keep compiling)

Successful command runs, HTTP checks, and file reads record evidence.
Failed executions record NOTHING (a failed test run is not evidence of
success — it's evidence for debugging, which the transcript already
has).

- [ ] Steps 1–5 per format (failing test → fail → impl → pass → commit)

### Task 3: Completion Gate — task_complete Rejected Without Evidence

**Files:**
- Create: `packages/agent-runtime/src/enforce/completion-gate.ts`
- Modify: `packages/agent-runtime/src/loop.ts` (task_complete branch only)
- Test: `packages/agent-runtime/src/enforce/completion-gate.test.ts`

**Interfaces:**
- Consumes: `EvidenceLedger` (Task 1)
- Produces: `checkCompletion(ledger, claim): { allowed: true } |
  { allowed: false, reason: string }`

When the model calls `task_complete` with no fresh evidence, the loop
does NOT complete — it returns the rejection reason as the tool result
("Completion rejected: no verification evidence this run. Run your
check, read its output, then call task_complete.") and continues the
while-loop. Rejection consumes an iteration (counts toward
MAX_ITERATIONS) so a model spamming task_complete still terminates.

- [ ] Steps 1–5. Key test: loop with task_complete-before-any-command
  → completion rejected → after execRunCommand succeeds →
  task_complete accepted. Verify `loop.test.ts` still green.

### Task 4: Strike Counter — Mechanical 3-Strike Escalation (Rule 7)

**Files:**
- Create: `packages/agent-runtime/src/enforce/strikes.ts`
- Modify: `packages/agent-runtime/src/loop.ts` (command-failure branch)
- Modify: `packages/agent-runtime/src/claude-loop.ts` (escalation entry
  — `runAgentEscalated` gains `reason: "three_strikes" | "cannot_finish"`)
- Test: `packages/agent-runtime/src/enforce/strikes.test.ts`

**Interfaces:**
- Produces: `createStrikeCounter(limit = 3)` with
  `recordFailure(signature: string): { strikes: number, exhausted: boolean }`

Failure signature = normalized (command + first line of stderr).
Three failures with the SAME signature → loop stops retrying: injects
a forced-pivot message ("This approach failed 3 times with the same
error. Do not retry it. Change approach fundamentally or call
escalate.") and, if the next same-signature failure occurs anyway,
terminates the run with `exhausted: three_strikes` so
`runAgentEscalated` fires exactly once with a logged reason
(nexsidi-token-budget: every escalation logged with cause).

- [ ] Steps 1–5. Key tests: different signatures don't accumulate;
  same signature ×3 → exhausted; escalation reason logged.

### Task 5: Output Contract Validator (Rule 9)

**Files:**
- Create: `packages/agent-runtime/src/enforce/contracts.ts`
- Create: `packages/agent-runtime/src/enforce/contracts/schemas.ts`
  (zod: ProjectSpec, BuildPlan, DeployResult, ReadyToBuild marker,
  PASS/NEEDS_WORK verdict — mirror existing types, do not redefine
  semantics)
- Test: `packages/agent-runtime/src/enforce/contracts.test.ts`

**Interfaces:**
- Produces: `validateHandoff(kind: ContractKind, raw: string):
  { ok: true, value: T } | { ok: false, errors: string[] }`

Called at every agent boundary BEFORE the context-chain hash is
computed — a malformed handoff is rejected back to the producing agent
with the exact zod errors as a retry message (max 2 contract retries,
then strike counter takes over). Never hash-and-forward invalid
output: the chain must certify integrity of VALID artifacts.

- [ ] Steps 1–5. Key tests: valid ProjectSpec passes; missing field →
  exact error path; `__READY_TO_BUILD__` with trailing text → reject;
  first-line PASS/NEEDS_WORK contract enforced.

### Task 6: Prompt Assembly — Skills Injected at Runtime

**Files:**
- Create: `packages/agent-runtime/src/prompt-assembly.ts`
- Create: `packages/agent-runtime/skills/` (checked-in copies:
  `core-reasoning.md` + per-agent doctrine files — single source
  synced from the skills repo zip by Task 8's script)
- Modify: `packages/agent-runtime/src/loop.ts`,
  `claude-loop.ts`, `gemini-loop.ts` (systemPrompt construction)
- Test: `packages/agent-runtime/src/prompt-assembly.test.ts`

**Interfaces:**
- Produces: `assembleSystemPrompt({ agentName, basePrompt,
  contextBudgetTokens }): string`

Layering order (fixed): core-reasoning doctrine → agent's own doctrine
(intake/deployment/cve-response/security-audit...) → agent basePrompt →
task context. Budget-aware: if over the model's context budget, trim
task context first, doctrine second, NEVER the base prompt or locked
spec (nexsidi-token-budget rule). Rough token estimate (chars/4) is
sufficient — exact tokenization is provider-specific and this must stay
provider-agnostic.

- [ ] Steps 1–5. Key tests: layering order; budget trim order; agent
  with no doctrine file → core-reasoning + base only, no throw.

### Task 7: Authorization Gate Primitive (Wing-2 ready)

**Files:**
- Create: `packages/agent-runtime/src/enforce/authorization.ts`
- Test: `packages/agent-runtime/src/enforce/authorization.test.ts`

**Interfaces:**
- Produces: `requireAuthorization(record: AuthorizationRecord | null):
  void` — throws `AuthorizationError` on null/expired/scope-mismatch

Fail-loud blocking gate, same pattern as `resolveDeployTarget("gcp")`:
called FIRST, before any work. Wing 1 uses it for the PRIVILEGED
`pending_human` class; Wing 2's engagement gate
(nexsidi-secwing-charter boundary #1) consumes it as-is. Pure function,
zero infra — persistence of records is a later, separate concern.

- [ ] Steps 1–5. Key tests: null → throws; expired → throws with
  which-field; valid + in-scope → returns void.

### Task 8: Integration, Doc Sync, and Live-Run Verification

**Files:**
- Create: `scripts/sync-skills.ts` (skills zip → agent-runtime/skills/)
- Modify: `CLAUDE.md` + affected SKILL.md files
  (`nexsidi-agent-tools` → `packages/agent-runtime` naming fix; new
  skills added to the session list)
- Modify: `nexsidi-skills-complete.zip` (add Phase 2/3/4 skills —
  repo/installed sync rule)
- Test: full-suite + one live pipeline run

**Interfaces:** none new — this task proves the others compose.

- [ ] **Step 1:** `bun test` across packages — all green
- [ ] **Step 2:** Live run: "Build me a task manager..." (the Sprint 1
  test) with enforcement ON. Verify in the transcript, by reading it:
  (a) at least one completion attempt gated or all completions carried
  evidence, (b) no contract-invalid handoff was hashed, (c) any
  escalation logged a reason
- [ ] **Step 3:** Run the Phase-3 eval set (`run-evals.ts`) against one
  pipeline model WITH prompt-assembly active vs baseline — record the
  delta in `evals/results/`
- [ ] **Step 4:** Update PROGRESS.md with evidence references
- [ ] **Step 5: Commit** — `feat(agent-runtime): enforcement layer
  (evidence gate, 3-strike, contracts, prompt assembly, authz)`

---

## Explicitly Out of Scope (report, don't fix — Rule 8)

- OTP/PIN user approval UI (Patent Claim 8) — Phase 2 roadmap item,
  Task 7's primitive is its foundation only
- Persisting authorization records / evidence ledgers to DB
- Redis-stream per-agent worker processes (separate roadmap item)
- Renaming `agent-runtime` — docs conform to code, not vice versa

## Risks / Open Assumptions

- ASSUMPTION: `task_complete` rejection-as-tool-result loops correctly
  on all three providers — BECAUSE the loops already share the tool
  contract — RISK IF WRONG: a provider treats rejection as terminal;
  Task 3's test matrix must cover all three loops before Task 8.
- ASSUMPTION: chars/4 token estimate is adequate for budget trimming —
  RISK IF WRONG: rare over-budget calls; circuit is the backstop.
- Small models may thrash against the completion gate initially —
  expected; the gate message is instructive by design, and eval deltas
  in Task 8 Step 3 tell you if doctrine needs shortening.
