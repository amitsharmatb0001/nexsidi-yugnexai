---
name: nexsidi-secwing-charter
description: Charter for NexSidi's Cybersecurity Wing — the second vertical after software engineering. Use when planning, scoping, or building the security wing, defining its agent roster, deciding which security services NexSidi offers, mapping security work onto the existing pipeline, or answering "how does the cybersecurity vertical work". INTERNAL ONLY — roster and architecture never appear in external material.
---

# NexSidi Cybersecurity Wing — Charter
## Wing 2. Reuses the Wing-1 pipeline; only the domain agents change.

## Why This Wing Works — The Pipeline Is the Product

Wing 1 proved the loop: intake → locked spec → plan/decompose →
execute → adversarial QA → evidence-verified delivery. That loop is
domain-agnostic. Wing 2 swaps the DOMAIN agents (what gets executed)
and keeps everything else: Maya intake, Saanvi spec-lock, Arjun
decomposition, the QA gate, context-chain integrity, instinct memory,
Layer 7 comms, core-reasoning discipline. This is the "one wing at a
time" expansion story.

## Hard Boundaries — Non-Negotiable, Enforce at Harness Level

The wing is DEFENSIVE security-as-a-service:

1. **Authorized targets only.** Every engagement requires written
   scope authorization from the system's owner, verified before any
   agent touches a target. No authorization record = pipeline refuses
   to start (same gate pattern as resolveDeployTarget — fail loudly).
2. **No offensive tooling.** The wing assesses, hardens, monitors, and
   responds. It does not build exploits, attack third parties, or
   produce weaponizable output. Findings describe risk and remediation,
   not attack recipes.
3. **Client data isolation.** Client code/configs live in per-project
   sandboxes (Patent Claim 5), never in shared training data or
   cross-client instinct entries. Instinct memory stores PATTERNS
   ("unvalidated input in route handlers is common in X-style apps"),
   never client-identifiable specifics.
4. **Findings are confidential deliverables** — encrypted at rest,
   Layer 7 rules apply doubly: a leaked finding is a weapon.

## Service Lines (launch order)

1. **Automated security audit** — code, dependency, and configuration
   review of a client codebase → severity-ranked findings report with
   remediation steps. Nearest to Wing-1 capability; launch first.
2. **Threat modeling** — STRIDE-based design review for planned or
   existing systems → threat register + mitigations.
3. **Hardening** — implement the remediations from (1) via the normal
   dev pipeline (this IS Wing 1 with a security spec).
4. **Continuous monitoring** — Neha's CVE feed matched against client
   lockfiles; alert + patch offer on relevant advisories.
5. **Incident response support** — nexsidi-incident-response doctrine
   applied to client incidents. Human-in-the-loop mandatory.

## Roster Proposal (internal names, Wing-2 domain agents)

| Agent | Role | Reuses |
|---|---|---|
| **Rudra** | Security wing lead — scoping, engagement gate, report sign-off | Arjun's decomposition pattern |
| **Ishani** | Static/code audit — secure code review at scale | Karan's review-gate pattern |
| **Veda** | Dependency & config audit — lockfiles, IaC, secrets scanning | Neha's CVE machinery |
| **Advait** | Threat modeling — STRIDE, data-flow analysis | Saanvi's spec-lock format |
| **Kiara** | Findings verification — reproduces each finding with evidence before it enters a report | Navya's adversarial pattern + Rule 6 |

Five agents, not fifteen — every one maps to an existing proven
pattern. Tilotma remains CAO across wings; Maya remains the only
user-facing agent; Manan prices engagements.

## Pipeline Mapping

```
Maya intake ("audit my app") 
  → Rudra: engagement scope + AUTHORIZATION GATE (blocking)
  → Saanvi-format locked AuditSpec (targets, depth, exclusions, deadline)
  → Arjun-pattern decomposition → Ishani/Veda/Advait in parallel
  → Kiara verifies EVERY finding with reproduction evidence
  → severity-ranked report → Maya delivers in plain English
  → optional: hardening engagement = Wing-1 build with the report as spec
```

QA inversion note: in Wing 1, adversarial QA attacks OUR output. In
Wing 2, finding problems IS the output — so Kiara's job inverts to
verifying findings are REAL (reproducible, correctly scoped, correctly
rated). A false finding in a client report is this wing's equivalent
of shipped broken code.

## Report Quality Bar

Every finding in a deliverable has: severity (CVSS-aligned), the
specific location, reproduction evidence (Kiara-verified), business
impact in plain English, and a concrete remediation. Findings without
verified reproduction are listed separately as "needs investigation" —
never presented as confirmed. No padding: 3 real findings beat 30
speculative ones.

## What This Skill Forbids

1. Any engagement without a verified written authorization record
2. Offensive/exploit deliverables in any form
3. Client-identifiable data in cross-client instinct memory
4. Unverified findings presented as confirmed
5. Wing-2 internals (roster, architecture) in any external material —
   externally this is "YugNex security services", nothing more
