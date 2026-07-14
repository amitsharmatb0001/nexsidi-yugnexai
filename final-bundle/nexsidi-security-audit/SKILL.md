---
name: nexsidi-security-audit
description: Audit doctrine for the security wing (Ishani code audit + Veda dependency/config audit). Use when reviewing any codebase for vulnerabilities, auditing dependencies or configurations, writing a client findings report, rating severity, or verifying a finding. Also applies to Wing-1 internal reviews — use whenever anyone asks "is this code/config secure".
---

# NexSidi Security Audit — Find Real Problems, Prove Them
## Defensive review doctrine. Provider-agnostic; sits on
## nexsidi-core-reasoning.

An audit's value is the ratio of TRUE findings to noise. One false
CRITICAL in a client report costs more trust than ten missed LOWs.
Verify, then report.

## Audit Order — Fixed, Because Coverage Beats Cleverness

```
1. INVENTORY  — what exists: entry points, auth boundaries, data flows,
                dependencies, configs, secrets locations. Read before
                judging (Rule 3). Produce the inventory as an artifact.
2. AUTOMATED  — dependency scan vs advisory data (Veda/Neha machinery),
                secrets scanning, known-misconfiguration checks.
3. SYSTEMATIC — code review by category (checklist below), every entry
                point, not just the interesting-looking ones.
4. VERIFY     — every candidate finding reproduced with evidence
                (Kiara gate) before it may enter the report.
5. REPORT     — severity-ranked, plain-English impact, concrete fixes.
```

## The Category Checklist (per entry point / component)

- **Input handling** — validation, injection (SQL/command/template),
  deserialization of untrusted data, file-path traversal
- **AuthN/AuthZ** — missing auth on routes, broken object-level
  authorization (can user A read user B's data by changing an ID?),
  session/token handling, privilege boundaries
- **Secrets & crypto** — hardcoded credentials, secrets in logs or
  client bundles, weak/homemade crypto, tokens without expiry
- **Data exposure** — over-broad API responses, verbose errors leaking
  internals, debug endpoints in production, PII in logs
- **Dependencies** — known-vulnerable versions where the vulnerable
  code path is actually reachable (version match alone ≠ vulnerable —
  same relevance gate as nexsidi-cve-response)
- **Config & infra** — permissive CORS, missing security headers,
  default credentials, open ports, over-privileged service accounts,
  world-readable storage
- **Platform-specific** — for apps NexSidi generated: check against
  the 8-layer model's own requirements; our output is not exempt

Work the checklist per component and RECORD coverage ("checked /
finding / not applicable") — an audit without a coverage record is an
opinion.

## Severity — Impact × Exploitability, Stated Honestly

| Rating | Bar |
|---|---|
| CRITICAL | Unauthenticated compromise of data or system, verified reachable |
| HIGH | Authenticated user can access others' data or escalate; secrets exposed |
| MEDIUM | Requires unusual conditions, or meaningful defense-in-depth gap |
| LOW | Best-practice deviation with no demonstrated path to impact |

Rules: severity reflects THIS system's context, not the generic CVE
score. Never inflate to look thorough; never deflate to look clean.
When torn between two levels, state both and why.

## Finding Format — Every Field Mandatory

```
ID:          SEC-<n>
TITLE:       <one line, specific>
SEVERITY:    <rating> — <one-line justification>
LOCATION:    <file:line / config key / package@version>
EVIDENCE:    <what was observed — verified reproduction reference>
IMPACT:      <plain English: what an attacker gains, who is affected>
REMEDIATION: <the specific change, not "improve validation">
```

Remediation describes the FIX (parameterize the query, add the auth
check, rotate and vault the secret). It never includes working attack
payloads or step-by-step exploitation — the client needs to fix it,
not weaponize it.

## Verification Gate (Kiara) — Before Any Finding Ships

- Reproduce the condition with evidence (Rule 6): the failing check,
  the exposed response, the reachable vulnerable call — captured, not
  asserted
- Confirm location and version claims by reading the actual artifact
- Cannot reproduce → "needs investigation" section, clearly separated,
  never mixed with confirmed findings
- Kiara critiques only — she does not fix (evaluator separation)

## What This Skill Forbids

1. Findings in a report without verified reproduction evidence
2. Attack payloads or exploitation walkthroughs in deliverables
3. Severity inflation/deflation for appearance
4. "Vulnerable dependency" claims without reachability + version check
5. Auditing anything outside the authorized engagement scope
6. Vague remediations ("sanitize inputs") — name the exact change
