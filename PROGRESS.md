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

**Skills conflict resolved:**
- `nexsidi-generated-stack`, `nexsidi-requirements`, `nexsidi-database` skills
  reference Next.js 14 + Supabase + Vercel/Railway — these skills are OUTDATED.
- CLAUDE.md is authoritative: Next.js 16.2 + local PostgreSQL + Docker Compose.
- All agent implementations (Aanya/Shubham/Pranav/Riya) follow CLAUDE.md.

**Up Next:**
- Sprint 1 test: trigger full pipeline with "Build me a task manager — sign up, add tasks with due dates, check them off"
- Fix any runtime errors discovered during end-to-end run
- Phase 2: Playwright live testing (Eval Mode B — weighted 1-10 scoring)

## Blocked
Nothing.

## Notes for Next Session
- Run `bun run worker` from `pipeline/` to start the Temporal worker
- Run `bun run dev` from `apps/api/` to start the API
- Temporal must be running: `docker-compose -f docker-compose.dev.yml up temporal temporal-ui`
- NIM API key needed: `export NIM_API_KEY=...` in `.env`
