---
name: nexsidi-token-budget
description: Runtime token, rate-limit, and cost doctrine for NexSidi's LLM layer. Use when adding an agent or model, tuning RPM/context limits, deciding when escalation to a stronger model is justified, handling 429s, trimming context, or when builds are slow/expensive and someone asks why. Use for ANY change touching packages/llm-client (token-bucket, router, circuit-breaker, nim/ollama/gemini/claude providers).
---

# NexSidi Token Budget — Spend Tokens Like Runway
## Grounded in: packages/llm-client (token-bucket.ts, router.ts,
## circuit-breaker.ts, types.ts) — v2-eager

Pre-seed reality: every token is runway. The routing layer already
enforces most of this mechanically; this skill keeps humans and agents
from designing around it.

## The Four Mechanical Guards — Never Bypass

1. **Per-model shared token bucket** (Fix #2) — ALL agents calling the
   same model share one bucket. `waitForToken` before every call; no
   direct provider calls that skip the bucket.
2. **RPM limits** — `MODEL_RPM_LIMITS[model]`, honored by the bucket.
3. **Context limits** — `NIM_CONTEXT_LIMITS[model]` enforced (Fix #10).
   Over limit → trim oldest conversation turns first; NEVER trim the
   system prompt or the locked spec.
4. **Circuit breaker** — repeated provider failures open the circuit;
   route to fallback (Ollama local) instead of hammering a dead/limited
   endpoint.

## Routing Ladder — Cheapest Capable Model Wins

```
Local Ollama (free)  →  NIM free tier  →  paid escalation (Gemini/Claude)
```

- Each agent has a pinned model in `AGENT_MODELS` — sized to the job
  (7B-class for schema/deploy work, frontier-class for CAO/codegen).
  Changing an assignment is a decision record, not a whim.
- **Escalation is one-time and exceptional** (`runAgentEscalated`):
  the strong model fires only when the pinned model genuinely cannot
  finish. If escalation triggers on most runs, fix the loop/prompt —
  don't promote the expensive model to default.

## The 3-Strike Rule Is a Budget Rule

Same failure 3 times = stop retrying. Retrying an unchanged approach
burns tokens with zero information gain. Change the approach, escalate
once, or surface to a human. Log every escalation with its reason —
that log is the monthly cost review.

## Context Discipline (biggest silent cost)

- Send the agent only what its task needs: the locked spec section,
  the relevant files, its contract — not the whole repo
- Instinct memory injects only high-confidence, task-relevant entries
- Long transcripts: summarize-and-truncate at the harness level before
  the model ever sees them

## When Builds Are Slow — Check Budget Before Bugs

Slow ≠ broken. Order: token bucket queue depth → RPM saturation →
circuit breaker state → THEN suspect the agent. A build queued behind a
shared bucket looks identical to a hang (see nexsidi-observability).

## What This Skill Forbids

1. Provider calls that bypass waitForToken / the shared bucket
2. Trimming the system prompt or locked spec to fit context
3. Making an escalation model the routine default
4. Retrying an unchanged approach past 3 failures
5. Changing an agent's pinned model without a decision record
