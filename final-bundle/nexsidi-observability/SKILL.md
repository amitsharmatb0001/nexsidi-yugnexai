---
name: nexsidi-observability
description: Observability doctrine for NexSidi — agent health WebSockets, SSE pipeline status streams, Temporal activity heartbeats, structured logging, and watching long unattended runs. Use when adding logging, debugging a stuck or silent pipeline, wiring status updates to the UI, instrumenting a new agent or activity, or when anyone asks "what is the pipeline doing right now" or "why did it stall".
---

# NexSidi Observability — See What Agents Are Doing
## Grounded in: apps/api/routes/ws.ts, pipeline SSE routes, Temporal
## heartbeats, cwc-long-running-agents watch patterns (v2-eager)

An unobservable agent pipeline is an untrustable one. Every stage must
be watchable in real time, and every claim of progress must map to an
artifact someone can open.

## The Three Existing Channels — Use, Don't Duplicate

1. **Agent Health WebSocket** — `apps/api/src/routes/ws.ts` +
   `/build/[id]` page. Internal-facing: per-agent liveness.
2. **Pipeline SSE stream** — `GET /api/pipeline/:id/status`.
   USER-facing: stage updates, **Layer 7 filtered** — plain English
   only, no agent names, no internals. Everything sent here obeys
   nexsidi-intake's translation rule.
3. **Temporal heartbeats** — every LLM-heavy activity heartbeats so
   long calls aren't killed as timeouts. Any NEW activity that can run
   >30s MUST heartbeat. A missing heartbeat looks identical to a hang.

New instrumentation extends these channels; it does not invent a fourth
transport without a decision record.

## Structured Log Line — One Convention

```
[agent] event key=value key=value
e.g.  [neha] CVE push from ghsa
      [riya] health-check url=http://localhost:3241 status=200 attempt=2
```

- Prefix every line with `[agentname]` — grep-ability is the point
- Log state TRANSITIONS (started, retrying, escalated, done, failed),
  not loops of "still working"
- NEVER log secrets, API keys, or raw user prompt content — prompts go
  through the encrypted prompt-audit package, not stdout

## Watching a Long Run (no dashboard needed)

```bash
watch -n 2 'tail -20 PROGRESS.md'          # the agent's own notes
watch -n 5 'git log --oneline -8'          # work actually saved
watch -n 5 'find screenshots -name "*.png" | tail -5'
docker compose logs -f --tail 50 <service> # live service logs
```

## Diagnosing "It's Stuck" — Fixed Order

1. Temporal UI: is the workflow running, retrying, or blocked on an
   activity? Which activity? (stuck-state counter is in workflow state)
2. That activity's heartbeat: beating = slow LLM call; silent = hang
3. Token bucket / RPM: is the agent just queued behind rate limits?
4. Agent Health WS: is the process itself alive?
5. Only THEN read code. Observability first, code-diving second.

## Every New Agent Ships With

- `[agentname]`-prefixed transition logs
- Heartbeats on any long activity
- A stage event on the SSE stream (Layer 7 filtered) if user-relevant
- Its row in the agent registry table (Fix #6)

## What This Skill Forbids

1. Long-running activities without heartbeats
2. Agent names or internals on the user-facing SSE stream
3. Secrets or raw prompts in logs
4. Debugging a "stuck" pipeline by reading code before checking
   Temporal UI, heartbeats, and rate limits
5. New status transports when the three existing channels suffice
