# Task 5 Review

Verdict: NEEDS_FIXES

## Premise check

Accurate. Read `packages/context-chain/src/index.ts` directly:

```ts
export { canonicalize, hashContext } from "./hash.ts";
export { signOutput, verifySignature } from "./sign.ts";
export { verifyContext, triggerRollback, type VerifyResult } from "./verify.ts";
```

`verifyContext`, `triggerRollback`, and `hashContext` are all genuinely exported.
`git log --oneline -- packages/context-chain/src/index.ts` shows the file's only
commit is `3cc409a` ("Phase 0 skeleton"), before Task 5 started — the export was
never missing. `git show 38f39fd --stat` confirms the diff touches only the new
test file (`verify.test.ts`, +14 lines); `index.ts` is untouched. The implementer's
claim is not a cover story — it's verifiably correct, and not force-editing
already-correct code was the right call.

## Test verification

Ran it directly:

```
$ bun test packages/context-chain/src/verify.test.ts
bun test v1.3.14 (0d9b296a)

 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [100.00ms]
```

Passes cleanly.

## Findings

**1. Coverage gap — only 1 of 3 `verifyContext` branches is tested (real finding, confirmed).**
`verify.ts` has three possible outcomes:
- `hash_mismatch` (tested)
- `signature_invalid` (NOT tested)
- `valid: true` success path (NOT tested)

Only the first is exercised. The success path is the one that matters most for the
patent-chain guarantee (Claim 3: rollback triggers correctly *only* when verification
genuinely fails, and passes through cleanly when it genuinely succeeds) — right now
nothing proves `verifyContext` ever returns `{ valid: true }` for a real matching
hash + real valid signature, or that it correctly rejects a bad signature over a
correct hash. This is exactly the gap the task prompt asked me to check for, and it's
real regardless of the plan's wrong premise about the export.

Digging further: this isn't unique to Task 5's test. `hash.ts` (`canonicalize`,
`hashContext`) and `sign.ts` (`signOutput`, `verifySignature`) have **zero** unit
tests anywhere in the repo — `packages/context-chain/src` contains only
`verify.test.ts`. The plan document's own Step 1 code (lines 392–402 of
`docs/nexsidi/plans/2026-07-02-full-agentic-pipeline.md`) has a comment claiming
"the throwaway keypair fixture already used by sign.test.ts" — but no `sign.test.ts`
exists in the repo. That fixture doesn't exist. The implementer copied the plan's
test verbatim (correctly, since that's what subagent-driven dev is supposed to do),
but the plan itself under-scoped the test and cited a nonexistent fixture as
justification for skipping the harder cases.

**2. Test name is factually wrong (new finding, not in the task prompt's checklist but worth flagging).**
The first test is titled:
```
test("verifyContext succeeds when hash matches and signature is valid", () => {
```
but its body does the opposite — it passes `"wrong-hash-on-purpose"` as the expected
hash and asserts `result.valid` is `false` with `reason: "hash_mismatch"`. The name
describes the success case; the body tests the failure case. This is inherited
verbatim from the plan document, so it's not an implementer-introduced bug, but it
is now shipped, misleading, and will confuse the next person who reads test output
or greps test names to find success-path coverage.

## Recommendation

NEEDS_FIXES, scoped narrowly — this isn't a rejection of the work done, it's a
call to close the gap the task title ("Export Context Hash Chain Verification")
implies but the plan didn't actually deliver:

1. Rename the existing test to match what it actually does, e.g.
   `"verifyContext returns hash_mismatch when expectedHash doesn't match"`.
2. Add a genuine success-path test: generate (or check in as a fixture) a throwaway
   RSA keypair, call `signOutput`/`verifySignature` for real, and assert
   `verifyContext(context, hashContext(context), realSignature, publicKeyPath)`
   returns `{ valid: true }`.
3. Add a `signature_invalid` branch test: correct hash, garbage/tampered signature,
   assert `{ valid: false, reason: "signature_invalid" }`.
4. Consider whether this becomes `sign.test.ts` (shared keypair fixture used by both
   `sign.test.ts` and `verify.test.ts`) so the plan's aspirational comment becomes
   true instead of aspirational.

None of this blocks Task 5's original narrow scope (confirming the export exists),
but it should not be treated as "hash chain verification is now tested" without
these additions — right now it's "hash chain verification's failure-on-tamper path
is tested," which is a meaningfully smaller claim.
