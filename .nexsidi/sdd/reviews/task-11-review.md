# Task 11 Review

Verdict: APPROVED

## Signature/keypair verification

Independently read the real source, not the report:

- `packages/context-chain/src/verify.ts:10` — `verifyContext(context: unknown, expectedHash: string, signature: string, publicKeyPath: string): VerifyResult` where `VerifyResult = { valid: boolean; reason?: "hash_mismatch" | "signature_invalid" }`.
- `packages/context-chain/src/verify.ts:26` — `triggerRollback(projectId: string, reason: string): never`, throws `Error("ROLLBACK:" + projectId)` with `{ rollback: true, projectId, reason }` attached.
- `packages/context-chain/src/sign.ts:5` — `signOutput(output: unknown, privateKeyPath: string): string` (reads the key file itself via `readFileSync`, takes a path not raw key material — confirms the diff's stated reason for needing a `privateKeyPath`).
- `packages/context-chain/src/hash.ts:14` — `hashContext(context: unknown): string`, SHA-256 over recursively key-sorted canonical JSON.

`stage4-multi-agent-dev.ts`'s `verifyAgentHandoff(from, to, context, expectedHash, signature, publicKeyPath)` (line 64) calls `verifyContext(context, expectedHash, signature, publicKeyPath)` exactly matching this real signature, and on `!result.valid` calls `triggerRollback(\`${from}->${to}\`, result.reason ?? "unknown")` — argument order and types line up with the real function, not the plan's 2-arg placeholder. This is a correct, deliberate divergence from the plan's stale sample, and it's documented inline as such (lines 59-63).

The keypair-per-project design is a reasonable, honestly-scoped stand-in: grepped the whole repo for other `signOutput`/`verifyContext` callers — only `packages/context-chain/src/verify.test.ts` existed before this task, using an identical ad-hoc `mkdtempSync` + `generateKeyPairSync` pattern scoped to that one test file. No pre-existing key-management convention was overridden or duplicated.

## Race condition check

Read `runStage4` (lines 129-171) directly, not the report's description. `getProjectKeyPair(projectId)` is called exactly **once**, synchronously, at line 142 — *before* `Promise.all([runPranav(plan), runShubham(plan)])` at line 146. Grepped the entire repo (`grep -rn "getProjectKeyPair"`) — the only call site anywhere is that single line in `runStage4`. Neither Pranav's nor Shubham's own `run()` (read both `agents/generators/pranav/src/index.ts` and `agents/generators/shubham/src/index.ts` in full) calls `getProjectKeyPair`, `signOutput`, or any context-chain function at all — they just return `GeneratorResult`. So the specific scenario in the review brief ("Pranav + Shubham both trigger key generation simultaneously inside the `Promise.all`") does not occur in this implementation: key generation happens on the orchestrator's own synchronous call stack before the parallel dispatch even starts, so there is nothing for two agents to race on.

`getProjectKeyPair` itself (lines 86-105) is correctly first-use-gated: `if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) return { ... }` before any `mkdirSync`/`generateKeyPairSync`/`writeFileSync`. Confirmed by the passing test "verifyAgentHandoff accepts a genuinely signed and hashed context" plus by direct code reading — this is not called unconditionally.

Residual (non-blocking, not what was asked, worth naming for completeness): `getProjectKeyPair`'s existsSync-then-write is a classic TOCTOU pattern with no lock file or atomic rename. It is *not* racy for the code path this task adds (single synchronous call per `runStage4` invocation, as shown above), but if `runStage4` were ever invoked twice concurrently for the *same* `projectId` from two separate processes (e.g. a retried pipeline run overlapping with the original), both calls could pass the `existsSync` check before either writes, and the private/public `.pem` files could end up written by different calls (each `writeFileSync` is atomic on its own, but the private/public pair as a unit is not). Nothing in Task 11's own scope triggers this today — the orchestrator runs Stage 4 once per project per pipeline invocation — but it's worth a one-line note for whoever eventually adds automatic retries.

## Sequencing check

Traced the `await` structure directly:

```
const [pranavResult, shubhamResult] = await Promise.all([runPranav(plan), runShubham(plan)]);  // line 146 — real parallel
signAndVerifyHandoff("pranav", "shubham", pranavResult, keys);                                  // line 152 — after both resolve
signAndVerifyHandoff("shubham", "aanya", shubhamResult, keys);                                  // line 158
const aanyaResult: GeneratorResult = await runAanya(plan, "integrate");                          // line 160 — only starts here
```

Pranav and Shubham genuinely run in parallel (single `Promise.all`, both promises created before either is awaited). `runAanya` is not called until both handoff verifications on line 152/158 have completed without throwing — this is real sequential JS control flow (no `Promise.all` around it, no floating promise), so Aanya's "integrate" pass, which per `agents/generators/aanya/src/index.ts` wires `fetch()` calls against Shubham's live contract, is correctly gated behind a verified (not just completed) Shubham output. Matches the design doc comment in the file (lines 154-158) and the plan's requirement.

## Test verification

Ran it myself:
```
$ bun test pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts
bun test v1.3.14 (0d9b296a)

 8 pass
 0 fail
 8 expect() calls
Ran 8 tests across 1 file. [87.00ms]
```

Read the rollback/tamper tests directly (lines 71-118 of the test file) — they use real crypto, not stubs:
- `beforeAll` generates one real RSA-2048 keypair with `generateKeyPairSync` and writes it to a real `mkdtempSync` temp dir (identical pattern to `packages/context-chain/src/verify.test.ts`).
- The "accepts" test calls the real `hashContext`/`signOutput` to produce a genuine hash and signature, then calls `verifyAgentHandoff` and asserts `{ valid: true }`.
- The "tampered context" test hashes/signs the *original* object, then passes a *different* object (`tampered`, with an extra column) into `verifyAgentHandoff` — this genuinely exercises the `hashContext(context) !== expectedHash` branch in `verify.ts`, not a mocked comparison. Asserts it throws `/ROLLBACK:pranav->shubham/`.
- The "wrong signature" test hashes the real context correctly (so the hash check passes) but supplies a signature genuinely produced by signing a *different* payload (`signOutput({ table: "someone_else" }, privateKeyPath)`) — this exercises the real `verifySignature`/`createVerify("RSA-SHA256")` failure path, not a fake string. Asserts the same rollback throw.
- The "wrong hash" test supplies a real signature but a literal wrong-hash string, exercising the hash-mismatch branch from the opposite angle.

All four crypto tests genuinely round-trip through real `crypto.createSign`/`createVerify`. Also independently confirmed via `bunx tsc --noEmit -p pipeline/tsconfig.json` that no error is attributable to `stage4-multi-agent-dev.ts` (only pre-existing, unrelated errors in `agents/tilotma/src/orchestrator.ts` and `packages/agent-runtime/src/{loop,tools/command}.ts`).

## Private key exposure check

- `Stage4Result` (lines 37-41) contains only `backendOutputDir`, `frontendOutputDir`, `filesWritten` — no key material, no key path, nothing crypto-related.
- `KeyPaths` (lines 79-82, not exported) only ever holds file *paths*, never raw key bytes, and stays local to `runStage4`'s closure — it's passed into `signAndVerifyHandoff` but never returned or logged.
- Grepped the diff for `console.log`/`console.error`/any print of `privateKey`, `keys.privateKeyPath`, or `KeyPaths` — none found. No `console.*` call exists anywhere in this file.
- The private key file itself is written only to `BUILD_DIR/{projectId}/keys/private.pem` (line 89, 102) — inside the same per-project sandbox root every other generator output already uses (`checkpoint.ts`, `gateway.ts`, and all three generator `getOutputDir` functions default to the same `BUILD_DIR` root, confirmed by grep), never outside it.

No private key exposure found.

## Findings

1. **(Real, non-blocking, but should be tracked) `identifyFaultAgent` is Task 12's deliverable, implemented one task early, inside Task 11's file.** Checked the plan directly: `identifyFaultAgent` and its three routing tests are specified under **Task 12: Stage 5 — Adversarial QA (3 Tiers) + Fault Isolation** (`docs/nexsidi/plans/2026-07-02-full-agentic-pipeline.md:968-985`, file target `stage5-adversarial-qa.ts`), not under Task 11 (whose own spec at line 860-869 lists only `stage4-multi-agent-dev.ts`/`.test.ts` and makes no mention of `identifyFaultAgent`). This diff defines and exports `identifyFaultAgent` from `stage4-multi-agent-dev.ts` instead (with a 4th test — the default-prefix case — that the plan's Task 12 sample doesn't even have). The implementer's own report describes it as "kept as-is from the plan's sample" without flagging that the sample belongs to a different, not-yet-built task/file. Functionally the routing logic itself is correct and verbatim-equivalent to the plan's sample (confirmed: `backend/`→shubham, `frontend/`→aanya, `db/`→pranav, default→shubham). But when Task 12 is implemented per its own spec, it will either (a) need to import `identifyFaultAgent` from `stage4-multi-agent-dev.ts` — a cross-stage-file dependency the plan never intended (Stage 5 "consuming" a Stage 4 internal helper) — or (b) redefine it in `stage5-adversarial-qa.ts` as the plan says, producing two competing definitions that can silently drift. Recommend explicitly deciding now (before Task 12 starts) which file owns `identifyFaultAgent`, rather than discovering the collision mid-Task-12.
2. **(Pre-existing, not introduced by this task, worth a one-line note)** `BUILD_DIR` default path is inconsistent across the codebase: `checkpoint.ts`, `gateway.ts`, `shubham`, `aanya`, `riya`, and this new `stage4-multi-agent-dev.ts` all default to `"C:/tmp/nexsidi-builds"`, while `arjun/src/index.ts` and `pranav/src/index.ts` default to `"/tmp/nexsidi-builds"`. Only matters if `BUILD_DIR` is ever left unset, in which case Pranav's own output directory and this stage's key directory would silently diverge to different roots. Stage 4's choice matches the majority/most-recent convention, so this diff didn't make things worse, but it's a latent footgun someone should reconcile.
3. No other issues found. Real crypto used throughout (both in the new stage and its tests), sequencing genuinely enforces the Aanya-after-Shubham-verification DAG edge, no key-generation race under the specific scenario asked about, no private key leakage anywhere.

## Recommendation

APPROVE Task 11 as implemented. The core deliverable — replacing the plan's stale 2-arg `verifyContext` placeholder with the real signature-and-hash verification path, backed by a genuine (if intentionally minimal, honestly-scoped) per-project keypair — is correct, exercises real cryptography end-to-end in both the implementation and its tests, and correctly encodes the parallel-then-sequential DAG shape (Pranav ∥ Shubham, then Aanya strictly after verification). No security or correctness blocker. The one finding worth acting on before Task 12 starts is #1 above — decide where `identifyFaultAgent` canonically lives so Task 12 doesn't have to choose between duplicating it or reaching back into Stage 4's file.
