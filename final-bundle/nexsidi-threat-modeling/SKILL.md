---
name: nexsidi-threat-modeling
description: Advait's threat modeling doctrine for the security wing. Use when designing any new system or feature (Wing 1 included), reviewing an architecture for security risks, producing a threat register for a client, or answering "what could go wrong with this design". Use BEFORE build for new systems — threat modeling after shipping is incident response with extra steps.
---

# NexSidi Threat Modeling — What Could Go Wrong, Systematically
## STRIDE-based. Sits on nexsidi-core-reasoning; feeds
## nexsidi-security-audit and Wing-1 specs.

Threat modeling is design-time work: cheapest before code exists,
still valuable after. Output is a THREAT REGISTER — a living artifact,
not a one-time PDF.

## Step 1 — Model the System First (Rule 3: read before judging)

Produce, from actual specs/code/diagrams — never from assumption:
- **Assets**: what's worth protecting (user data, credentials, money
  flows, availability, reputation)
- **Entry points**: every way data or commands enter (APIs, uploads,
  webhooks, admin panels, CI, third-party integrations)
- **Trust boundaries**: where privilege or ownership changes (user↔app,
  app↔DB, service↔service, tenant↔tenant, human↔agent)
- **Data flows**: how assets move across those boundaries

No system model = no threat model. If the design is too vague to draw,
that vagueness is finding #1.

## Step 2 — STRIDE per Trust Boundary

For EACH boundary crossing, ask all six — coverage over cleverness:

| Letter | Question at this boundary |
|---|---|
| **S**poofing | Can someone pretend to be another user/service/agent here? |
| **T**ampering | Can data or code be modified in transit or at rest here? |
| **R**epudiation | Can an action here be denied later? Is it logged tamper-evidently? |
| **I**nfo disclosure | Can data leak here to someone unauthorized? |
| **D**enial of service | Can this be exhausted, flooded, or locked up? |
| **E**levation | Can lower privilege become higher privilege here? |

Record explicit "considered — not applicable because X" entries.
An unconsidered cell is a blind spot; a considered-N/A cell is coverage.

## Step 3 — The Threat Register

```
THREAT-<n>
BOUNDARY:   <which crossing>
STRIDE:     <category>
SCENARIO:   <one concrete sentence: who does what, gaining what>
LIKELIHOOD: HIGH/MED/LOW — <why, honestly>
IMPACT:     HIGH/MED/LOW — <which asset, how badly>
MITIGATION: <specific control — existing or proposed>
STATUS:     mitigated / accepted / open
```

Rules: scenarios are concrete ("a tenant crafts an ID to read another
tenant's invoices"), never abstract ("data might leak"). Every HIGH/HIGH
threat left "open" must be explicitly accepted by the owner in writing —
silent acceptance is forbidden.

## Multi-Agent Systems Get Extra Boundaries

When modeling agentic systems (NexSidi itself, or client AI systems),
add these boundaries — they're where agent systems actually fail:
- **Untrusted content → agent context** (prompt injection: web pages,
  user files, tool results carrying instructions)
- **Agent → tool execution** (what can a compromised or confused agent
  actually DO — this is why the permission harness exists)
- **Agent → agent handoff** (can a forged or tampered handoff steer the
  pipeline — the context-chain's exact purpose)
- **Memory writes** (can poisoned instincts persist and replay later)

## Output Feeds the Pipeline

- New Wing-1 builds: mitigations become spec requirements in Saanvi's
  locked spec — security requirements are requirements, not decoration
- Client engagements: register + prioritized mitigations = deliverable;
  hardening engagement implements them through the normal pipeline
- The register is versioned with the system; re-model when a boundary
  changes, not on a calendar

## What This Skill Forbids

1. Threat modeling from assumptions instead of the actual design
2. Skipping STRIDE cells without recorded "N/A because"
3. Abstract scenarios that name no actor, action, or asset
4. Silent acceptance of HIGH/HIGH open threats
5. Attack walkthroughs beyond the one-sentence scenario — this is a
   design tool, not an exploitation guide
