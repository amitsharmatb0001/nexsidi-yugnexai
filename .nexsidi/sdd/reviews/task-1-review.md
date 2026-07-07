# Task 1 Review

Verdict: NEEDS_FIXES

## Spec compliance

Function signatures match exactly:
- `writeCheckpoint(projectId: string, stage: string, data: unknown): void` — matches.
- `readCheckpoint<T>(projectId: string, stage: string): T | null` — matches.
- `types.ts` defines `FeatureFlags`, `GatewayDecision`, `DagTask`, `Dag` exactly as the plan's Step 3 code block specifies.

One real gap: the plan's own "Interfaces" line for Task 1 (line 58) explicitly lists `type PipelineCheckpoint` as a produced interface, and the top-of-doc File Map (line 27) also names `PipelineCheckpoint` as one of the shared types that belongs in `types.ts`. **No `PipelineCheckpoint` type exists anywhere in the diff or the current codebase** (confirmed via repo-wide grep — the only two hits are the plan doc itself). The plan's Step 3 code sample is internally inconsistent with its own Interfaces line (Step 3 never defines it either), so this may be an error in the plan rather than the implementer — but as written, the task is not fully satisfied: a named type that later stages/checkpoints could reference for `PipelineCheckpoint`'s shape doesn't exist. Nothing currently breaks because of this (no consumer references it yet), but it's a literal, checkable spec item that wasn't delivered.

Test file matches the plan's Step 1 test almost verbatim; the only difference is the implementer's version drops the unused `existsSync` import that the plan's own test imported but never called — a harmless, arguably correct cleanup, not a deviation of substance.

Commit message ("feat: add stage checkpoint read/write for pipeline crash-resume") matches Step 5 exactly. Commit `7cc36d8` touches exactly the three files the plan's `git add` line specifies (`types.ts`, `checkpoint.ts`, `checkpoint.test.ts`), 58 insertions, no extras. Currently on branch `claude/eager-varahamihira-967edb`, which is correct.

I cannot independently verify the implementer actually watched the test fail first (Step 2) from a diff alone — that's a process claim, not something visible in the artifact. Flagging as a limitation of this review, not a finding.

## Test verification

Ran it myself:
```
$ bun test pipeline/orchestrator/checkpoint.test.ts
bun test v1.3.14 (0d9b296a)

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [58.00ms]
```
Confirmed passing, independent of the implementer's report. Also confirmed no drift between the reviewed commit (`7cc36d8`) and current `HEAD` for these three files (`git diff 7cc36d8 HEAD -- <files>` is empty).

## Findings

**1. Path traversal in `checkpointPath` — real, demonstrated (Medium-High).**
`checkpointPath` does `join(buildDir, projectId, "checkpoints", \`${stage}.json\`)` with zero validation on `projectId` or `stage`. I proved this is exploitable, not theoretical:
```
writeCheckpoint("../../escaped-project", "01-requirements", { pwned: true });
```
wrote a file to `C:/escaped-project/checkpoints/01-requirements.json` — two directories above the intended `C:/tmp/nexsidi-builds` root. Both `..` segments and absolute-path segments (e.g. a `stage` value containing `../../`) are unguarded. In practice `projectId` is documented elsewhere (CLAUDE.md D30) to be a 12-char SHA-256 hash and `stage` values are hardcoded internal strings today, so the current call sites aren't attacker-reachable — but the function itself has no defense-in-depth, and it's the shared primitive every later stage/checkpoint call will route through. Given the project's own zero-tolerance security posture for the pipeline it's building, this is worth a one-line fix now (reject/sanitize any `projectId`/`stage` containing `..`, `/`, or `\`) rather than after Karan's QA stage exists to catch it. I cleaned up my probe artifacts (`C:/escaped-project`, `probe-corrupt`) after confirming.

**2. `readCheckpoint` crashes ungracefully on malformed JSON (Medium).**
Confirmed by writing a corrupt checkpoint file and calling `readCheckpoint`:
```
THREW: SyntaxError - JSON Parse error: Expected '}'
```
There's no try/catch around `JSON.parse`; a corrupted or partially-written checkpoint file throws a raw, uncontextualized `SyntaxError` all the way up to the caller — it doesn't say which project/stage/path failed. This matters specifically because the module's stated purpose (File Map line 28) is "resume detection" for crash-resume: a crash that happens to land mid-`writeFileSync` (see Finding 3) produces exactly the corrupt file that then breaks the resume path this module exists to support. At minimum this should throw a clear, catchable error identifying the offending checkpoint; ideally it should be distinguishable from "checkpoint doesn't exist" so callers can decide whether to treat corruption as a hard failure or as re-runnable state.

**3. No atomic write — write is not crash-safe (Low, related to #2).**
`writeFileSync` writes directly to the final path with no temp-file+rename. A process crash or power loss mid-write can leave a truncated/corrupt JSON file, which Finding 2 shows `readCheckpoint` cannot recover from gracefully. Low severity on its own (requires a badly-timed crash), but combined with Finding 2 it's a real gap in the "crash-resume" guarantee the module is supposed to provide.

**4. `PipelineCheckpoint` type never defined — see Spec compliance above.** Listed here too since it's a concrete, checkable omission against the plan text, not just a nice-to-have.

No race-condition issues found beyond #3 — the module is synchronous and stateless per call, consistent with the "no hidden state" global constraint; there's no shared in-memory state to race on within a single process.

No over-/under-engineering: the shipped code is a literal match of the plan's "minimal implementation," appropriately sized for the task. No dead code.

## Recommendation

NEEDS_FIXES before this is safe to build on top of in Task 10+ (which chains checkpoints across stages 1-3 and will be the first real consumer of crash-resume):
1. Add basic input validation to `checkpointPath` (reject `projectId`/`stage` containing path-traversal sequences) — cheap, closes a demonstrated hole.
2. Wrap `JSON.parse` in `readCheckpoint` with a try/catch that throws a clear, checkpoint-identifying error (or otherwise fails predictably) instead of an opaque `SyntaxError`.
3. Either add the missing `PipelineCheckpoint` type to `types.ts` per the plan's own Interfaces line, or explicitly note in the plan/progress log that it was dropped as unnecessary — right now it's just silently missing.
4. (Optional, lower priority) Consider a write-temp-then-rename pattern for `writeCheckpoint` to make the crash-resume guarantee actually hold under a mid-write crash.

None of these require large rework — the two-line fixes in #1 and #2 address the demonstrated, evidence-backed issues.
