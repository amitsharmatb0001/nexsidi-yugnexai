# meridianbk4 — issue log (running notes, per-step, not just gates)

Format per entry: **What broke** → **Who caused it** → **Did QA/reviewer catch it, and if not, why not** → **Fix + root cause** → **Status**.

---

## 1. `autoWireRoutes` silently reverted Shubham's route-mount fixes
- **What broke:** Shubham fixed `backend/src/routes/index.ts` mount paths (`/appointment`→`/appointments` etc.), verified live, called `task_complete`. `runFix()` then unconditionally called `autoWireRoutes()`, which mechanically regenerates the file from `*.routes.ts` filenames, reverting the fix.
- **Who caused it:** `agents/generators/shubham/src/index.ts` (`autoWireRoutes`, added to fix an unrelated earlier bug — new route files never getting wired in at all).
- **Did QA catch it:** Yes — Navya re-flagged the identical finding 3 times across 3 separate "verified: true" fix passes. QA worked correctly; the fix itself could never stick because of the mechanical revert.
- **Root cause:** `autoWireRoutes` had no concept of "already wired, leave the mount path alone" — it always fully regenerated the file.
- **Fix:** `autoWireRoutes` now skips regeneration for any route file already imported in `index.ts`, only wiring in genuinely new ones. Tests: `agents/generators/shubham/src/autowire.test.ts`.
- **Status:** Fixed, tested (6/6 pass), confirmed live — the same fix now genuinely persists on disk.

## 2. Severity-weighted QA score let a functionality-breaking HIGH finding ship
- **What broke:** Navya's route-mismatch finding scored HIGH (10-pt penalty, 100-10=90 ≥ 85 pass threshold). `runStage5WithAgents`'s `allPass` check passed on that score alone and returned `findings: []`, discarding the finding entirely before debate ever ran (debate was gated on `!result.pass`). The app deployed with booking/shop pages 404ing.
- **Who caused it:** `pipeline/orchestrator/stages/stage5-adversarial-qa.ts` (findings discarded on pass) + `stage5-qa-fix-loop.ts` (debate gated on `!result.pass`).
- **Did QA catch it:** Navya DID catch and correctly classify it. The pipeline's own aggregation/debate-gating logic is what threw the finding away, not a QA miss.
- **Root cause:** Two-part: (a) findings were only ever returned on the failing branch, never the passing one; (b) debate — which has explicit prompt guardrails for exactly this class of finding — only ran when the aggregate had already failed, so a technically-passing score bypassed independent verification entirely.
- **Fix:** `runStage5WithAgents` now always returns findings (even on pass). `runQAFixLoopWithDeps` now runs debate whenever findings exist, regardless of pass/fail; a debate-CONFIRMED CRITICAL/HIGH finding overrides a passing score, MEDIUM/LOW does not (preserves the intentional noise-tolerance of the ≥85 threshold). Tests: `stage5-adversarial-qa.test.ts`, `stage5-qa-fix-loop.test.ts`.
- **Status:** Fixed, tested (33/33 + 30/30 pass).

## 3. Riya's live-verification tool falsely failed a working deploy
- **What broke:** `api-contract.json`'s `requestType` for `POST /api/v1/appointments` was an inline literal (`"{ service_id: string; appointment_date: string }"`), not a named interface. `buildPayloadForRequestType` only matched `interface Name { ... }` in `shared-types.ts`, silently returned null, fell back to `{title: marker}`, and the live-verification POST got a real 400 — reported as "deploy failed" on an app that actually worked (independently confirmed: manual register→login→book with the correct shape returned a real 201).
- **Who caused it:** `agents/riya/src/index.ts` (`buildPayloadForRequestType`) — a gap in the verification tool, not the generated app.
- **Did QA catch it:** N/A — this is post-deploy Tier-3/Riya verification, not Navya/Karan/Deepika's static review. No one else was positioned to catch this; it's a first-of-kind gap (a prior, structurally similar bug — hardcoded `{title}` — was already fixed once; this is the same failure class in a second source-format).
- **Root cause:** The payload-derivation function only handled one of the two shapes Arjun's contract generator actually produces (named reference vs inline literal).
- **Fix:** `buildPayloadForRequestType` now also parses an inline object-literal `requestType` directly. Tests: `agents/riya/src/verify-live-auth.test.ts`.
- **Status:** Fixed, tested (19/19 pass), confirmed live via direct manual HTTP test.

## 4. `modelChain[modelIdx] ?? config.model` silently reintroduced a sanitized-out model
- **What broke:** Riya's configured primary model `moonshotai/kimi-k2.6` (no `fallbackModels` configured at all) is deliberately filtered by `sanitizeModelChain` (confirmed intentional — locked in by an existing test in `model-failover.test.ts`). That makes Riya's sanitized chain completely empty. `runAgent`'s loop read `modelChain[modelIdx] ?? config.model`, and with an empty array that `??` silently fell through to the ORIGINAL, just-filtered-out `config.model` — defeating sanitization entirely. Every live Riya deploy attempt burned `MAX_CONSECUTIVE_TRANSPORT_FAILURES` (5) real network round-trips against the disallowed model — 1-2 minutes wasted — before `runAgentEscalated`'s `cannot_finish` path finally escalated to the Gemini path that actually works.
- **Who caused it:** `packages/agent-runtime/src/loop.ts` (`runAgent`'s model-selection line) — the sanitizer itself was correct; the caller ignored what "sanitized to empty" actually means.
- **Did QA catch it:** N/A — infra/routing, not app code. Caught by direct observation while re-running deploy (near-zero CPU, no log progress for 2+ minutes was the tell).
- **Root cause:** No code path handled "the sanitized chain is empty" as its own case — the `??` fallback was written for a different situation (index past the end of a non-empty chain) and accidentally also covered the empty-chain case, the wrong way.
- **Fix:** `runAgent` now returns an immediate `escalationReason: "cannot_finish"` failure when `modelChain.length === 0`, instead of ever calling the API with the disallowed model. Tests: `packages/agent-runtime/src/model-failover.test.ts`. Side effect (expected, not a regression): 3 existing tests (`max-iterations.test.ts`, `persistent-fallback.test.ts`, `mcp/integration.test.ts`) used `model: "mock-model"` — no allowed provider prefix — and were unknowingly passing BECAUSE of this exact bug (the disallowed placeholder silently reached their fully-mocked `nimChatWithTools`, which ignores the model string anyway). Updated all three to `"google/mock-model"` — still a placeholder, now one the sanitizer actually lets through.
- **Status:** Fixed, tested (461/461 pass across `packages/agent-runtime/`, `agents/riya/`, `pipeline/`).

## 5. Misleading escalation log message
- **What broke:** `[riya:escalation] ... escalating to Claude (claude-sonnet-5) as one-time retry` — the log claims escalation to Claude/Sonnet, but the actual work happens on `riya:gemini-agent` with `gemini-3.5-flash`/`gemini-3.6-flash`. Purely a log-message accuracy issue, not a functional bug (the real escalation target works).
- **Status:** Open, low priority.

## 6. Riya's synthetic booking payload used a placeholder value for a foreign-key field
- **What broke:** Direct follow-on to #3 — once `service_id`/`appointment_date` were actually included in the payload, the create call still 400'd: "Invalid UUID format for service_id, appointment_date: Invalid appointment_date format". `fieldsToPayload`'s fallback for an unrecognized string field is the raw marker string, which is neither a valid UUID nor a valid date.
- **Who caused it:** `agents/riya/src/index.ts` (`fieldsToPayload`, `verifyLiveAuthenticatedRoundTrip`) — verification-tool gap, not the generated app (independently confirmed live: a real service_id fetched from `GET /api/v1/services` plus a real ISO date returned a genuine 201).
- **Did QA catch it:** N/A — same post-deploy verification layer as #3.
- **Root cause:** The payload builder had no concept of "this field references another resource" (`_id` suffix) or "this field needs a real date format" — both produced a placeholder that fails format/existence validation regardless of whether the real app works.
- **Fix:** Added a `"date"`-name heuristic (real near-future ISO date) alongside the existing `"email"` heuristic. Added `resolveForeignKeyId`: for any `_id`-suffixed field, looks up a real existing id from the matching `GET` list endpoint in the same `api-contract.json` (e.g. `service_id` → `GET /api/v1/services`) and substitutes it before the create call. Tests: `agents/riya/src/verify-live-auth.test.ts`.
- **Status:** Fixed, tested (20/20 pass in `agents/riya/`).

## 7. `resolveForeignKeyId`'s first version couldn't unwrap the real, double-nested response envelope
- **What broke:** Live redeploy after fix #6 still 400'd on `service_id` alone (`appointment_date` was now valid — the date heuristic worked). The real `GET /api/v1/services` response is `{"success":true,"data":{"services":[...]}}` — Express's `{success, data}` envelope wrapping ANOTHER named-key object, not a bare array at either level. The first version of `resolveForeignKeyId` only checked one level (`Object.values(body).find(Array.isArray)`), which found neither `true` nor `{services:[...]}` to be an array, and always returned `undefined`.
- **Who caused it:** `agents/riya/src/index.ts` (`resolveForeignKeyId`) — same fix, deeper envelope than the mock test in #6 originally covered (that test used a shallower `{data:[...]}` shape that happened to pass, masking the real depth).
- **Did QA catch it:** N/A — same layer as #3/#6.
- **Root cause:** The unwrap logic assumed at most one level of `{key: [...]}` wrapping; the real backend's convention nests two.
- **Fix:** Added `findFirstArray`, a small recursive search (2 levels deep) for the first array anywhere in the response body. Updated fix #6's own test to use the REAL double-nested shape instead of the shallower one that had been passing by accident. Independently verified live: `resolveForeignKeyId("service_id", ...)` against the actual running backend returns a real UUID.
- **Status:** Fixed, tested (20/20 pass in `agents/riya/`), confirmed against the live backend directly.

## 8. (Open, needs a human decision) Tier 3 flags the intentional YugNex watermark as "Internal Brand Leakage [CONFIRMED — blocking]"
- **What happened:** With every other bug fixed, the full pipeline finally reached a real Tier-3 live review. Tilotma's evidence-collector + reality-checker (independent, both agree) flag the footer "Developed & Managed by YugNex™" + trademark note as a CONFIRMED, automatically-blocking confidentiality violation, quoting `debate`'s own hardcoded guardrail ("mentions NexSidi, NexUI, or @yugnex in user-facing text ... never a style preference").
- **Why this happened:** That guardrail (and CLAUDE.md's confidentiality rule it's based on) predates this session's explicit, later decision to add a deliberate YugNex-branding watermark to every generated app (`agents/generators/aanya/src/index.ts`'s `YUGNEX_WATERMARK` rule, built earlier this session at the user's request). Nothing was ever updated to teach the QA/Tier-3 layer that this specific watermark is an intentional product feature, not an accidental internal-architecture leak — so it correctly enforces a rule that's now stale for this one case.
- **This is not a code bug** — it's a policy/rule conflict between an old confidentiality rule and a newer product decision. Needs a human call: either exempt the watermark's exact text from the confidentiality check, or decide the watermark itself should be removed/changed.
- **Status:** Open — flagged for Amit, not something to silently code around.

## 9. (Open, partially investigated) Tier 3 flags "Severe Corrupted & Overlapping Font Glyph Rendering" — confirmed real in the screenshot, NOT reproduced live
- **What happened:** Both Tilotma agents independently flagged small UI text (button labels, card body copy) as squashed/overlapping, confirmed via screenshots (`tier3-review-screenshots/meridianbk4/recheck-*.png`).
- **What I found:** I viewed `recheck-landing.png` directly and it IS visibly distorted — this is a real artifact, not a hallucination (an earlier live-DOM bounding-box check I did only proved elements don't overlap in LAYOUT position, which is a different property from glyph rendering quality — my first pass wrongly called this a hallucination before actually looking at the image). Root-cause trail so far: the affected text uses `@yugnex/nexui-react`'s `<nex-button>`/`<nex-input>` web components, whose font-size resolves through a `clamp(13px, 12.7143px + 0.0893vw, 14px)` fluid-type token to a fractional `13.8573px` at this viewport. However, my OWN interactive browser screenshot at the same effective size showed the same text small but legible, NOT "overlapping/unreadable" — suggesting this may be specific to whatever headless screenshot pipeline the Tier-3 tools use (font hinting/rasterization differences), not something a real visitor sees in an actual browser. Not confirmed either way with certainty.
- **Status:** Open — real defect in the captured evidence, cause not fully isolated (candidates: headless-Chromium font rendering vs. the fluid-type clamp() token vs. something inside NexUI's shadow-DOM component itself). Needs either a same-environment screenshot comparison or accepting the live interactive result as ground truth.
