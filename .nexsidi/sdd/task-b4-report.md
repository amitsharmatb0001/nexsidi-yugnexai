# Task B4 Report — Tier-3 Pipeline Gate

**Status:** DONE  
**Commit:** b924d59  
**Branch:** feat/nexsidi-pipeline-v2-eager  
**Files changed:** `pipeline/activities/index.ts`, `pipeline/workflows/project-build.ts`

---

## What Changed

### `pipeline/activities/index.ts`

1. **New import** (line 11):
   ```typescript
   import { runTier3Review as runTier3ReviewAgent } from "../../agents/tilotma/src/tier3-review.ts";
   ```

2. **New exported activity `runTier3Gate`** (inserted after `runLiveCheck`, before `runSpecCompliance`):
   - Gets `buildDir` via `getBuildDir(projectId)`
   - Returns `{ pass: true, skipped: true }` if `docker-compose.yml` is absent
   - Runs `docker compose up -d` (120s timeout)
   - Polls `TIER3_REVIEW_URL` (default `http://localhost:3200`) every 3s for up to 30s
   - Calls `runTier3ReviewAgent(projectId, buildDir)` (Evidence Collector + Reality Checker)
   - `try/finally` ensures `docker compose down` always runs even if the review throws
   - Returns `{ pass: boolean; findings: string[]; skipped?: boolean }`

### `pipeline/workflows/project-build.ts`

Replaced the one-liner `if (live.pass) break;` with a branching block:
- On live pass: sets `state.stage = "tier3_review"`, calls `genAct.runTier3Gate(projectId)` (30-min timeout proxy)
- On Tier-3 pass or skip: `break` — exits QA loop as before
- On Tier-3 fail: calls `genAct.runCodeFix(...)` with `tier3_fail: <first 3 findings>`, sets `state.stage = "qa"`, and `continue`s the while loop

---

## Typecheck Result

Zero new errors in either modified file. All pre-existing errors are in unrelated files (`agents/generators/`, `agents/qa/`, `packages/llm-client/`).

---

## Design Notes

- `genAct` (30-min timeout) used for `runTier3Gate` — two full browser-agent loops with NIM calls can take 20-30 minutes
- Tier-3 failure feeds back into `runCodeFix` then re-enters QA (not a separate escalation path)
- Stuck-state detection is unaffected — it only triggers on QA scores, not Tier-3 results
- No other pipeline stages, QA thresholds, or escalation logic were touched
