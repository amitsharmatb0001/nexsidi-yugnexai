# rivhdw1 — issue log (comprehensive investor-proof-point build, per-step monitoring)

Riverside Hardware Co. — an online catalog + ordering platform. Purpose of
this run: explicit user request to prove the full pipeline (including
tonight's port fix, workflow retry signal, Riya's dependency-aware CRUD
verifier, and the newly-strengthened Shubham/Aanya self-checks) end-to-end
on a genuinely comprehensive project — multiple pages, multiple resources,
full GET/POST/PATCH/DELETE, admin/customer role separation, middleware —
good enough to show investors/advisors.

Format per entry: **What broke** → **Who caused it** → **Did QA/reviewer
catch it, and if not, why not** → **Fix + root cause** → **Status**.

---

## Confirmed working (verified directly, not just trusted)

1. **Saanvi locked the spec on the first pass with zero clarification
   rounds** — the brief already answered the self-management question
   implicitly ("we need to manage our own product catalog ourselves").
   6 real features, verified by reading spec.json directly.
2. **Arjun's plan is genuinely rich**: 11 endpoints, 5 tables — GET/POST/
   PATCH/DELETE across products, admin/products, orders, admin/orders,
   reviews. Confirmed via direct spec.json read, not trusted from a log line.
3. **Vanya did real design research** — web searches for hardware-store
   e-commerce UI patterns (McMaster, Grainger, Home Depot references), not
   a generic template. Design brief: slate gray + safety orange, Roboto —
   a genuinely industrial identity, not another purple-gradient default.
4. **Shubham's strengthened self-check is genuinely firing as designed** —
   observed live testing PATCH validation, UUID-format rejection, placing a
   real order, and specifically re-checking that PRODUCT STOCK DECREMENTED
   CORRECTLY after the order (real business-logic verification, not just
   "did the POST return 200"). This is exactly the depth requested.
5. **Aanya's click-through + visual-quality flow is running** — real
   browser_navigate/browser_console_errors/http_request sequence observed.

## Issues found this run

### 1. (Fixed at the source, not just per-project) `proxy.ts` vs `middleware.ts` — root cause was in the SCAFFOLD ITSELF, not agent judgment
- **What broke:** Observed live, mid-generation: Aanya editing a file literally named `proxy.ts`. Investigation found the root cause is NOT an Aanya judgment call — `writeStaticScaffold` (agents/generators/aanya/src/index.ts) mechanically writes the auth-middleware file to `path: "proxy.ts"` as part of the STATIC pre-written scaffold, before Aanya's own agent loop even starts. Worse: her system prompt's own Rule 8 explicitly said "NEVER create a middleware.ts file... Next.js rejects having both proxy.ts and middleware.ts present" — a confident, detailed, but FALSE claim. Next.js 16.2 simply never invokes a file named proxy.ts at all; middleware.ts is the only recognized convention (confirmed directly this session via real request logs on a live deploy: only middleware.ts received traffic).
- **Who caused it:** Whoever originally wrote this scaffold + prompt rule (predates this session) got the Next.js convention backwards and encoded it confidently into both the deterministic scaffold-writer AND the prompt's explicit rules.
- **Did QA catch it:** Yes, reactively — Navya has correctly flagged this exact defect on at least one earlier project (freshtst1) this session, and Aanya "fixed" it via a QA-triggered rename. But the fix was never applied to the SOURCE (scaffold + prompt), so every NEW project paid the same expensive QA round-trip to rediscover and re-fix the identical bug. This run (rivhdw1) was actively repeating that exact cycle when caught.
- **Root cause:** A factually incorrect belief about Next.js 16.2's middleware file-naming convention, hardcoded into both the deterministic scaffold and the prompt's explicit rules, with no test ever checking it.
- **Fix:** `writeStaticScaffold` now writes to `path: "middleware.ts"`. Prompt Rule 8 corrected to forbid `proxy.ts` and require `middleware.ts` (the opposite of before). Two new regression tests: one confirms the scaffold writes to the real filename, one confirms the prompt no longer contains the false "never create middleware.ts" claim. 876/876 full suite passing.
- **Status:** FIXED AT THE SOURCE. Not retroactively applied to rivhdw1's already-in-progress generation (the worker had already loaded the old code before this was found; restarting mid-activity would have discarded real progress) — this run will still pay the one-time QA round-trip cost, but every project generated AFTER this fix (including any retry of this exact stage) will get it right from the start. This is the exact "self-fix at the source, don't rely on QA every time" principle the user asked for, applied to a bug that was silently costing every single project a wasted round-trip.
