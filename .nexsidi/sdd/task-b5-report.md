# Task B5 Report — Fix spec-approval gate bypass

**Status:** DONE

## What was changed

The `plannerConfirmed` conditional in `pipeline/workflows/project-build.ts` (lines 85-103 in the task description) has been removed.

Previously:
```typescript
const plannerConfirmed = await act.checkBuildPlanExists(projectId);
// ...run Saanvi + Arjun...
if (!plannerConfirmed) {
  state.stage = "await_spec_approval";
  await condition(() => specApproved);
} else {
  console.log(`[workflow] planner confirmation found for ${projectId} — skipping approval gate`);
}
```

Now (unconditional gate):
```typescript
// ...run Saanvi + Arjun...
// GATE 1: Spec/Plan Approval — always required. A stale build-plan.json from a
// prior run must not bypass this; the user must confirm each new run's spec.
state.stage = "await_spec_approval";
await condition(() => specApproved);
```

## Is checkBuildPlanExists used elsewhere?

Grep results:
- `pipeline/activities/index.ts:57` — defines the function (not called from workflow anymore)
- `pipeline/workflows/project-build.ts` — call removed
- `pipeline/restart-build.ts:18` — appears only in a comment describing the old behavior; no actual call

The activity function `checkBuildPlanExists` was left in place in `pipeline/activities/index.ts` — it can be used for UI status checks if needed in the future.

## Commit

The fix was already present in commit `07ccd79 fix(qa): adversarial prompt, correct CRITICAL×20 weights, raise gate to ≥85`. No new commit was needed — the working tree matches HEAD exactly.

## Typecheck result

Pre-existing errors in unrelated agent files (`ModelId` type mismatches, auth type changes). Zero errors in `pipeline/workflows/project-build.ts`.
