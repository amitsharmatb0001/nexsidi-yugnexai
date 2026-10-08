# NexSidi Deployment — Riya Doctrine
## Grounded in: agents/riya/src/index.ts (v2-eager branch)

Riya ACTS via tools — no one-shot generation. She writes compose files,
runs `docker compose up`, reads the logs when it fails, fixes, and
retries. A deploy is not done until the health check passes.

## The Deploy Loop — Act, Observe, Fix, Retry

```
1. resolveDeployTarget(target)        ← FIRST, before any work
2. Write docker-compose.yml + Dockerfiles into buildDir
3. docker compose up
4. If it fails → READ the actual logs (not guess) → fix compose/
   Dockerfile → retry
5. HTTP health check against appUrl → must return healthy
6. Archive to GitHub (fire-and-forget; failure is non-fatal, logged)
7. Persist appUrl + status ("done"/"error") + updatedAt to projects DB
```

Steps 3–5 loop. Apply the 3-strike rule: same failure 3 times → stop
retrying, change the approach or escalate. Never mark success without
the health check actually passing (nexsidi-verification: evidence, not
confidence).

## Test accounts — only on the reserved test domain

Any account you create to check the deployed app must use an address like
`verify+<anything>@example.com`, and any record you create must be made under
that account. Everything on example.com is removed automatically after the
checks (with all the data under it); an account on any other domain
(`test.com`, `gmail.com`, ...) is never removed and ships to the customer.
(Ledgerly run 4: `deploy_check_1@test.com` and a client under it were left in
the delivered database.)

## No auto-start — never write a restart policy

Do not put `restart:` (always, unless-stopped, on-failure) or `deploy.restart_policy` in any compose file. The owner
starts and stops their apps by hand; nothing may start by itself when Docker starts. (Ledgerly 2 day: 14 of 17 apps
woke up at once when Docker Desktop started. `docker_compose up` now removes restart policies from the file anyway.)

## Deploy Target Gate — Fail Loudly, Never Fall Back

```typescript
resolveDeployTarget("gcp") // → THROWS: not yet implemented
resolveDeployTarget("local") // → { mode: "docker-compose" }
```

An unimplemented target throws immediately, BEFORE any docker work —
never silently fall back to local when GCP was requested (design doc
Open Follow-Up #5). Build GCP support only when Amit says it's needed.
`deployTarget` defaults to `"local"` so legacy callers keep working.

## Port Allocation (current convention)

- Frontend: first free port in 3200–3299
- Backend: frontend + 100 (wraps to 3100 if ≥ 3300)
- DB: first free port in 5435–5499 (real base, verified against
  findFreePort(5435, 5499) in agents/riya/src/index.ts — this doctrine
  previously said a hardcoded "5433", contradicting the very next rule below)
- appUrl = `http://localhost:<frontendPort>`

Always probe for a FREE port — never hardcode; parallel builds collide.

## Model Routing — Escalation Is Exceptional

Riya runs `runAgentEscalated`: NIM (kimi-class) first, a stronger model
as a ONE-TIME escalation only when NIM genuinely cannot finish. Hard-
problem escalation only — never a routine-cost default. If you find
escalation firing on most deploys, that's a bug in the loop, not a
reason to make the expensive model the default.

## Module Hygiene (why the DB import is dynamic)

`@nexsidi/db` throws at import time without DATABASE_URL. Riya imports
it dynamically inside `run()` so pure functions like
`resolveDeployTarget` stay unit-testable with zero infra. Preserve this
pattern in any refactor — top-level DB imports break
`deploy-target.test.ts`.

## What This Skill Forbids

1. Any deploy work before resolveDeployTarget passes
2. Silent fallback from an unimplemented target to local
3. Claiming deploy success without a passing HTTP health check
4. Hardcoded ports
5. Making the escalation model the routine default
6. Top-level imports of @nexsidi/db in agent modules
