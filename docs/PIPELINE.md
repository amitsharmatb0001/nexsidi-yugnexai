# NexSidi Pipeline Flow

```
User request
    │
    ▼
Tilotma (Layer 1: injection check, ROM enforcement)
    │
    ▼
Saanvi → ProjectSpec JSON → user OTP approval (Patent Claim 8)
    │
    ▼
Arjun → API contract + DB schema + task decomposition → independence check
    │
    ├── git worktree: feat/{id}-backend  → Shubham (Express)   ─┐
    ├── git worktree: feat/{id}-frontend → Aanya (Next.js)     ─┤ parallel
    └── git worktree: feat/{id}-database → Pranav (Drizzle)   ─┘
                            │
                            ▼ (merge)
                    Stage 0: Arjun spec-compliance (cheap gate)
                            │
                            ▼
                    Stage 1: Navya + Karan + Deepika (parallel, different models)
                    Pass: ALL THREE independently ≥85/100
                    (Fix #8: any single agent <85 blocks — NOT the average)
                            │
                            ▼
                    Stage 2: Live app test (Playwright)
                    Pass: ≥7.0/10 (design×0.35 + originality×0.35 + craft×0.15 + func×0.15)
                            │
                            ▼
                    Riya → docker-compose up → verify → GitHub repo → deliver
                            │
                            ▼
                    Tilotma delivers:
                      ✓ http://localhost:3000
                      ✓ GitHub repo
                      ✓ PRD document
                      ✓ Feature list (plain language)
                      ✗ Agent names, QA scores, iteration count (never)
```

## Stuck-State Detection (Fix #7)

Counter stored in Temporal workflow state (persistent, not in-memory):

```
If last 3 consecutive min-scores improved < 3 points total:
  → stuckIterations += 1
  → log to stuck_state_log table
  → escalate to Tilotma
  → Tilotma asks user ONE specific question with concrete options
```

## Inter-Agent Transport (Fix #1)

Redis Streams. Each agent has an inbox stream:
`nexsidi:bus:{agentName}:{projectId}`

Every message carries:
- payload (the context)
- contextHash (SHA-256 of canonicalized payload) — Patent Claim 1
- signature (RSA-SHA256) — Patent Claim 7

Receiving agent verifies both before processing — Patent Claim 3.
