# NexSidi — Sprint Progress

## Status: Phase 1 — IN PROGRESS

## Completed

### Phase 0: Repository Skeleton (2026-06-24) ✓

All 13 deliverables built. All 10 issues fixed. 3 nice-to-haves added.

**Fixes shipped:**
- Fix #1: Redis Streams as inter-agent transport (`packages/agent-bus`)
- Fix #2: Per-model shared token bucket (`packages/llm-client/src/token-bucket.ts`)
- Fix #3: Atomic STEER.md consume via rename (`apps/api/src/utils/steer.ts`)
- Fix #4: Named `instinct_memory` Docker volume (`docker-compose.dev.yml`)
- Fix #5: Clerk webhook endpoint with Svix verification (`apps/api/src/routes/webhooks.ts`)
- Fix #6: Agent registry table (`packages/db/src/schema.ts`)
- Fix #7: Stuck-state counter in Temporal workflow state (`pipeline/workflows/project-build.ts`)
- Fix #8: Per-agent QA — any single agent <85 blocks (`pipeline/workflows/project-build.ts`)
- Fix #9: Riya creates GitHub repo + pushes before delivery (`agents/riya/src/index.ts`)
- Fix #10: NIM free-tier context limits enforced (`packages/llm-client/src/types.ts`)

**Nice-to-haves shipped:**
- #11: Agent Health WebSocket (`apps/api/src/routes/ws.ts` + `/build/[id]` page)
- #12: NVD + GHSA CVE push webhooks + Neha agent skeleton
- #13: AES-256-GCM encrypted prompt audit log (`packages/prompt-audit`)

---

### Phase 1: End-to-End Pipeline (2026-06-24) — IN PROGRESS

**Goal:** User types "build me a task manager" → app runs at localhost:3000

**Completed so far:**
- All 5 agent stubs → real LLM calls:
  - Saanvi: MiniMax M3 via NIM → locked ProjectSpec JSON
  - Arjun: Mistral Nemotron via NIM → BuildPlan + sprint contracts
  - Shubham: DeepSeek V4-Pro via NIM → Express backend files
  - Aanya: DeepSeek V4-Pro via NIM → Next.js 16.2 frontend files
  - Pranav: Qwen2.5-Coder via Ollama → Drizzle schema + SQL migration
  - Riya: Qwen2.5-Coder via Ollama → docker-compose + GitHub archival
- All 12 Temporal activities: real work (LLM calls, file I/O, DB writes)
- Temporal worker process (`pipeline/worker.ts`) — runs workflow + activities
- Activity heartbeats on all LLM-heavy activities — prevents timeout kills
- Maya → pipeline handoff: `project_started` event triggers Temporal workflow
- Pipeline API routes:
  - `POST /api/pipeline/start` — starts Temporal workflow
  - `GET /api/pipeline/:id/status` — SSE pipeline stage stream (Layer 7 filtered)
  - `GET /api/pipeline/:id` — fetch project result
- Skills audit: read all 42 skills, verified alignment with CLAUDE.md

**Critical runtime bugs fixed (2026-06-24):**
- `packages/db/schema.ts`: userId UUID FK → clerkId text, added appUrl column
- `packages/db/migrations/0000_initial.sql`: initial platform migration (all 8 tables)
- `packages/db/migrate.ts`: migration runner (`bun packages/db/src/migrate.ts`)
- `apps/api/middleware/auth.ts`: real Clerk JWT verification (was a stub)
- `apps/api/routes/pipeline.ts`: uses clerkId (text) in DB insert
- `agents/riya/src/index.ts`: persists appUrl + status to DB after deploy
- `apps/web/build/[id]/page.tsx`: user-facing SSE status (Layer 7 deny-by-default)
- `nexsidi-skills-complete.zip`: 3 outdated skills updated (Next.js 16.2 + Docker)

**Skills conflict resolved:**
- `nexsidi-generated-stack`, `nexsidi-requirements`, `nexsidi-database` updated
- CLAUDE.md is authoritative: Next.js 16.2 + local PostgreSQL + Docker Compose.
- All agent implementations (Aanya/Shubham/Pranav/Riya) follow CLAUDE.md.

**Up Next:**
- Sprint 1 test: trigger full pipeline with "Build me a task manager — sign up, add tasks with due dates, check them off"
- Fix any runtime errors discovered during end-to-end run
- Phase 2: Playwright live testing (Eval Mode B — weighted 1-10 scoring)
- Phase 2: Redis Stream agent worker processes (each agent as independent process)
- Phase 2: OTP/PIN approval gate (Patent Claim 8)

## Blocked
Nothing.

## Notes for Next Session
- Run `bun run worker` from `pipeline/` to start the Temporal worker
- Run `bun run dev` from `apps/api/` to start the API
- Temporal must be running: `docker-compose -f docker-compose.dev.yml up temporal temporal-ui`
- NIM API key needed: `export NIM_API_KEY=...` in `.env`

---

### Phase 5: Harness Enforcement Layer (2026-07-07) ✓

Per `final-bundle/phase5-harness-enforcement-plan.md` — made core-reasoning
Rules 6 (evidence), 7 (3-strike), and 9 (output contracts) mechanically
unskippable for every agent on every provider (NIM, Claude, Gemini), and
injected skill doctrine into agent system prompts at runtime.

**Tasks 1-7 complete, TDD throughout, 275/275 tests green at each step:**
- Task 1: Evidence ledger (`packages/agent-runtime/src/enforce/evidence.ts`) —
  commit `52a234b`
- Task 2: Wire execRunCommand/execReadFile/execHttpRequest into the ledger —
  commit `bd3147b`
- Task 3: Default-FAIL completion gate, wired into all three loops (NIM,
  Claude, Gemini) — commit `b38f0d9`
- Task 4: Mechanical 3-strike escalation + `escalationReason` logging —
  commit `90d85ac`
- Task 5: Output contract validator (`validateHandoff`) — zod schemas for
  ProjectSpec/BuildPlan/DeployResult/ReadyToBuild/Verdict — commit `488e700`
- Task 6: `assembleSystemPrompt()` — skills injected at runtime, wired into
  all three loops — commit `4a3fc0b`
- Task 7: Authorization gate primitive (Wing-2 ready) — commit `4c48e4f`

**Task 8 (this entry) — live-run verification:**
- Full suite: `bun test` → 275 pass, 0 fail, 34 files (re-run at Task 8 time
  to confirm no drift since Task 7's commit)
- Live pipeline run with enforcement ON (`scripts/stress-test.ts`,
  project `stress-phase5-<timestamp>`) — confirmed via the run's own log:
  the very first Aanya system-prompt token count jumped from ~3800 (pre-
  Task-6 baseline, seen in earlier same-session runs) to ~5400 tokens on
  an otherwise-identical first call, proving `assembleSystemPrompt()`'s
  core-reasoning + doctrine injection is live in the real pipeline, not
  just passing in isolated tests.
- **Known-open, not fixed this session (Rule 8 — report, don't fix
  unprompted):** Step 3 (baseline vs with-skill eval delta via
  `nexsidi-skill-evals/scripts/run-evals.ts`) could not be completed —
  the script takes `--api-key` as a CLI arg, which would put the live
  NIM key into the child process's argv (a real OS-level exposure via
  `ps`), violating the standing "never embed secret literal values in a
  Bash command line" rule. The plan's own Known-Open Items section
  already flagged "Eval runner has never hit a live endpoint
  (compile-verified only)" — still true after this session. Fixing this
  cleanly needs `run-evals.ts` changed to read the key from a file path
  arg or rely purely on an env var already present in the process
  environment (never passed as a flag) — a small, separate follow-up.
- `scripts/sync-skills.ts`, the `CLAUDE.md` naming fix (`nexsidi-agent-
  tools` → `packages/agent-runtime`), and the `nexsidi-skills-complete.zip`
  sync were explicitly deferred per direct instruction this session
  ("dont check the zip & claude md you have thge curret codebase acess")
  — not done, not forgotten.

**Real, ongoing cost note:** Task 6 adds ~1.4k tokens of core-reasoning
doctrine to every agent's system prompt on every call, pipeline-wide —
this is a permanent token-cost increase, not a one-time change. Worth
watching NIM/Claude/Gemini spend after this lands.
