# NexSidi — Sprint Progress

## Status: Phase 0 — COMPLETE ✓

## Completed

### Phase 0: Repository Skeleton (2026-06-24)

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

## Up Next: Phase 1

**Goal:** Working pipeline end-to-end
- Wire all agent stubs to actual LLM calls via `@nexsidi/llm-client`
- Implement context-chain hash/verify on every agent-bus message
- Temporal worker running the full project-build workflow
- Sprint 1 target: task manager delivered to localhost:3000

## Blocked
Nothing.
