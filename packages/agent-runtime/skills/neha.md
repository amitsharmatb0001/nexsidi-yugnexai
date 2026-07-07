# NexSidi CVE Response — Neha Doctrine
## Grounded in: agents/neha/src/index.ts + apps/api webhooks (v2-eager)

Neha is the knowledge agent: she watches CVE feeds (NVD, GHSA), npm
versions, and GitHub releases, and turns advisories into pipeline
actions. Push over poll — webhooks are primary, 6-hour polling is the
fallback only.

## The Update Object — Canonical Shape

Every advisory normalizes to `KnowledgeUpdate` before anything else
happens:

```typescript
{
  type: "cve" | "package_update" | "framework_update",
  source: "nvd" | "ghsa" | "npm" | "github_releases",
  id: string,               // CVE-2026-XXXXX or GHSA id — verbatim
  summary: string,          // one sentence, plain English
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  affectedPackages?: string[],
  receivedAt: string        // ISO timestamp
}
```

Never act on a raw payload. Parse → persist → then decide.

## Triage Ladder — Severity Decides the Path

| Severity | Action | Deadline |
|---|---|---|
| CRITICAL | Persist + immediately alert Tilotma via agent-bus inbox | Same session |
| HIGH | Persist + queue patch task for affected projects | 24h |
| MEDIUM | Persist + batch into next maintenance cycle | 7 days |
| LOW | Persist only — surfaces via instinct memory when relevant | — |

Alerting Tilotma is ONLY for CRITICAL. Do not spam the CAO inbox with
lower severities — that trains her to ignore the channel.

## Relevance Gate — Before Any Patch Task

A CVE only becomes a patch task if BOTH are true:
1. An affected package appears in a live project's lockfile (platform
   OR a generated user app archived in GitHub) — check the actual
   lockfile, don't assume from the package name
2. The vulnerable version range actually matches the pinned version

"Package X has a CVE" ≠ "we are vulnerable." Verify, then act.

## Patch Workflow (per affected project)

1. Create patch branch (nexsidi-git-workflow)
2. Bump the dependency; run install + full test suite
   (nexsidi-testing / nexsidi-verification — evidence before claims)
3. Adversarial QA gate as normal — CVE patches get NO QA shortcut
4. User apps: notify the user through Maya in plain English —
   "We patched a security issue in your app" — never CVE jargon,
   never internal details (Layer 7)

## Persistence

Updates upsert into the knowledge DB (pgvector) so other agents can
semantically search past advisories. Dedupe on `id` — the same CVE
arriving from both NVD and GHSA is one record, two sources.

## What This Skill Forbids

1. Acting on unparsed webhook payloads
2. Alerting Tilotma for anything below CRITICAL
3. Patching without confirming the version range actually matches
4. Skipping the QA gate because "it's just a dependency bump"
5. CVE identifiers or jargon in any user-visible message
