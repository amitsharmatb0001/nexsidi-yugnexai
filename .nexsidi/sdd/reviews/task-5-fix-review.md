# Task 5 Fix Re-Review

Verdict: APPROVED

## Original findings addressed?

Both findings from `task-5-review.md` are closed.

1. **Misleading test name** — the test that passes `"wrong-hash-on-purpose"` and
   asserts `hash_mismatch` is now named
   `"verifyContext fails with hash_mismatch when the hash doesn't match"`,
   which accurately describes its body. The old name
   (`"verifyContext succeeds when hash matches and signature is valid"`) is gone.

2. **Coverage gap** — all three `VerifyResult` branches in `verify.ts` are now
   exercised:
   - `hash_mismatch` — test 1 (unchanged behavior, renamed).
   - `valid: true` success path — test 2, new. Generates a real RSA-2048
     keypair in `beforeAll`, calls the real `hashContext`/`signOutput`, and
     asserts `verifyContext(...)` returns exactly `{ valid: true }`.
   - `signature_invalid` — test 3, new. See deviation check below.

   `triggerRollback` (test 4) is untouched and still passes.

## Deviation check

The implementer's reasoning is **sound**, modulo one small imprecision in how
it's phrased.

I empirically tested `crypto.createVerify(...).verify(publicKey, sig, "hex")`
against both plain Node v22.17.1 and Bun v1.3.14 (the actual runtime `bun test`
uses) with a battery of garbage signature strings (`"fake-sig"`, `"x"`,
`"12345"`, `"!!!!invalid!!!!"`, `"undefined"`, odd-length hex runs, etc.):

- **Under plain Node**, `verify()` never throws for any of these — it always
  returns `false`.
- **Under Bun**, `verify()` throws `TypeError: The argument 'encoding' is
  invalid for data of length N. Received 'hex'` for any signature string with
  an **odd number of characters** (e.g. `"x"`, `"12345"`, `"undefined"`,
  `"!!!!invalid!!!!"`), because Bun's hex decoder checks length parity before
  attempting to decode. Even-length garbage (`"fake-sig"`, `"zzzzzzzz"`) does
  *not* throw — it decodes to a short/garbage buffer and `verify()` correctly
  returns `false`.

So it is true, in the runtime this suite actually runs under, that a casually-
chosen literal garbage string has a real (roughly 50/50, driven by parity)
chance of making `verify()` throw instead of returning `false` — this is not a
fabricated excuse. The one nit: the claim attributes this to "Node's
`crypto.verify()`"; more precisely it's Bun's implementation of the `node:crypto`
API that has this stricter behavior (plain Node doesn't throw at all in my
testing). This doesn't change the substance of the reasoning or the fix.

**Does the substitute approach genuinely exercise `signature_invalid`?** Yes.
In test 3:
```ts
const hash = hashContext(context);                    // matches expectedHash → hash check passes
const wrongSignature = signOutput({ agentFrom: "someone", agentTo: "else" }, privateKeyPath);
const result = verifyContext(context, hash, wrongSignature, publicKeyPath);
```
- `hash` is computed from the real `context`, so `verifyContext`'s
  `hashContext(context) !== expectedHash` check passes through (no
  `hash_mismatch` short-circuit) — this is what makes the test actually reach
  the `verifySignature` branch, rather than accidentally re-testing
  `hash_mismatch`.
- `wrongSignature` comes from a real `signOutput` call with the real private
  key, so it's well-formed, correctly-sized hex (512 hex chars for a 2048-bit
  key) — guaranteed not to hit the odd-length throw path, and structurally
  identical to what a genuine signature looks like.
- It's signed over a *different* JSON payload than `context`, so the RSA
  verification is a genuine cryptographic mismatch: `verifySignature` runs a
  real `createVerify(...).verify(...)` call and returns `false` because the
  signed bytes don't correspond to `context`'s canonicalized form — not
  because of a decode error.

This is a strictly better test than a garbage-hex approach would have been:
it's deterministic across runtimes (doesn't depend on hitting/avoiding a
parity-triggered throw) and it tests the actual security property the
`signature_invalid` branch exists to catch (a well-formed signature that
doesn't belong to this payload), not just "malformed input rejected."

## Test verification

Ran it directly, plus 3 repeat runs to check for flakiness/leftover state:

```
$ bun test packages/context-chain/src/verify.test.ts
bun test v1.3.14 (0d9b296a)

 4 pass
 0 fail
 5 expect() calls
Ran 4 tests across 1 file. [160-273ms across runs]
```

All 4 tests pass consistently (hash_mismatch, success path, signature_invalid,
triggerRollback).

## Findings

None blocking.

Minor, non-blocking observations (not required for this task's scope):
- Original review's recommendation #4 ("consider making this `sign.test.ts`
  with a fixture shared by both files") wasn't taken — the keypair is
  generated inline in `verify.test.ts`'s `beforeAll` instead. That recommendation
  was explicitly phrased as "consider," not required, and the current approach
  is self-contained and correct, so this isn't a defect.
- `hash.ts` (`canonicalize`) and the `verifySignature`/`signOutput` pair in
  `sign.ts` still have no dedicated unit tests of their own — they're only
  exercised indirectly through `verify.test.ts`. Pre-existing gap noted in the
  original review, out of scope for Task 5.

Temp file cleanup (item 5 of the review request): confirmed sound.
`beforeAll` creates a fresh unique directory via `mkdtempSync(join(tmpdir(),
"context-chain-test-"))` and writes `private.pem`/`public.pem` into it;
`afterAll` calls `rmSync(tmpDir, { recursive: true, force: true })`, which
removes the directory and both key files. Verified empirically: checked
`os.tmpdir()` for `context-chain-test-*` entries before and after 4 separate
`bun test` invocations — zero stray directories in every case. `force: true`
also means cleanup won't throw even if something upstream failed to create
the directory, so `afterAll` won't itself become a source of suite failure.

## Recommendation

APPROVED. Both original findings (misleading test name, missing branch
coverage) are fully addressed with real, non-stub tests, the reported
deviation is verifiably sound reasoning (confirmed empirically against the
actual Bun runtime, not just plausible-sounding), and temp file cleanup is
correct. No further changes required to close Task 5.
