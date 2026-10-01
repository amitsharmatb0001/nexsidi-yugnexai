# Pipeline Speed (without changing the loops) — Implementation Plan

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Cut the hours a build loses to stuck NIM runs and to full review
rounds on apps whose sign-in is broken — without touching the adversarial QA
loop, the full retest after every finding (Claim 10), or any scoring threshold.

**Architecture:** Two additive guards and one guidance change. (1) A wall-clock
budget on the NIM leg of `runAgentEscalated` only — when it runs out, the
existing NIM→Gemini handover takes over. (2) A deterministic auth smoke test in
Stage 6, run with the other cheap checks before the expensive review (the D21
"cheap gate first" pattern already used by spec-compliance); it fails open on
any infrastructure error. (3) Page-composition guidance in Aanya's skill.

**Tech Stack:** Bun 1.3, TypeScript, existing `BrowserSession`
(packages/agent-runtime/src/browser/client.ts), Temporal (unchanged).

## Evidence this plan is based on (measured, project a034f90ba50e)

| Measurement | Result |
|---|---|
| Successful NIM runs | 1–12 min typically, slowest 30 min (evidence collector) |
| Failed NIM runs (never finished) | 40–60 min each, then Gemini finished in ~10 |
| `docker compose up` (redeploy) | ~30 s normally; one 8 min outlier after a dependency change |
| Clean review round (final, all fixes in) | ~20 min: deploy 5, code review 6, evidence 2, reality 3, design 3 |
| Rounds lost to "sign-in/sign-up broken" | 3–4 full rounds (~20–60 min each) |

**Dropped from the earlier proposal:** Docker layer caching. The generated
Dockerfiles already install dependencies in their own layer and builds are
cached (~30 s). Changing them adds risk for no measured gain.

## Global Constraints

- Patent loops unchanged: Stage 5 adversarial QA, Stage 6 full live retest after
  every fix round (Claim 10), stuck detection, 85 / 7.0 thresholds.
- Every new gate FAILS OPEN on its own errors: a broken checker never blocks a build.
- Every new behaviour has an env kill switch (no code change to turn it off).
- Tests written first (nexsidi-testing); `bun test` (all) + `tsc --noEmit` in
  every touched package before each commit; one commit per task.
- The worker is restarted with new code only when no build is mid-review.
- No agent names in anything user-facing.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `packages/agent-runtime/src/nim-time-budget.ts` | Create | Resolve the budget from env; decide "budget exceeded" |
| `packages/agent-runtime/src/nim-time-budget.test.ts` | Create | Unit tests |
| `packages/agent-runtime/src/loop.ts` | Modify | Honour `config.timeBudgetMs` at the top of each iteration |
| `packages/agent-runtime/src/claude-loop.ts` | Modify | `runAgentEscalated` passes the budget to the NIM leg only |
| `packages/agent-runtime/src/claude-loop.test.ts` | Modify | Escalation still happens when the NIM leg stops on budget |
| `pipeline/orchestrator/stages/auth-smoke.ts` | Create | Deterministic sign-up → sign-in → sign-out check |
| `pipeline/orchestrator/stages/auth-smoke.test.ts` | Create | Tests with a fake browser session |
| `pipeline/orchestrator/stages/stage6-deployment.ts` | Modify | Run the smoke test with the cheap checks; skip expensive review on a definite failure |
| `packages/agent-runtime/skills/aanya/00-identity-and-visual-doctrine.md` | Modify | Page-composition and session-aware header guidance |

---

### Task 1: NIM time budget (escalated runs only)

**Why only escalated runs:** `runAgentEscalated` has Gemini behind the NIM leg.
A direct NIM caller has no fallback, so a budget there could turn a slow success
into a failure. The budget is passed explicitly by `runAgentEscalated`; nothing
else sets it.

**Files:** Create `packages/agent-runtime/src/nim-time-budget.ts` (+ test);
modify `loop.ts`, `claude-loop.ts`, `claude-loop.test.ts`.

**Interfaces:**
- Produces: `nimTimeBudgetMs(env?): number` (0 = disabled),
  `timeBudgetExceeded(startedAt: number, now: number, budgetMs: number): boolean`,
  `AgentRunConfig.timeBudgetMs?: number`.

- [ ] **Step 1: Write the failing tests**
```typescript
// nim-time-budget.test.ts
import { test, expect } from "bun:test";
import { nimTimeBudgetMs, timeBudgetExceeded } from "./nim-time-budget.ts";

test("defaults to 20 minutes, NIM_RUN_MAX_MINUTES overrides, 0 disables", () => {
  expect(nimTimeBudgetMs({})).toBe(20 * 60_000);
  expect(nimTimeBudgetMs({ NIM_RUN_MAX_MINUTES: "15" })).toBe(15 * 60_000);
  expect(nimTimeBudgetMs({ NIM_RUN_MAX_MINUTES: "0" })).toBe(0);
  expect(nimTimeBudgetMs({ NIM_RUN_MAX_MINUTES: "abc" })).toBe(20 * 60_000);
});

test("exceeded only past the budget, never when disabled", () => {
  expect(timeBudgetExceeded(0, 20 * 60_000, 20 * 60_000)).toBe(false);
  expect(timeBudgetExceeded(0, 20 * 60_000 + 1, 20 * 60_000)).toBe(true);
  expect(timeBudgetExceeded(0, 10 ** 12, 0)).toBe(false);
});

test("the NIM loop checks the budget each iteration, and only runAgentEscalated sets it", () => {
  const { readFileSync } = require("node:fs");
  const loop = readFileSync(new URL("./loop.ts", import.meta.url), "utf-8");
  const escalated = readFileSync(new URL("./claude-loop.ts", import.meta.url), "utf-8");
  expect(loop).toContain("timeBudgetExceeded(startedAt, Date.now(), config.timeBudgetMs ?? 0)");
  expect(escalated).toContain("deps.runNim({ ...config, timeBudgetMs: nimTimeBudgetMs() })");
});
```
```typescript
// claude-loop.test.ts — added
test("a NIM leg stopped by its time budget still escalates to the provider", async () => {
  let providerCalled = false;
  const result = await runAgentEscalated(BASE_CONFIG, {
    runNim: async () => ({ success: false, summary: "Aborted after NIM time budget (20 min) reached", filesWritten: [], iterations: 12, errors: [], escalationReason: "cannot_finish" }),
    runClaude: async () => { providerCalled = true; return { success: true, summary: "done", filesWritten: [], iterations: 5, errors: [] }; },
  });
  expect(providerCalled).toBe(true);
  expect(result.escalated).toBe(true);
});
```
- [ ] **Step 2: Run, verify FAIL** — `bun test packages/agent-runtime/src/nim-time-budget.test.ts` → "Cannot find module".

- [ ] **Step 3: Implement**
```typescript
// nim-time-budget.ts
const DEFAULT_MINUTES = 20; // measured: NIM successes ≤30 min (most ≤12); stuck runs 40–60 min

export function nimTimeBudgetMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.NIM_RUN_MAX_MINUTES?.trim();
  const minutes = raw === undefined || raw === "" ? DEFAULT_MINUTES : Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_MINUTES * 60_000;
  return minutes * 60_000;
}

export function timeBudgetExceeded(startedAt: number, now: number, budgetMs: number): boolean {
  return budgetMs > 0 && now - startedAt > budgetMs;
}
```
`loop.ts` — add `timeBudgetMs?: number` to `AgentRunConfig` (comment: set only by
runAgentEscalated); `const startedAt = Date.now();` before the while loop; first
statement inside the loop:
```typescript
if (timeBudgetExceeded(startedAt, Date.now(), config.timeBudgetMs ?? 0)) {
  transportAbortReason = `NIM time budget (${Math.round((config.timeBudgetMs ?? 0) / 60_000)} min) reached — handing over`;
  errors.push(`Aborting after ${transportAbortReason}`);
  abortedOnTransportFailures = true;
  break;
}
```
(Reuses the existing early-stop path: history is saved, the result is
`success:false` with the reason in `summary`, and `runAgentEscalated` hands over
with `buildEscalationMessage` — exactly what happens today after 5 transport failures.)

`claude-loop.ts` — in `runAgentEscalated`: `const nimResult = await deps.runNim({ ...config, timeBudgetMs: nimTimeBudgetMs() });`

- [ ] **Step 4: Run, verify PASS** — the three files above plus full `bun test`; `tsc --noEmit` in packages/agent-runtime.
- [ ] **Step 5: Commit** — `fix(agent-runtime): NIM leg of an escalated run hands over after 20 min`

**Risk check:** sub-agents spawned inside a NIM run inherit no budget (not
passed in the spawn config) — unchanged behaviour. Kill switch: `NIM_RUN_MAX_MINUTES=0`.

---

### Task 2: Auth smoke test (cheap gate before the expensive review)

**What it checks (every app with auth, nothing app-specific):**
1. Sign-up page: fill every visible input (email → unique test email,
   password → generated test password, other text inputs → "Test User"),
   press the submit button. **Definite failure:** logging in with those
   credentials through the backend API then fails (the UI did not create the user).
2. Sign-in page: same credentials, submit. **Definite failure:** 6 s later the
   browser is still on the sign-in page (the bug from a034f90ba50e).
3. Sign-out: if a control named "Sign out"/"Log out" exists, press it.
   **Definite failure:** the token cookie is still set afterwards.

**Never a failure (skip, log, continue to the full review):** no auth endpoints
in the contract; sign-in/sign-up page not found; any browser/worker error or
timeout. The full review always still runs when this passes or is skipped.

**Files:** Create `pipeline/orchestrator/stages/auth-smoke.ts` (+ test); modify `stage6-deployment.ts`.

**Interfaces:**
- Consumes: `BrowserSession.send(action, args)` (navigate, fill, click, currentUrl, evaluate, exists), `resolveAuthPaths(endpoints)` from agents/riya.
- Produces:
```typescript
export interface AuthSmokeResult { ran: boolean; pass: boolean; findings: string[]; skippedReason?: string }
export interface BrowserLike { send(action: string, args?: Record<string, unknown>): Promise<unknown>; close(): Promise<void> }
export async function runAuthSmokeTest(opts: {
  appUrl: string; backendUrl: string;
  endpoints: Array<{ method: string; path: string }>;
  browser: BrowserLike; fetchFn?: typeof fetch;
}): Promise<AuthSmokeResult>
```

- [ ] **Step 1: Write the failing tests** (fake browser: a small state machine
  recording calls; `fetchFn` stub for the backend login check)
```typescript
test("passes when sign-up creates the user, sign-in leaves the sign-in page, sign-out clears the cookie", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ afterSignInUrl: "/dashboard", cookieAfterSignOut: false }), fetchFn: loginOk });
  expect(r).toEqual({ ran: true, pass: true, findings: [] });
});
test("fails when the user is still on the sign-in page after a successful sign-in", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ afterSignInUrl: "/sign-in" }), fetchFn: loginOk });
  expect(r.pass).toBe(false);
  expect(r.findings[0]).toContain("still on the sign-in page");
});
test("fails when the sign-up form did not create the user", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: fakeBrowser({ afterSignInUrl: "/dashboard" }), fetchFn: loginFails });
  expect(r.pass).toBe(false);
  expect(r.findings[0]).toContain("sign-up form");
});
test("skips (never fails) an app with no auth endpoints", async () => {
  const r = await runAuthSmokeTest({ ...BASE, endpoints: [{ method: "GET", path: "/api/items" }], browser: fakeBrowser({}), fetchFn: loginOk });
  expect(r).toMatchObject({ ran: false, pass: true });
});
test("fails open when the browser throws", async () => {
  const r = await runAuthSmokeTest({ ...BASE, browser: throwingBrowser(), fetchFn: loginOk });
  expect(r).toMatchObject({ ran: false, pass: true });
  expect(r.skippedReason).toContain("browser");
});
test("Stage 6 runs the smoke test with the cheap checks and still runs the full review when it passes", () => {
  const src = readFileSync(new URL("./stage6-deployment.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("async function runRealLiveRetest"));
  expect(fn.indexOf("runAuthSmokeTest(")).toBeLessThan(fn.indexOf("runStage5("));
  expect(fn).toContain('process.env.AUTH_SMOKE_TEST !== "off"');
});
```
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `auth-smoke.ts` per the rules above: page discovery =
  links on the landing page whose text matches /sign ?in|log ?in/ and
  /sign ?up|register|get started|create account/, falling back to `/sign-in`,
  `/login`, `/sign-up`, `/register`, accepted only if `input[type=password]`
  exists there. Every `browser.send` sits in one try/catch → `{ ran:false, pass:true, skippedReason }`.
  In `stage6-deployment.ts` `runRealLiveRetest`, after the stack-conformance
  check and before `runStage5`:
```typescript
if (process.env.AUTH_SMOKE_TEST !== "off" && plan) {
  const browser = new BrowserSession();
  try {
    const smoke = await runAuthSmokeTest({ appUrl, backendUrl, endpoints: plan.apiContract.endpoints, browser });
    console.log(`[stage6] Auth smoke test: ${smoke.ran ? (smoke.pass ? "passed" : "FAILED") : `skipped (${smoke.skippedReason})`}`);
    if (smoke.ran && !smoke.pass) {
      return { pass: false, findings: smoke.findings.map((issue) => ({ file: "frontend/app", issue: `[auth-smoke] ${issue}` })) };
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
```
  A failure returns findings to the existing fix loop (routed to the frontend
  fixer), which redeploys and runs the FULL retest again — Claim 10 unchanged.
- [ ] **Step 4: Run, verify PASS** + full suite + tsc (pipeline, agent-runtime).
- [ ] **Step 5: Live check** against Plantly (http://localhost:3207, backend :3308):
  expect `passed`. Then point it at a deliberately broken copy of the sign-in
  handler (router.push restored in a scratch build dir, never in a real project)
  and expect `FAILED` with the "still on the sign-in page" finding.
- [ ] **Step 6: Commit** — `feat(stage6): deterministic auth smoke test before the expensive review`

**Risk check:** fail-open on every non-definite outcome; kill switch
`AUTH_SMOKE_TEST=off`; test users use `@example.com` and live only in the
generated app's own database (same as Riya's existing verification user).

---

### Task 3: Page-composition guidance for Aanya (skill text only)

**Why guidance, not templates:** the design review's originality criterion
explicitly penalises "template layouts, library defaults". Drop-in section
templates could LOWER the score. Instead, composition rules that force a fuller,
subject-specific first draft. No runtime code changes.

**Files:** Modify `packages/agent-runtime/skills/aanya/00-identity-and-visual-doctrine.md`
(append to "Visual quality rules").

- [ ] **Step 1: Write the failing test** (skill-content test, same convention as existing skill tests)
```typescript
test("Aanya's visual doctrine requires a composed landing page and a session-aware header", () => {
  const doc = readFileSync(new URL("../skills/aanya/00-identity-and-visual-doctrine.md", import.meta.url), "utf-8");
  expect(doc).toContain("Landing page composition");
  expect(doc).toContain("Sign Out");
  expect(doc).toContain("Empty states");
});
```
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Add the section** (rules, not markup):
  - Landing page composition: a hero that shows the product (a real product
    preview built from the app's own components — not a stock image, not a
    gradient), at least three content sections beyond the hero, each with a
    distinct layout (not three identical cards), and a closing call to action.
  - Every section's copy, colours and imagery come from this app's subject.
  - Header: when signed in, show the app's main destinations and **Sign Out**;
    when signed out, Sign In / Get Started. Never both.
  - Empty states: an illustration or icon, one sentence, and the primary action as a button.
- [ ] **Step 4: Run, verify PASS** + full suite.
- [ ] **Step 5: Commit** — `docs(aanya-skill): page composition, session-aware header, empty states`

**Risk check:** text-only change; measured on the next build's design score
(Plantly's first draft scored 5.95). If a build scores lower, revert this commit.

---

### Task 4: Validation build (needs Amit's OK — costs money)

- [ ] Restart the worker on the final commit (no build running).
- [ ] Build one new small app with auth (Amit picks the prompt), Gemini + NIM as today.
- [ ] Record: total wall-clock time, rounds, NIM hand-overs, smoke-test outcomes,
  first-draft design score, real spend. Compare with Plantly (27 h, 5.95 first draft).

## Self-review

- Coverage: items 1 (smoke gate), 3 (NIM budget), 4 (design guidance) each map
  to a task; item 2 (Docker) dropped with evidence above.
- No placeholders; function names consistent: `nimTimeBudgetMs`,
  `timeBudgetExceeded`, `runAuthSmokeTest`, `AuthSmokeResult`.
- Loops untouched: no change to stage5-qa-fix-loop.ts retest logic, thresholds,
  stuck detection or context chain.
