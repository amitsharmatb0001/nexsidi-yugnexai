# Task B3 Report — QA Prompt & Threshold Fixes

**Status:** DONE

## Changes Applied

### 1. `pipeline/activities/index.ts` line 454
- Changed `status: score >= 70 ? "ok" : "error"` → `score >= 85`

### 2. `pipeline/activities/index.ts` lines 465–479 (`qaPrompt()`)
- Replaced lenient "Review ONLY the code shown / DO NOT flag missing implementations" prompt
  with adversarial default-FAIL stance
- Fixed scoring weights: CRITICAL×20, HIGH×10, MEDIUM×5, LOW×1
  (was CRITICAL×10, HIGH×5, MEDIUM×2, LOW×1)

### 3. `pipeline/workflows/project-build.ts` lines 164–166
- Removed Phase 1 / Phase 2 phased-threshold comment
- Changed `navyaScore >= 70 && karanScore >= 70 && deepikaScore >= 70`
  → `navyaScore >= 85 && karanScore >= 85 && deepikaScore >= 85`

## Typecheck Result

Pre-existing errors only (ModelId type mismatches in agent/test files, unrelated to pipeline changes).
No new errors introduced by these changes.

## Commit

`07ccd79` — `fix(qa): adversarial prompt, correct CRITICAL×20 weights, raise gate to ≥85`
