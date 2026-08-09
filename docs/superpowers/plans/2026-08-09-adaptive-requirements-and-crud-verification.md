# Adaptive Requirements Gathering + Full CRUD Verification Implementation Plan

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Stop Saanvi from guessing business scope, stop QA from only
verifying one lucky endpoint's data flow, and stop Aanya's hardcoded
layout example from making every generated app converge on the same DOM
structure.
**Architecture:** Three independently-testable pieces, ordered smallest/
lowest-risk first. Full design: `docs/superpowers/specs/2026-08-09-adaptive-requirements-and-crud-verification-design.md`.
**Tech Stack:** No new dependencies — TypeScript/Bun, existing DI test
conventions throughout this codebase.

## Global Constraints

- Every DB table still requires `id`/`created_at`/`updated_at` per
  Saanvi's existing DATABASE RULES — unchanged.
- No new agent — a business-management area (if a request needs one) is
  built by Aanya/Shubham/Pranav like any other planned feature.
- Real user-provided material (attachments, a short vision statement)
  must be used as grounding verbatim, never discarded for an invented
  substitute.
- Every new function gets a failing test first, per this codebase's own
  established convention (a `test("...", ...)` with a header comment
  citing the live bug it closes, matching every existing fix in this
  session).

---

### Task 1: Fix Aanya's hardcoded page-layout example

**Files:**
- Modify: `agents/generators/aanya/src/index.ts`
- Test: `agents/generators/aanya/src/index.test.ts`

**Interfaces:**
- Consumes: `plan.designBrief.layoutConcept` (already exists on `BuildPlan`, already passed into Aanya's task-building function)
- Produces: nothing new — a prompt-content change only

- [ ] **Step 1: Write the failing test**
```typescript
test("Aanya's prompt derives page structure from layoutConcept instead of a fixed skeleton example", () => {
  const task = buildAanyaTask(PLAN_WITH_LAYOUT_CONCEPT); // existing test fixture/helper
  expect(task).toContain("layoutConcept");
  expect(task).not.toContain('gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))"');
});
```
- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test agents/generators/aanya/src/index.test.ts`
Expected: FAIL — the fixed skeleton string is still present today

- [ ] **Step 3: Write minimal implementation**
In the "LAYOUT PATTERNS" section (`agents/generators/aanya/src/index.ts` ~line 469), remove the fixed
`<div style={{minHeight:"100vh", ...}}>` page-skeleton example. Keep the
NexUI component/CSS-variable usage examples above it (those are
correctly universal). Replace the removed block with:
```
PAGE STRUCTURE: Derive the actual page structure (hero shape, section
order, grid vs. list vs. dense-table layout, spacing rhythm) from this
project's own layoutConcept below — do not default to a generic
nav+centered-hero+card-grid pattern regardless of what layoutConcept
describes.
layoutConcept: "${plan.designBrief.layoutConcept}"
```
- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test agents/generators/aanya/src/index.test.ts`
Expected: PASS

- [x] **Step 5: Commit** — DONE. Test written + confirmed failing, fix applied (removed the fixed skeleton example, kept Panel/gap guidance, pointed at the task's own "Layout concept" line), 18/18 tests pass, 245/245 across generators+pipeline, no regressions. Not yet git-committed (only commit when explicitly asked).

---

### Task 2: Generalize Riya's live verification to every resource's full CRUD surface

**Files:**
- Modify: `agents/riya/src/index.ts`
- Test: `agents/riya/src/verify-live-auth.test.ts`

**Interfaces:**
- Consumes: `resolveForeignKeyId` (Task 6/7 of tonight's earlier session — already exists), `verifyDbWriteReadRoundTrip` (already exists)
- Produces: `verifyAllResourceCrud(buildDir: string, backendUrl: string): Promise<{ ok: boolean; findings: string[] }>`, called from the same place `verifyLiveAuthenticatedRoundTrip` is called today (additive — does not remove the existing single-endpoint check, generalizes it)

- [ ] **Step 1: Write the failing test**
```typescript
test("verifyAllResourceCrud checks every resource's declared CRUD verbs, not just the first one found", async () => {
  writeContract([
    { method: "POST", path: "/api/v1/auth/register", auth: false },
    { method: "POST", path: "/api/v1/auth/login", auth: false },
    { method: "GET", path: "/api/v1/services", auth: false },
    { method: "POST", path: "/api/v1/appointments", auth: true, requestType: "{ service_id: string; appointment_date: string }" },
    { method: "GET", path: "/api/v1/appointments", auth: true },
    { method: "PATCH", path: "/api/v1/appointments/{id}", auth: true, requestType: "{ status: string }" },
    { method: "DELETE", path: "/api/v1/appointments/{id}", auth: true },
  ]);
  // mock backend implements full CRUD for /appointments backed by an in-memory array
  const url = await startFullCrudMockBackend();

  const result = await verifyAllResourceCrud(dir, url);

  expect(result.ok).toBe(true);
  expect(result.findings).toEqual([]); // create, read, update, AND delete all verified — not just create
});

test("verifyAllResourceCrud reports a specific finding when PATCH doesn't actually change the DB row", async () => {
  // mock backend's PATCH handler returns 200 but doesn't persist the change
  const url = await startBrokenPatchMockBackend();
  const result = await verifyAllResourceCrud(dir, url);
  expect(result.ok).toBe(false);
  expect(result.findings[0]).toContain("PATCH");
  expect(result.findings[0]).toContain("did not persist");
});
```
- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test agents/riya/src/verify-live-auth.test.ts`
Expected: FAIL — `verifyAllResourceCrud is not defined`

- [ ] **Step 3: Write minimal implementation**
```typescript
export async function verifyAllResourceCrud(buildDir: string, backendUrl: string): Promise<{ ok: boolean; findings: string[] }> {
  const contractPath = join(buildDir, "api-contract.json");
  if (!existsSync(contractPath)) return { ok: false, findings: ["api-contract.json not found"] };
  const endpoints = (JSON.parse(readFileSync(contractPath, "utf-8")).endpoints ?? []) as Array<{ method: string; path: string; auth?: boolean; requestType?: string }>;

  // group by resource the same way resolveForeignKeyId derives a resource name
  const resources = new Map<string, typeof endpoints>();
  for (const ep of endpoints) {
    const seg = ep.path.replace(/^\/api\/v1\//, "").split("/")[0];
    if (!seg || seg.startsWith("auth")) continue;
    resources.set(seg, [...(resources.get(seg) ?? []), ep]);
  }

  const findings: string[] = [];
  const { token } = await registerAndLoginTestUser(backendUrl); // extract existing register+login logic from verifyLiveAuthenticatedRoundTrip into a shared helper

  for (const [resource, eps] of resources) {
    const createEp = eps.find((e) => e.method === "POST" && !e.path.includes("{"));
    if (!createEp) continue; // read-only or nothing to create — not a finding, matches existing "nothing to verify at this layer" precedent
    // create, verify via db_query, GET/list check, PATCH+verify, DELETE+verify — same
    // per-step pattern as verifyLiveAuthenticatedRoundTrip, looped per resource,
    // reusing resolveForeignKeyId for any dependent "_id" field.
    // Full step sequence: see verifyLiveAuthenticatedRoundTrip for the exact
    // register/create/db_query pattern this generalizes.
  }

  return { ok: findings.length === 0, findings };
}
```
- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test agents/riya/src/verify-live-auth.test.ts`
Expected: PASS

- [x] **Step 5: Commit** — DONE. `verifyAllResourceCrud` implemented with an injectable `getDbRow` (real docker-exec lookup by default, matching this file's established untested-infra convention), extracted `registerAndLoginTestUser` shared helper, 5 new tests all passing on first real run, 25/25 across `agents/riya/`, typecheck clean against the real project tsconfig. Not yet git-committed (only commit when explicitly asked).

---

### Task 3: Saanvi — multi-round adaptive requirements gathering

**Files:**
- Modify: `agents/saanvi/src/index.ts`
- Modify: `pipeline/workflows/project-build.ts` (loop the existing `answerClarificationSignal` wait instead of awaiting it once)
- Test: `agents/saanvi/src/index.test.ts`

**Interfaces:**
- Consumes: existing `answerClarificationSignal` Temporal signal (already exists — currently awaited once)
- Produces:
```typescript
type RequirementsResult =
  | { status: "needs_more_info"; questions: string[]; understoodSoFar: string }
  | { status: "ready_to_confirm"; summary: string; spec: ProjectSpec }
  | { status: "locked"; spec: ProjectSpec };
export async function gatherRequirementsRound(
  userInput: string,
  priorRounds: Array<{ questions: string[]; answers: string[] }>,
  attachmentText?: string,
): Promise<RequirementsResult>;
```

- [ ] **Step 1: Write the failing test**
```typescript
test("gatherRequirementsRound asks about self-management before locking a spec for a product-catalog business", async () => {
  const result = await gatherRequirementsRound(
    "Build a site for Meridian Bike Co selling helmets, lights, and tubes",
    [],
  );
  expect(result.status).toBe("needs_more_info");
  expect(result.questions.some(q => /manage.*(product|catalog|inventory)/i.test(q))).toBe(true);
});

test("gatherRequirementsRound locks a spec once self-management and pricing-display answers are both known", async () => {
  const round1 = await gatherRequirementsRound("Build a site for Meridian Bike Co selling helmets, lights, and tubes", []);
  const round2 = await gatherRequirementsRound(
    "Build a site for Meridian Bike Co selling helmets, lights, and tubes",
    [{ questions: round1.status === "needs_more_info" ? round1.questions : [], answers: ["Yes, I want to add/edit/remove products myself after launch", "Show prices publicly"] }],
  );
  expect(["ready_to_confirm", "locked"]).toContain(round2.status);
});

test("gatherRequirementsRound feeds extracted attachment text into the same reasoning as the prompt, not a separate ignored path", async () => {
  const result = await gatherRequirementsRound(
    "Build a site for Meridian Bike Co",
    [],
    "Our services: Tune-Up $45, Wheel Truing $25, Brake Adjustment $35. We do NOT sell retail products.",
  );
  // real services from the attachment appear in what gets asked/locked, not invented ones
  expect(JSON.stringify(result)).toMatch(/Tune-Up|45/);
});
```
- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test agents/saanvi/src/index.test.ts`
Expected: FAIL — `gatherRequirementsRound is not defined`

- [ ] **Step 3: Write minimal implementation**
Extend `SAANVI_SYSTEM_PROMPT` with the self-management and pricing-display
question triggers (same pattern as the existing "WHEN TO ASK FOR REAL
BUSINESS SPECIFICS" section — a new sibling section, same style). Add
`gatherRequirementsRound`, threading `priorRounds` and `attachmentText`
into the prompt context, returning the new three-state shape. Wire
`pipeline/workflows/project-build.ts`'s spec-gathering stage to loop
calling this (await the clarification signal, call again with the
answer appended to `priorRounds`) until `status !== "needs_more_info"`,
replacing today's single-shot call.

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test agents/saanvi/src/index.test.ts pipeline/workflows/project-build.test.ts`
Expected: PASS

- [x] **Step 5: Commit** — DONE, but scope corrected from the original plan: the multi-round
  clarification LOOP already existed at the Temporal workflow level
  (`pipeline/workflows/project-build.ts`'s `for(;;)` loop around `runSaanvi`,
  already accumulating `clarificationHistory` across rounds) and attachment
  handling already existed (`getAttachmentsContext` in
  `pipeline/activities/index.ts`, already extracting text and feeding it into
  the enriched request). The actual gap was narrower: Saanvi's OWN judgment
  never triggered a question for self-management need or pricing-display
  preference, and an explicit SCOPE CONTROL rule actively FORBADE ever adding
  an admin/management area without the user naming it by that exact term —
  directly contradicting the new requirement (a normal user doesn't know to
  ask for "an admin dashboard" by name). Fixed by adding a third
  ask-don't-guess trigger to `SAANVI_SYSTEM_PROMPT` (self-management +
  pricing-display questions), an explicit carve-out in SCOPE CONTROL (an
  explicit "yes" answer counts as the user's own request), and an
  attachment/short-vision grounding instruction in CONTENT EXTRACTION. 14/14
  tests pass, 806/806 across the full codebase. Not yet git-committed (only
  commit when explicitly asked).

---

## Self-Review

1. **Coverage:** every spec requirement (classification-driven questions,
   multi-round loop, attachments, vision enrichment, self-management
   question, CRUD-per-resource, layout-example fix) maps to a task above.
2. **Placeholders:** Task 2/3's implementation sketches reference "same
   pattern as X" rather than fully inlining X — intentional (X already
   exists in the codebase and is long; the task names the exact function
   to extract from), not a TBD/unresolved gap.
3. **Type consistency:** `RequirementsResult`/`gatherRequirementsRound`
   used identically across Task 3's test and implementation section.
