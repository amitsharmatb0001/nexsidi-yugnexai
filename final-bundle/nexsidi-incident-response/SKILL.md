---
name: nexsidi-incident-response
description: Production incident doctrine for NexSidi — what to do when a deployed user app breaks, the platform itself fails, a security event fires, or a pipeline corrupts state. Use for any live failure, outage, rollback decision, hash-mismatch event, account-freeze trigger, or "something is broken in production" moment — before anyone starts changing code.
---

# NexSidi Incident Response — Contain, Roll Back, Then Fix
## Grounded in: Patent Claims 3 & 8, 8-layer security model, Layer 7
## comms rules (v2-eager)

An incident is any live failure: a user's deployed app down, the
platform API erroring, a hash-chain mismatch, or a security trigger.
The instinct to "quickly fix the code" is wrong — containment and
rollback come first. Debugging happens on a stable system.

## Severity Ladder

| Sev | Definition | First move |
|---|---|---|
| SEV1 | Security breach, data exposure, hash-chain mismatch | Kill switch + rollback |
| SEV2 | Platform down / all builds failing | Halt new builds, rollback last change |
| SEV3 | One user app broken | Roll that app back, queue fix |
| SEV4 | Degraded (slow, flaky, rate-limited) | Observe, batch fix |

When unsure between two levels, pick the higher one.

## The Fixed Order — Never Reorder

```
1. CONTAIN   — stop the bleeding (kill switch, halt pipeline, pause deploys)
2. ROLL BACK — restore last verified state
3. OBSERVE   — capture logs, hashes, timeline while fresh
4. DIAGNOSE  — nexsidi-debugging (root cause before any fix)
5. FIX       — through the NORMAL pipeline: tests, QA gate, verification
6. RECORD    — instinct memory + decision record so it can't recur silently
```

Incident fixes get NO pipeline shortcuts. A hotfix that skips
adversarial QA is how one incident becomes two.

## Rollback — Patent Claim 3 Is the Mechanism

- Hash-chain mismatch on any inter-agent transfer → automatic rollback
  to the last verified state. Never "repair" a mismatched context by
  hand — that destroys the integrity guarantee and the evidence.
- Deployed apps: every project is archived to GitHub by Riya; rollback
  = redeploy the last known-good commit, not live-editing containers.
- Platform: `git log` → last green commit → redeploy. The commit
  discipline in nexsidi-master-workflow exists precisely for this.

## Containment Tools Already Built

- `touch AGENT_STOP` — halts every tool call (kill switch hook)
- `STEER.md` — one-shot mid-run redirect without restarting
- PRIVILEGED-class `pending_human` gate — freezes risky actions until
  Amit approves (Patent Claim 8's OTP/PIN gate when live)
- Layer 1 account-freeze trigger for repeated injection attempts

## Communication — Layer 7 Applies Under Pressure Too

- Users hear it from Maya only, plain English: "We found an issue and
  restored your app; a fix is underway." No CVE IDs, no agent names,
  no stack traces — incidents don't suspend confidentiality.
- Internal record: timeline with timestamps, severity, root cause,
  fix commit, and the instinct-memory entry ID.

## Post-Incident — Required, Not Optional

Within the same day: a short written record — what broke, why, what
detected it (or failed to), what prevents recurrence. If detection
failed, the FIRST follow-up task is observability, not the code fix.

## What This Skill Forbids

1. Code changes before containment and rollback
2. Hand-editing state after a hash-chain mismatch
3. Hotfixes that skip tests or the adversarial QA gate
4. Internal details in any user-facing incident message
5. Closing an incident with no written record or recurrence guard
