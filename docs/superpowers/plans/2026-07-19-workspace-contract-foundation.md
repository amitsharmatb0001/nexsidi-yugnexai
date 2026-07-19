# Workspace Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile chat-to-prose-to-build path with an authenticated, durable, idempotent workspace contract that executes the exact approved specification and exposes only safe public activity.

**Architecture:** Introduce a browser-safe workspace contract package, persist workspace messages/specifications/build runs/events in PostgreSQL, and put a Hono application service between HTTP routes and storage. The planner may propose content, but application code owns phases, versioning, approval, idempotency, ownership, and the immutable Temporal build input. The current build UI consumes a durable snapshot and upserts messages/events by stable ID; later plans can replace its visual shell without changing this contract.

**Tech Stack:** Bun 1.x, TypeScript 5.7+, Hono 4.7+, PostgreSQL 16, Drizzle ORM 0.40+, Temporal 1.11+, Next.js 16.2, React 19, `bun:test`

## Global Constraints

- Work only in `E:\ai yug\.claude\worktrees\eager-varahamihira-967edb`.
- Preserve unrelated modified and untracked files; stage only files listed by the active task.
- Write every failing test before its implementation.
- Keep Next.js at `16.2.0`; do not introduce Next.js 14/15.
- Keep the platform API on Bun + Hono and PostgreSQL 16.
- The visible identity is `Planner`; never emit internal identities, counts, prompts, model/provider routing, or hidden architecture.
- A project ID is never authorization. Every workspace-scoped route must verify the authenticated owner.
- Chat, artifacts, plans, events, previews, and build status are not public routes.
- Accept must approve an exact specification ID, version, and SHA-256 hash; no `"build it"` chat message may trigger execution.
- Every POST transition requires an idempotency key.
- No raw command, log, token, secret, absolute host path, or unfiltered runtime event may reach the public browser.
- Generated/temp/audit files under `C:\tmp`, `scratch/`, `attempt_*.md`, and review-note files are never staged.
- Do not push any task commit until the entire first-slice verification task passes.

---

## File Structure

### New shared package

- `packages/workspace-contract/package.json` - package exports and scripts.
- `packages/workspace-contract/tsconfig.json` - TypeScript configuration.
- `packages/workspace-contract/src/types.ts` - browser-safe workspace, message, spec, run, and event types.
- `packages/workspace-contract/src/spec.ts` - canonicalization, hashing, and approval validation.
- `packages/workspace-contract/src/state-machine.ts` - allowed workspace transitions.
- `packages/workspace-contract/src/public-events.ts` - deny-by-default internal-to-public event translation.
- `packages/workspace-contract/src/*.test.ts` - contract tests.

### Database

- `packages/db/src/schema.ts` - Drizzle tables for messages, turns, specs, runs, and events.
- `packages/db/src/migrations/0002_workspace_contract.sql` - idempotent PostgreSQL migration.
- `packages/db/src/workspace-schema.test.ts` - source-level schema regression test.

### API application layer

- `apps/api/src/workspaces/store.ts` - persistence interface.
- `apps/api/src/workspaces/postgres-store.ts` - Drizzle implementation.
- `apps/api/src/workspaces/memory-store.ts` - deterministic test implementation.
- `apps/api/src/workspaces/service.ts` - ownership, idempotency, spec, approval, and build-run rules.
- `apps/api/src/workspaces/service.test.ts` - application-service tests.
- `apps/api/src/middleware/workspace-owner.ts` - reusable ownership middleware.
- `apps/api/src/routes/workspaces.ts` - create/snapshot/message/spec/approval/event routes.
- `apps/api/src/routes/workspaces.test.ts` - Hono route contract tests.

### Planner and build handoff

- `agents/planner/src/types.ts` - use shared message/spec types.
- `agents/planner/src/index.ts` - propose one question or one draft spec; never trigger builds.
- `agents/planner/src/planner-policy.ts` - question de-duplication and phase decision helpers.
- `agents/planner/src/planner-policy.test.ts` - deterministic policy tests.
- `apps/api/src/utils/temporal.ts` - start a workflow from `ApprovedBuildInput`.
- `pipeline/contracts/approved-build.ts` - validate and materialize the immutable approved spec.
- `pipeline/contracts/approved-build.test.ts` - hash and adapter tests.
- `pipeline/workflows/project-build.ts` - accept a single immutable build input and skip requirement regeneration.
- `pipeline/workflows/approved-input.test.ts` - workflow source/contract regression tests.

### Security boundary

- `apps/api/src/app.ts` - remove public workspace exceptions and mount new protected routes.
- `apps/api/src/routes/artifacts.ts` - mandatory ownership; injected access check for tests.
- `apps/api/src/routes/artifacts.test.ts` - cross-workspace access tests.
- `apps/api/src/routes/pipeline.ts` - mandatory ownership for result/status/approval.
- `apps/api/src/routes/ws.ts` - remove public pipeline/log/screenshot streams from the user surface.

### Web client

- `apps/web/lib/workspace-api.ts` - authenticated API and SSE parser.
- `apps/web/lib/workspace-chat.ts` - pure bootstrap/upsert reducer and deterministic initial-message ID.
- `apps/web/lib/workspace-chat.test.ts` - duplicate/race regression tests.
- `apps/web/app/dashboard/page.tsx` - create a server workspace before navigation.
- `apps/web/app/build/[id]/page.tsx` - load one snapshot, submit initial prompt only afterward, render persisted draft spec, and call approval endpoint.

### Generator scope lock and verification

- `agents/generators/aanya/src/prompt.ts` - frontend prompt built only from confirmed scope.
- `agents/generators/aanya/src/prompt.test.ts` - no unapproved auth/page generation.
- `agents/generators/shubham/src/prompt.ts` - backend prompt built only from confirmed APIs/auth.
- `agents/generators/shubham/src/prompt.test.ts` - no unconditional JWT/user endpoints.
- `agents/generators/aanya/src/index.ts` - use prompt builder.
- `agents/generators/shubham/src/index.ts` - use prompt builder.
- `apps/api/src/workspaces/nextech-regression.test.ts` - complete first-slice contract reproduction.
- `docs/verification/workspace-contract-foundation.md` - commands and recorded evidence.

---

### Task 1: Shared Workspace Contract

**Files:**
- Create: `packages/workspace-contract/package.json`
- Create: `packages/workspace-contract/tsconfig.json`
- Create: `packages/workspace-contract/src/types.ts`
- Create: `packages/workspace-contract/src/spec.ts`
- Create: `packages/workspace-contract/src/state-machine.ts`
- Create: `packages/workspace-contract/src/public-events.ts`
- Test: `packages/workspace-contract/src/spec.test.ts`
- Test: `packages/workspace-contract/src/state-machine.test.ts`
- Test: `packages/workspace-contract/src/public-events.test.ts`

**Interfaces:**
- Produces: `WorkspaceSpec`, `WorkspaceSnapshot`, `ApprovedBuildInput`, `computeSpecHash()`, `assertApprovedSpec()`, `transitionWorkspace()`, and `toPublicActivityEvent()`.
- Consumes: only Node/Bun built-ins; `types.ts` must remain browser-safe.

- [ ] **Step 1: Write failing contract tests**

```typescript
// packages/workspace-contract/src/spec.test.ts
import { expect, test } from "bun:test";
import { assertApprovedSpec, computeSpecHash } from "./spec.ts";
import type { WorkspaceSpec } from "./types.ts";

const draft = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "abc123def456",
  version: 1,
  status: "draft",
  originalRequest: "Build Nextech",
  confirmedFacts: [], questions: [], assumptions: [], scope: [],
  userJourneys: [], pages: [], dataModel: [], apiContracts: [],
  auth: { mode: "none", roles: [] },
  design: { direction: "deep black and warm gold" },
  sources: [], acceptanceCriteria: [],
} satisfies Omit<WorkspaceSpec, "hash" | "createdAt">;

test("hashes canonical spec content deterministically", () => {
  expect(computeSpecHash(draft)).toBe(computeSpecHash({ ...draft }));
  expect(computeSpecHash(draft)).toMatch(/^[a-f0-9]{64}$/);
});

test("rejects an approved record whose hash no longer matches", () => {
  const spec = { ...draft, status: "approved", hash: "0".repeat(64), createdAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: "user-1" } as WorkspaceSpec;
  expect(() => assertApprovedSpec(spec)).toThrow("approved_spec_hash_mismatch");
});
```

```typescript
// packages/workspace-contract/src/state-machine.test.ts
import { expect, test } from "bun:test";
import { transitionWorkspace } from "./state-machine.ts";

test("allows plan approval but rejects a direct intake-to-building jump", () => {
  expect(transitionWorkspace("plan_ready", "approved")).toBe("approved");
  expect(() => transitionWorkspace("intake", "building")).toThrow("invalid_workspace_transition");
});
```

```typescript
// packages/workspace-contract/src/public-events.test.ts
import { expect, test } from "bun:test";
import { toPublicActivityEvent } from "./public-events.ts";

test("translates an internal tool event without copying raw details", () => {
  const event = toPublicActivityEvent({
    id: "event-1", workspaceId: "abc123def456", runId: "run-1",
    type: "command_started", internalDetail: "Bearer secret-token private-worker C:\\Users\\owner",
    createdAt: "2026-07-19T00:00:00.000Z",
  });
  expect(event).toEqual({
    id: "event-1", workspaceId: "abc123def456", runId: "run-1",
    category: "command", status: "running", summary: "Running a workspace command",
    createdAt: "2026-07-19T00:00:00.000Z",
  });
  expect(JSON.stringify(event)).not.toContain("secret-token");
  expect(JSON.stringify(event)).not.toContain("private-worker");
});

test("denies unknown internal event types", () => {
  expect(toPublicActivityEvent({ id: "x", workspaceId: "w", runId: null, type: "raw_log", internalDetail: "x", createdAt: "now" })).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify the package is missing**

Run: `bun test packages/workspace-contract/src/*.test.ts`

Expected: FAIL because the package modules do not exist.

- [ ] **Step 3: Implement the browser-safe types**

```typescript
// packages/workspace-contract/src/types.ts
export type WorkspacePhase = "intake" | "clarifying" | "plan_ready" | "approved" | "building" | "verifying" | "blocked" | "delivered" | "cancelled";
export type ScopeState = "confirmed" | "suggested" | "deferred" | "rejected";

export interface WorkspaceMessage { id: string; workspaceId: string; role: "user" | "assistant"; content: string; clientMessageId: string; createdAt: string; }
export interface RequirementQuestion { id: string; key: string; question: string; rationale: string; options: Array<{ label: string; value: string }>; recommendedValue?: string; answer?: string; answeredAt?: string; }
export interface ConfirmedFact { id: string; key: string; value: string; source: "user" | "source" | "inference"; }
export interface Assumption { id: string; key: string; value: string; status: "proposed" | "approved" | "rejected"; }
export interface ScopeItem { id: string; key: string; title: string; description: string; state: ScopeState; }
export interface PageSpec { id: string; name: string; path: string; description: string; access: "public" | "authenticated"; requirementIds: string[]; }
export interface EntitySpec { id: string; name: string; fields: Array<{ name: string; type: string; required: boolean }>; requirementIds: string[]; }
export interface ApiContract { id: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; description: string; authenticated: boolean; requirementIds: string[]; }
export interface WorkspaceSpec {
  id: string; workspaceId: string; version: number; hash: string; status: "draft" | "approved" | "superseded";
  originalRequest: string; confirmedFacts: ConfirmedFact[]; questions: RequirementQuestion[]; assumptions: Assumption[]; scope: ScopeItem[];
  userJourneys: Array<{ id: string; title: string; steps: string[]; requirementIds: string[] }>;
  pages: PageSpec[]; dataModel: EntitySpec[]; apiContracts: ApiContract[];
  auth: { mode: "none" | "session"; roles: string[] };
  design: { direction: string; colors?: string[]; references?: string[] };
  sources: Array<{ id: string; name: string; kind: "text" | "file" | "url" | "api"; citation: string }>;
  acceptanceCriteria: Array<{ id: string; statement: string; requirementIds: string[] }>;
  createdAt: string; approvedAt?: string; approvedBy?: string;
}
export interface WorkspaceSnapshot { id: string; ownerId: string; name: string; phase: WorkspacePhase; messages: WorkspaceMessage[]; activeSpec: WorkspaceSpec | null; activeRun: { id: string; status: string; specHash: string } | null; eventCursor: number; }
export interface ApprovedBuildInput { runId: string; workspaceId: string; specId: string; specVersion: number; specHash: string; spec: WorkspaceSpec; }
export interface PublicActivityEvent { id: string; workspaceId: string; runId: string | null; category: "planning" | "subtask" | "file" | "command" | "test" | "preview" | "repair" | "approval" | "delivery"; status: "queued" | "running" | "passed" | "failed" | "blocked"; summary: string; safePath?: string; elapsedMs?: number; evidenceId?: string; createdAt: string; }
```

- [ ] **Step 4: Implement canonical hashing, transitions, and event translation**

```typescript
// packages/workspace-contract/src/spec.ts
import { createHash } from "crypto";
import type { WorkspaceSpec } from "./types.ts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  const metadata = new Set(["hash", "status", "createdAt", "approvedAt", "approvedBy"]);
  return `{${Object.keys(record).filter((key) => !metadata.has(key)).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
export function computeSpecHash(spec: Omit<WorkspaceSpec, "hash"> | Omit<WorkspaceSpec, "hash" | "createdAt">): string { return createHash("sha256").update(canonical(spec)).digest("hex"); }
export function assertApprovedSpec(spec: WorkspaceSpec): void {
  if (spec.status !== "approved" || !spec.approvedAt || !spec.approvedBy) throw new Error("spec_not_approved");
  if (computeSpecHash(spec) !== spec.hash) throw new Error("approved_spec_hash_mismatch");
}
```

```typescript
// packages/workspace-contract/src/state-machine.ts
import type { WorkspacePhase } from "./types.ts";
const ALLOWED: Record<WorkspacePhase, WorkspacePhase[]> = {
  intake: ["clarifying", "plan_ready", "cancelled"], clarifying: ["clarifying", "plan_ready", "cancelled"],
  plan_ready: ["clarifying", "approved", "cancelled"], approved: ["building", "cancelled"],
  building: ["verifying", "blocked", "cancelled"], verifying: ["building", "blocked", "delivered", "cancelled"],
  blocked: ["building", "verifying", "cancelled"], delivered: [], cancelled: [],
};
export function transitionWorkspace(from: WorkspacePhase, to: WorkspacePhase): WorkspacePhase {
  if (!ALLOWED[from].includes(to)) throw new Error(`invalid_workspace_transition:${from}:${to}`);
  return to;
}
```

```typescript
// packages/workspace-contract/src/public-events.ts
import type { PublicActivityEvent } from "./types.ts";
export interface InternalActivityEvent { id: string; workspaceId: string; runId: string | null; type: string; internalDetail?: string; safePath?: string; elapsedMs?: number; evidenceId?: string; createdAt: string; }
const PUBLIC: Record<string, Pick<PublicActivityEvent, "category" | "status" | "summary">> = {
  planning_started: { category: "planning", status: "running", summary: "Preparing the build specification" },
  subtask_started: { category: "subtask", status: "running", summary: "Working on an implementation subtask" },
  file_written: { category: "file", status: "passed", summary: "Updated a workspace file" },
  command_started: { category: "command", status: "running", summary: "Running a workspace command" },
  test_passed: { category: "test", status: "passed", summary: "Test passed" },
  test_failed: { category: "test", status: "failed", summary: "Test failed" },
  repair_started: { category: "repair", status: "running", summary: "Repairing a verified failure" },
  preview_ready: { category: "preview", status: "passed", summary: "Preview is ready" },
  delivery_ready: { category: "delivery", status: "passed", summary: "Delivery package is ready" },
};
export function toPublicActivityEvent(input: InternalActivityEvent): PublicActivityEvent | null {
  const safe = PUBLIC[input.type];
  if (!safe) return null;
  return { id: input.id, workspaceId: input.workspaceId, runId: input.runId, ...safe, ...(input.safePath ? { safePath: input.safePath.replaceAll("\\", "/").replace(/^.*?\/workspace\//, "") } : {}), ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}), ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}), createdAt: input.createdAt };
}
```

- [ ] **Step 5: Add package configuration and run tests**

```json
// packages/workspace-contract/package.json
{"name":"@nexsidi/workspace-contract","version":"0.1.0","private":true,"type":"module","exports":{"./types":"./src/types.ts","./spec":"./src/spec.ts","./state-machine":"./src/state-machine.ts","./public-events":"./src/public-events.ts"},"scripts":{"typecheck":"tsc --noEmit"},"devDependencies":{"@types/bun":"^1.3.0","typescript":"^5.7.0"}}
```

```json
// packages/workspace-contract/tsconfig.json
{"extends":"../../tsconfig.bun.json","compilerOptions":{"rootDir":"src"},"include":["src"]}
```

Run: `bun test packages/workspace-contract/src/*.test.ts && bun --cwd packages/workspace-contract run typecheck`

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```powershell
git add packages/workspace-contract
git commit -m "feat(workspace): add durable contract primitives"
```

---

### Task 2: Durable PostgreSQL Workspace Records

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/0002_workspace_contract.sql`
- Create: `packages/db/src/workspace-schema.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `pipeline/package.json`
- Modify: `agents/planner/package.json`

**Interfaces:**
- Consumes: shared types from Task 1.
- Produces: `workspaceMessages`, `workspaceTurns`, `workspaceSpecs`, `buildRuns`, and `workspaceEvents` Drizzle tables.

- [ ] **Step 1: Write the failing schema test**

```typescript
import { expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { buildRuns, workspaceEvents, workspaceMessages, workspaceSpecs, workspaceTurns } from "./schema.ts";

test("exports every durable workspace table", () => {
  expect([workspaceMessages, workspaceTurns, workspaceSpecs, buildRuns, workspaceEvents].map(getTableName)).toEqual([
    "workspace_messages", "workspace_turns", "workspace_specs", "build_runs", "workspace_events",
  ]);
});
```

- [ ] **Step 2: Run the test and verify missing exports**

Run: `bun test packages/db/src/workspace-schema.test.ts`

Expected: FAIL because the five tables are not exported.

- [ ] **Step 3: Add the Drizzle schema**

Add `bigserial` and `uniqueIndex` to the `drizzle-orm/pg-core` imports, then append definitions matching this SQL exactly:

```sql
CREATE TABLE IF NOT EXISTS workspace_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL, client_message_id varchar(96) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, client_message_id)
);
CREATE TABLE IF NOT EXISTS workspace_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key varchar(96) NOT NULL, status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  user_message_id uuid NOT NULL REFERENCES workspace_messages(id), assistant_message_id uuid REFERENCES workspace_messages(id),
  error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS workspace_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL, hash char(64) NOT NULL, status text NOT NULL CHECK (status IN ('draft','approved','superseded')),
  body jsonb NOT NULL, approved_at timestamptz, approved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_one_approved_spec ON workspace_specs(workspace_id) WHERE status = 'approved';
CREATE TABLE IF NOT EXISTS build_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spec_id uuid NOT NULL REFERENCES workspace_specs(id), spec_version integer NOT NULL, spec_hash char(64) NOT NULL,
  idempotency_key varchar(96) NOT NULL, workflow_id text, status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS workspace_events (
  cursor bigserial PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id uuid REFERENCES build_runs(id), category text NOT NULL, status text NOT NULL, summary text NOT NULL,
  safe_path text, elapsed_ms integer, evidence_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id)
);
CREATE INDEX IF NOT EXISTS workspace_events_resume_idx ON workspace_events(workspace_id, cursor);
```

Implement equivalent Drizzle definitions with the same names, constraints, and indexes. Add `@nexsidi/workspace-contract: workspace:*` to the four consuming package dependency maps.

- [ ] **Step 4: Run unit and migration verification**

Run:

```powershell
bun test packages/db/src/workspace-schema.test.ts
$env:DATABASE_URL='postgres://nexsidi:nexsidi_dev@localhost:5434/nexsidi'; bun run db:migrate
docker compose -f docker-compose.dev.yml exec -T postgres psql -U nexsidi -d nexsidi -c "select table_name from information_schema.tables where table_name in ('workspace_messages','workspace_turns','workspace_specs','build_runs','workspace_events') order by table_name;"
```

Expected: test PASS; migration reports `0002_workspace_contract.sql applied successfully`; query returns five rows.

- [ ] **Step 5: Commit**

```powershell
git add packages/db apps/api/package.json apps/web/package.json pipeline/package.json agents/planner/package.json bun.lock
git commit -m "feat(db): persist workspace planning and build state"
```

---

### Task 3: Workspace Service, Ownership, and Idempotent Turns

**Files:**
- Create: `apps/api/src/workspaces/store.ts`
- Create: `apps/api/src/workspaces/memory-store.ts`
- Create: `apps/api/src/workspaces/postgres-store.ts`
- Create: `apps/api/src/workspaces/service.ts`
- Test: `apps/api/src/workspaces/service.test.ts`

**Interfaces:**
- Consumes: database tables from Task 2 and shared contract types from Task 1.
- Produces: `WorkspaceService.createWorkspace()`, `snapshot()`, `beginTurn()`, `completeTurn()`, `saveDraftSpec()`, `approveSpecAndCreateRun()`, and `listEvents()`.

- [ ] **Step 1: Write failing service tests**

```typescript
import { expect, test } from "bun:test";
import { MemoryWorkspaceStore } from "./memory-store.ts";
import { WorkspaceService } from "./service.ts";

test("returns the same turn for a repeated idempotency key", async () => {
  const store = new MemoryWorkspaceStore();
  const service = new WorkspaceService(store);
  const workspace = await service.createWorkspace("user-1", "Nextech");
  const first = await service.beginTurn("user-1", workspace.id, "turn-1", "message-1", "Build Nextech");
  const replay = await service.beginTurn("user-1", workspace.id, "turn-1", "message-1", "Build Nextech");
  expect(replay.kind).toBe("replay");
  expect(replay.turn.id).toBe(first.turn.id);
});

test("does not allow another owner to read a workspace", async () => {
  const service = new WorkspaceService(new MemoryWorkspaceStore());
  const workspace = await service.createWorkspace("user-1", "Private");
  await expect(service.snapshot("user-2", workspace.id)).rejects.toThrow("workspace_not_found");
});
```

- [ ] **Step 2: Run tests and verify missing service**

Run: `bun test apps/api/src/workspaces/service.test.ts`

Expected: FAIL because the store/service modules do not exist.

- [ ] **Step 3: Define the persistence interface and application rules**

```typescript
// apps/api/src/workspaces/store.ts
import type { PublicActivityEvent, WorkspaceMessage, WorkspaceSnapshot, WorkspaceSpec } from "@nexsidi/workspace-contract/types";
export interface StoredTurn { id: string; workspaceId: string; idempotencyKey: string; status: "processing" | "completed" | "failed"; userMessage: WorkspaceMessage; assistantMessage: WorkspaceMessage | null; errorCode: string | null; }
export interface WorkspaceStore {
  createWorkspace(ownerId: string, id: string, name: string): Promise<WorkspaceSnapshot>;
  getSnapshot(workspaceId: string): Promise<WorkspaceSnapshot | null>;
  getTurn(workspaceId: string, idempotencyKey: string): Promise<StoredTurn | null>;
  insertTurn(workspaceId: string, idempotencyKey: string, clientMessageId: string, content: string): Promise<StoredTurn>;
  completeTurn(turnId: string, assistantClientMessageId: string, content: string): Promise<StoredTurn>;
  failTurn(turnId: string, errorCode: string): Promise<void>;
  insertDraftSpec(workspaceId: string, spec: WorkspaceSpec): Promise<WorkspaceSpec>;
  approveSpecAndInsertRun(workspaceId: string, specId: string, userId: string, expectedHash: string, idempotencyKey: string): Promise<{ spec: WorkspaceSpec; runId: string; replay: boolean }>;
  listEvents(workspaceId: string, after: number): Promise<{ events: PublicActivityEvent[]; cursor: number }>;
}
```

Implement `MemoryWorkspaceStore` with Maps and `PostgresWorkspaceStore` with Drizzle transactions. `insertTurn` and `approveSpecAndInsertRun` must use the database unique constraints and read back the existing row on conflict. The approval transaction must read the draft spec, compare `expectedHash` before changing status, mark any previous approved version `superseded`, approve exactly the selected version, and insert/replay the build run atomically.

```typescript
// apps/api/src/workspaces/service.ts
import { randomUUID } from "crypto";
import { assertApprovedSpec, computeSpecHash } from "@nexsidi/workspace-contract/spec";
import type { WorkspaceSpec } from "@nexsidi/workspace-contract/types";
import type { WorkspaceStore } from "./store.ts";
export class WorkspaceService {
  constructor(private readonly store: WorkspaceStore) {}
  async createWorkspace(ownerId: string, name: string) { return this.store.createWorkspace(ownerId, randomUUID().replaceAll("-", "").slice(0, 12), name.trim() || "New Project"); }
  async snapshot(userId: string, workspaceId: string) { const snapshot = await this.store.getSnapshot(workspaceId); if (!snapshot || snapshot.ownerId !== userId) throw new Error("workspace_not_found"); return snapshot; }
  async beginTurn(userId: string, workspaceId: string, idempotencyKey: string, clientMessageId: string, content: string) {
    await this.snapshot(userId, workspaceId);
    const existing = await this.store.getTurn(workspaceId, idempotencyKey);
    if (existing) return { kind: "replay" as const, turn: existing };
    return { kind: "created" as const, turn: await this.store.insertTurn(workspaceId, idempotencyKey, clientMessageId, content.trim()) };
  }
  completeTurn(turnId: string, assistantClientMessageId: string, content: string) { return this.store.completeTurn(turnId, assistantClientMessageId, content.trim()); }
  failTurn(turnId: string, errorCode: string) { return this.store.failTurn(turnId, errorCode); }
  async saveDraftSpec(userId: string, workspaceId: string, input: Omit<WorkspaceSpec, "hash" | "createdAt">) {
    await this.snapshot(userId, workspaceId); const createdAt = new Date().toISOString();
    const spec = { ...input, status: "draft" as const, createdAt, hash: computeSpecHash(input) };
    return this.store.insertDraftSpec(workspaceId, spec);
  }
  async approveSpecAndCreateRun(userId: string, workspaceId: string, specId: string, expectedHash: string, idempotencyKey: string) {
    await this.snapshot(userId, workspaceId);
    const result = await this.store.approveSpecAndInsertRun(workspaceId, specId, userId, expectedHash, idempotencyKey);
    assertApprovedSpec(result.spec); return result;
  }
  async listEvents(userId: string, workspaceId: string, after: number) { await this.snapshot(userId, workspaceId); return this.store.listEvents(workspaceId, after); }
}
```

- [ ] **Step 4: Run service tests and typecheck**

Run: `bun test apps/api/src/workspaces/service.test.ts && bun --cwd apps/api run typecheck`

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/workspaces
git commit -m "feat(api): add owned idempotent workspace service"
```

---

### Task 4: Protected Workspace HTTP Contract

**Files:**
- Create: `apps/api/src/routes/workspaces.ts`
- Create: `apps/api/src/routes/workspaces.test.ts`
- Create: `apps/api/src/middleware/workspace-owner.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/chat.ts`

**Interfaces:**
- Consumes: `WorkspaceService` from Task 3 and existing authenticated `c.var.userId`.
- Produces: `POST /api/workspaces`, `GET /api/workspaces/:id`, `POST /api/workspaces/:id/messages`, `POST /api/workspaces/:id/specs/:specId/approve`, and `GET /api/workspaces/:id/events`.

- [ ] **Step 1: Write failing route tests**

Use `createWorkspaceRouter(service, planner, startBuild)` dependency injection. Tests must assert:

```typescript
test("workspace routes reject requests without auth", async () => {
  const response = await app.request("/api/workspaces/abc123def456");
  expect(response.status).toBe(401);
});

test("a second user receives 404, not another workspace snapshot", async () => {
  const response = await app.request("/api/workspaces/abc123def456", { headers: { "x-test-user": "user-2" } });
  expect(response.status).toBe(404);
});

test("message POST requires an idempotency key", async () => {
  const response = await ownerApp.request("/api/workspaces/abc123def456/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientMessageId: "m1", content: "hello" }) });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "idempotency_key_required" });
});
```

- [ ] **Step 2: Run tests and verify missing router**

Run: `bun test apps/api/src/routes/workspaces.test.ts`

Expected: FAIL because `createWorkspaceRouter` does not exist.

- [ ] **Step 3: Implement the router and remove public chat behavior**

Route rules:

- `POST /api/workspaces` validates `{ name: string }` and returns `201` snapshot.
- `GET /api/workspaces/:id` returns the durable snapshot.
- `POST /messages` validates `Idempotency-Key`, `clientMessageId`, and `content`; completed replays emit the stored assistant message rather than calling the planner.
- New planner output persists one assistant message and, when present, one draft spec before emitting `assistant_message`, `spec_ready`, and `done` SSE events.
- Failed planner calls mark the turn failed and emit `{type:"error",code:"planner_unavailable"}` without deleting the user message.
- `/api/chat` returns `410 { error: "workspace_chat_moved" }` after the web client migrates in Task 9.

Replace the exception list in `apps/api/src/app.ts` with:

```typescript
app.route("/health", healthRouter);
app.route("/webhooks", webhooksRouter);
app.route("/api/auth", authRouter);
app.use("/api/*", authMiddleware);
app.route("/api/workspaces", workspacesRouter);
app.route("/api/pipeline", pipelineRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/artifacts", artifactsRouter);
app.route("/api/attachments", attachmentsRouter);
```

Do not trust `x-user-id`; use only the authenticated middleware value.

- [ ] **Step 4: Run route and auth tests**

Run: `bun test apps/api/src/routes/workspaces.test.ts apps/api/src/routes/auth.test.ts apps/api/src/auth/session.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/app.ts apps/api/src/routes/chat.ts apps/api/src/routes/workspaces.ts apps/api/src/routes/workspaces.test.ts apps/api/src/middleware/workspace-owner.ts
git commit -m "feat(api): expose protected durable workspace routes"
```

---

### Task 5: Deterministic Planner Policy and Durable Draft Specs

**Files:**
- Create: `agents/planner/src/planner-policy.ts`
- Test: `agents/planner/src/planner-policy.test.ts`
- Modify: `agents/planner/src/types.ts`
- Modify: `agents/planner/src/index.ts`
- Modify: `agents/planner/src/session.ts`

**Interfaces:**
- Consumes: workspace message history and current draft spec.
- Produces: `PlannerTurnResult = { kind: "question"; message: string; question: RequirementQuestion } | { kind: "spec"; message: string; spec: Omit<WorkspaceSpec,"hash"|"createdAt"> }`.

- [ ] **Step 1: Write failing policy tests**

```typescript
import { expect, test } from "bun:test";
import { acceptPlannerDecision } from "./planner-policy.ts";

test("rejects a question whose key was already answered", () => {
  const result = acceptPlannerDecision({ answeredKeys: new Set(["auth-purpose"]), phase: "clarifying" }, { kind: "question", message: "Who signs in?", question: { id: "q2", key: "auth-purpose", question: "Who signs in?", rationale: "Changes access", options: [], answer: undefined } });
  expect(result).toEqual({ kind: "retry_as_spec", reason: "question_already_answered" });
});

test("never permits a planner decision to start a build", () => {
  expect(() => acceptPlannerDecision({ answeredKeys: new Set(), phase: "clarifying" }, { kind: "build" } as never)).toThrow("invalid_planner_decision");
});
```

- [ ] **Step 2: Run tests and verify missing policy**

Run: `bun test agents/planner/src/planner-policy.test.ts`

Expected: FAIL because `planner-policy.ts` does not exist.

- [ ] **Step 3: Implement policy and planner output contract**

```typescript
export type PlannerDecision =
  | { kind: "question"; message: string; question: RequirementQuestion }
  | { kind: "spec"; message: string; spec: Omit<WorkspaceSpec, "hash" | "createdAt"> };
export function acceptPlannerDecision(state: { answeredKeys: Set<string>; phase: WorkspacePhase }, decision: PlannerDecision) {
  if (decision.kind === "question") {
    if (state.answeredKeys.has(decision.question.key)) return { kind: "retry_as_spec" as const, reason: "question_already_answered" as const };
    return decision;
  }
  if (decision.kind === "spec") return decision;
  throw new Error("invalid_planner_decision");
}
```

Replace `trigger_build` with only two model tools: `ask_requirement_question` and `propose_workspace_spec`. The application persists the returned decision. Delete the exact-string `go ahead`/`build it` tool-choice branches. Keep Redis session code only as a temporary LLM transcript cache; it is no longer authoritative for messages, plans, ownership, approval, or phase.

- [ ] **Step 4: Run planner tests and typecheck**

Run: `bun test agents/planner/src/planner-policy.test.ts && bun --cwd agents/planner run typecheck`

Expected: tests PASS; planner typecheck exits 0; `rg -n 'build it|trigger_build' agents/planner/src apps/api/src/routes/chat.ts` returns no executable trigger path.

- [ ] **Step 5: Commit**

```powershell
git add agents/planner/src
git commit -m "fix(planner): enforce durable question and spec decisions"
```

---

### Task 6: Exact Spec Approval and Immutable Temporal Input

**Files:**
- Create: `pipeline/contracts/approved-build.ts`
- Test: `pipeline/contracts/approved-build.test.ts`
- Modify: `apps/api/src/utils/temporal.ts`
- Modify: `pipeline/workflows/project-build.ts`
- Create: `pipeline/workflows/approved-input.test.ts`
- Modify: `pipeline/activities/index.ts`
- Modify: `apps/api/src/routes/pipeline.ts`

**Interfaces:**
- Consumes: `ApprovedBuildInput` from Task 1 and approved run from Task 3.
- Produces: `startProjectBuild(input: ApprovedBuildInput): Promise<string>` and `materializeApprovedBuild(input, buildDir)`.

- [ ] **Step 1: Write failing approved-input tests**

```typescript
import { expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { computeSpecHash } from "@nexsidi/workspace-contract/spec";
import type { ApprovedBuildInput, WorkspaceSpec } from "@nexsidi/workspace-contract/types";
import { materializeApprovedBuild, verifyApprovedBuildInput } from "./approved-build.ts";

function fixtureApprovedBuildInput(overrides: Partial<WorkspaceSpec> = {}): ApprovedBuildInput {
  const content = {
    id: "11111111-1111-4111-8111-111111111111", workspaceId: "abc123def456", version: 1,
    status: "approved" as const, originalRequest: "Build Nextech", confirmedFacts: [], questions: [], assumptions: [], scope: [],
    userJourneys: [], pages: [{ id: "home", name: "Home", path: "/", description: "Home", access: "public" as const, requirementIds: ["home"] }],
    dataModel: [], apiContracts: [], auth: { mode: "none" as const, roles: [] }, design: { direction: "black and gold" },
    sources: [], acceptanceCriteria: [], createdAt: "2026-07-19T00:00:00.000Z", approvedAt: "2026-07-19T00:01:00.000Z", approvedBy: "user-1", ...overrides,
  };
  const spec = { ...content, hash: computeSpecHash(content) } satisfies WorkspaceSpec;
  return { runId: "22222222-2222-4222-8222-222222222222", workspaceId: spec.workspaceId, specId: spec.id, specVersion: spec.version, specHash: spec.hash, spec };
}

test("rejects a workflow input whose embedded spec differs from the approved hash", () => {
  const input = fixtureApprovedBuildInput();
  expect(() => verifyApprovedBuildInput({ ...input, specHash: "0".repeat(64) })).toThrow("approved_build_hash_mismatch");
});

test("materializes only confirmed pages and APIs", async () => {
  const input = fixtureApprovedBuildInput({ scope: [{ id: "s1", key: "admin", title: "Admin", description: "", state: "rejected" }] });
  const testDirectory = await mkdtemp(join(tmpdir(), "nexsidi-approved-build-"));
  const result = await materializeApprovedBuild(input, testDirectory);
  expect(result.lockedPages.map((page) => page.path)).not.toContain("/admin");
  expect(result.specHash).toBe(input.specHash);
});
```

```typescript
// pipeline/workflows/approved-input.test.ts
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
test("workflow consumes immutable ApprovedBuildInput and does not regenerate requirements", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf8");
  expect(source).toContain("ApprovedBuildInput");
  expect(source).not.toContain("runSaanvi(projectId");
  expect(source).not.toContain("runArjun(projectId");
  expect(source).not.toContain("userRequest?: string");
});
```

- [ ] **Step 2: Run tests and verify the old workflow fails them**

Run: `bun test pipeline/contracts/approved-build.test.ts pipeline/workflows/approved-input.test.ts`

Expected: FAIL because the contract module is missing and the workflow still regenerates requirements.

- [ ] **Step 3: Implement immutable materialization**

`verifyApprovedBuildInput()` must call `assertApprovedSpec(input.spec)`, compare ID/version/hash fields, and throw before writing files. `materializeApprovedBuild()` writes `approved-spec.json` and a deterministic generator input containing only `scope.state === "confirmed"`, declared pages, declared API contracts, declared entities, auth, design, acceptance criteria, and requirement IDs.

Change Temporal signatures to:

```typescript
export async function startProjectBuild(input: ApprovedBuildInput): Promise<string> {
  verifyApprovedBuildInput(input);
  const client = await getClient();
  const workflowId = `project-build-${input.runId}`;
  const handle = await client.workflow.start(projectBuildWorkflow, { taskQueue: TASK_QUEUE, workflowId, args: [input] });
  return handle.workflowId;
}

export async function projectBuildWorkflow(input: ApprovedBuildInput): Promise<void> {
  const { workspaceId: projectId } = input;
  await act.materializeApprovedBuild(input);
  // Continue compile, QA, live test, and delivery stages using the materialized contract.
}
```

The approval route starts Temporal exactly once after the transaction returns a newly created run. A replay returns the existing run without another start.

- [ ] **Step 4: Run workflow, API, and type tests**

Run: `bun test pipeline/contracts/approved-build.test.ts pipeline/workflows/approved-input.test.ts apps/api/src/routes/workspaces.test.ts && bun --cwd pipeline run typecheck && bun --cwd apps/api run typecheck`

Expected: all tests PASS and both typechecks exit 0.

- [ ] **Step 5: Commit**

```powershell
git add pipeline/contracts pipeline/workflows/project-build.ts pipeline/workflows/approved-input.test.ts pipeline/activities/index.ts apps/api/src/utils/temporal.ts apps/api/src/routes/pipeline.ts apps/api/src/routes/workspaces.ts
git commit -m "feat(pipeline): execute the exact approved specification"
```

---

### Task 7: Secure Artifacts, Status, and Public Events

**Files:**
- Modify: `apps/api/src/routes/artifacts.ts`
- Test: `apps/api/src/routes/artifacts.test.ts`
- Modify: `apps/api/src/routes/pipeline.ts`
- Modify: `apps/api/src/routes/ws.ts`
- Modify: `apps/api/src/routes/workspaces.ts`
- Test: `apps/api/src/routes/workspaces.test.ts`

**Interfaces:**
- Consumes: authenticated user ID, `WorkspaceService.snapshot()`, durable public events.
- Produces: owner-only artifacts/status and resumable `GET /api/workspaces/:id/events?after=<cursor>` SSE.

- [ ] **Step 1: Write failing authorization and confidentiality tests**

```typescript
test("artifact access always requires owner identity", async () => {
  expect((await anonymous.request("/api/artifacts/abc123def456/tree")).status).toBe(401);
  expect((await otherUser.request("/api/artifacts/abc123def456/tree")).status).toBe(404);
});

test("event replay contains only public schema fields", async () => {
  const response = await owner.request("/api/workspaces/abc123def456/events?after=0");
  const body = await response.text();
  expect(body).not.toContain("internalDetail");
  expect(body).not.toContain("model");
  expect(body).not.toContain("Bearer");
});
```

- [ ] **Step 2: Run tests and confirm current public behavior fails**

Run: `bun test apps/api/src/routes/artifacts.test.ts apps/api/src/routes/workspaces.test.ts`

Expected: FAIL because artifacts/status/raw streams still have public paths or conditional ownership.

- [ ] **Step 3: Enforce the boundary**

- Make `userId` mandatory in every artifact handler and always call the ownership check.
- Add ownership to pipeline status, result, and approval routes.
- Remove `/ws/pipeline/:projectId` and `/ws/screenshots/:projectId` from the public app surface.
- Mount health telemetry only at `/internal/ws` when `ENABLE_INTERNAL_WS=true`; require `INTERNAL_API_KEY` at connection time.
- Implement resumable workspace event SSE from `workspace_events`; send only `PublicActivityEvent` and cursor heartbeats.
- Return 404 for unauthorized IDs to avoid existence disclosure.

- [ ] **Step 4: Run security regression tests**

Run: `bun test apps/api/src/routes/artifacts.test.ts apps/api/src/routes/workspaces.test.ts apps/api/src/routes/auth.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/app.ts apps/api/src/routes/artifacts.ts apps/api/src/routes/artifacts.test.ts apps/api/src/routes/pipeline.ts apps/api/src/routes/ws.ts apps/api/src/routes/workspaces.ts apps/api/src/routes/workspaces.test.ts
git commit -m "fix(security): protect workspace artifacts and activity"
```

---

### Task 8: Scope-Locked Generator Prompts

**Files:**
- Create: `agents/generators/aanya/src/prompt.ts`
- Test: `agents/generators/aanya/src/prompt.test.ts`
- Create: `agents/generators/shubham/src/prompt.ts`
- Test: `agents/generators/shubham/src/prompt.test.ts`
- Modify: `agents/generators/aanya/src/index.ts`
- Modify: `agents/generators/shubham/src/index.ts`

**Interfaces:**
- Consumes: deterministic materialized generator contract from Task 6.
- Produces: `buildFrontendPrompt(contract)` and `buildBackendPrompt(contract)` with conditional auth and exact page/API lists.

- [ ] **Step 1: Write failing prompt tests**

```typescript
// agents/generators/aanya/src/prompt.test.ts
import { expect, test } from "bun:test";
import type { WorkspaceSpec } from "@nexsidi/workspace-contract/types";
import { buildFrontendPrompt } from "./prompt.ts";

function fixtureContract(overrides: Partial<WorkspaceSpec> = {}): WorkspaceSpec {
  return {
    id: "11111111-1111-4111-8111-111111111111", workspaceId: "abc123def456", version: 1, hash: "a".repeat(64), status: "approved",
    originalRequest: "Build Nextech", confirmedFacts: [], questions: [], assumptions: [], scope: [], userJourneys: [], pages: [], dataModel: [], apiContracts: [],
    auth: { mode: "none", roles: [] }, design: { direction: "black and gold" }, sources: [], acceptanceCriteria: [],
    createdAt: "2026-07-19T00:00:00.000Z", approvedAt: "2026-07-19T00:01:00.000Z", approvedBy: "user-1", ...overrides,
  };
}

test("frontend prompt does not invent auth or an admin page", () => {
  const prompt = buildFrontendPrompt(fixtureContract({ auth: { mode: "none", roles: [] }, pages: [{ id: "home", path: "/", name: "Home", description: "Home", access: "public", requirementIds: ["home"] }] }));
  expect(prompt).toContain("app/page.tsx");
  expect(prompt).not.toContain("JWT");
  expect(prompt).not.toContain("/admin");
  expect(prompt).not.toContain("dashboard");
});
```

```typescript
// agents/generators/shubham/src/prompt.test.ts
import { expect, test } from "bun:test";
import type { WorkspaceSpec } from "@nexsidi/workspace-contract/types";
import { buildBackendPrompt } from "./prompt.ts";

function fixtureContract(overrides: Partial<WorkspaceSpec> = {}): WorkspaceSpec {
  return {
    id: "11111111-1111-4111-8111-111111111111", workspaceId: "abc123def456", version: 1, hash: "a".repeat(64), status: "approved",
    originalRequest: "Build Nextech", confirmedFacts: [], questions: [], assumptions: [], scope: [], userJourneys: [], pages: [], dataModel: [], apiContracts: [],
    auth: { mode: "none", roles: [] }, design: { direction: "black and gold" }, sources: [], acceptanceCriteria: [],
    createdAt: "2026-07-19T00:00:00.000Z", approvedAt: "2026-07-19T00:01:00.000Z", approvedBy: "user-1", ...overrides,
  };
}

test("backend prompt includes only confirmed endpoints", () => {
  const prompt = buildBackendPrompt(fixtureContract({ apiContracts: [{ id: "contact-api", method: "POST", path: "/api/contact", description: "Submit inquiry", authenticated: false, requirementIds: ["contact"] }] }));
  expect(prompt).toContain("POST /api/contact");
  expect(prompt).not.toContain("/api/auth/register");
  expect(prompt).not.toContain("/api/admin");
});
```

- [ ] **Step 2: Run tests and verify unconditional prompts fail**

Run: `bun test agents/generators/aanya/src/prompt.test.ts agents/generators/shubham/src/prompt.test.ts`

Expected: FAIL because prompt builders do not exist.

- [ ] **Step 3: Implement exact prompt builders**

Each builder serializes the approved contract and includes these non-negotiable lines:

```text
The supplied page, endpoint, entity, auth, and requirement lists are immutable.
Implement every confirmed item and no suggested, deferred, rejected, or unlisted item.
Do not add authentication, dashboards, admin panels, payments, notifications, pages, APIs, or tables unless explicitly present.
Every output file must cite the requirement IDs it implements in the completion manifest.
```

Auth instructions are appended only when `contract.auth.mode === "session"`. Update both generator entry points to call the builder rather than embedding unconditional authentication prose.

- [ ] **Step 4: Run generator tests and typechecks**

Run: `bun test agents/generators/aanya/src/prompt.test.ts agents/generators/shubham/src/prompt.test.ts && bun --cwd agents/generators/aanya run typecheck && bun --cwd agents/generators/shubham run typecheck`

Expected: all tests PASS and both typechecks exit 0.

- [ ] **Step 5: Commit**

```powershell
git add agents/generators/aanya/src agents/generators/shubham/src
git commit -m "fix(generators): lock output to approved scope"
```

---

### Task 9: Idempotent Web Bootstrap and Durable Plan Approval

**Files:**
- Create: `apps/web/lib/workspace-api.ts`
- Create: `apps/web/lib/workspace-chat.ts`
- Test: `apps/web/lib/workspace-chat.test.ts`
- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/app/build/[id]/page.tsx`

**Interfaces:**
- Consumes: workspace HTTP/SSE contract from Task 4.
- Produces: `initialClientMessageId()`, `bootstrapAction()`, `upsertMessage()`, durable snapshot loading, and exact spec approval.

- [ ] **Step 1: Write the duplicate/race regression tests**

```typescript
import { expect, test } from "bun:test";
import { bootstrapAction, initialClientMessageId, upsertMessage } from "./workspace-chat.ts";

test("does not submit the URL prompt when the loaded snapshot already has messages", () => {
  expect(bootstrapAction({ snapshotLoaded: true, messageCount: 1, query: "Build Nextech" })).toEqual({ kind: "none" });
});

test("uses the same ID for retries of the same initial prompt", () => {
  expect(initialClientMessageId("abc123def456", "Build Nextech")).toBe(initialClientMessageId("abc123def456", "Build Nextech"));
});

test("upserts the streamed assistant message instead of appending it twice", () => {
  const message = { id: "a1", workspaceId: "abc123def456", role: "assistant" as const, content: "Plan ready", clientMessageId: "assistant:turn-1", createdAt: "now" };
  expect(upsertMessage(upsertMessage([], message), message)).toEqual([message]);
});
```

- [ ] **Step 2: Run tests and verify helpers are missing**

Run: `bun test apps/web/lib/workspace-chat.test.ts`

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement pure helpers**

```typescript
import type { WorkspaceMessage } from "@nexsidi/workspace-contract/types";
export function initialClientMessageId(workspaceId: string, query: string): string {
  let hash = 2166136261;
  for (const char of `${workspaceId}\0${query.trim()}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `initial:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
export function bootstrapAction(input: { snapshotLoaded: boolean; messageCount: number; query: string | null }) {
  if (!input.snapshotLoaded || input.messageCount > 0 || !input.query?.trim()) return { kind: "none" as const };
  return { kind: "send" as const, content: input.query.trim() };
}
export function upsertMessage(messages: WorkspaceMessage[], incoming: WorkspaceMessage): WorkspaceMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id || message.clientMessageId === incoming.clientMessageId);
  if (index < 0) return [...messages, incoming];
  return messages.map((message, current) => current === index ? incoming : message);
}
```

- [ ] **Step 4: Replace both UI race paths**

- Dashboard calls `POST /api/workspaces`, receives the server-generated ID, then navigates to `/build/:id?q=...`.
- Build page performs one snapshot request first. Only after it resolves does it call `bootstrapAction()`.
- Initial prompt uses `initialClientMessageId()` as both body `clientMessageId` and `Idempotency-Key`.
- Manual messages use one `crypto.randomUUID()` reused for body and header.
- SSE `assistant_message` calls `upsertMessage()`; `done` never appends text.
- Render `snapshot.activeSpec` in the existing right panel.
- Accept calls `POST /api/workspaces/:id/specs/:specId/approve` with `{ expectedHash }` and an idempotency key; remove `sendChatMessage("build it")`.
- Remove the page's `/ws/pipeline/:projectId` and `/ws/screenshots/:projectId` connections, `wsRef`, and raw-log append path.
- Reload the snapshot after approval, then resume authenticated `GET /api/workspaces/:id/events?after=<eventCursor>` SSE and owner-only pipeline status from the returned run ID.

- [ ] **Step 5: Run tests, typecheck, and production build**

Run: `bun test apps/web/lib/workspace-chat.test.ts && bun --cwd apps/web run typecheck && bun --cwd apps/web run build`

Expected: tests PASS, typecheck exits 0, and Next.js production build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib apps/web/app/dashboard/page.tsx 'apps/web/app/build/[id]/page.tsx'
git commit -m "fix(web): make planning bootstrap and approval idempotent"
```

---

### Task 10: Nextech End-to-End Contract Regression

**Files:**
- Create: `apps/api/src/workspaces/nextech-regression.test.ts`
- Create: `docs/verification/workspace-contract-foundation.md`

**Interfaces:**
- Consumes: all Tasks 1-9.
- Produces: executable proof for the first-slice exit criteria.

- [ ] **Step 1: Write the end-to-end contract test**

The test uses `MemoryWorkspaceStore`, a deterministic fixture, and a fake `startProjectBuild` recorder. Define the complete harness in the test file before the test:

```typescript
import { expect, test } from "bun:test";
import type { ApprovedBuildInput, WorkspaceSpec } from "@nexsidi/workspace-contract/types";
import { MemoryWorkspaceStore } from "./memory-store.ts";
import { WorkspaceService } from "./service.ts";

const NEXTECH_PROMPT = "i wnat a website for my comang we do it business we proive servies mobile app web app custom software crm pos bulk sms professional emails domain hosting digital marketing companyname is nextech";

function nextechSpec(workspaceId: string, version: number, authAnswer?: string): Omit<WorkspaceSpec, "hash" | "createdAt"> {
  const paths = ["/", "/vision", "/mission", "/about", "/services", "/products", "/contact", "/sign-in", "/sign-up", "/dashboard"];
  return {
    id: version === 1 ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",
    workspaceId, version, status: "draft", originalRequest: NEXTECH_PROMPT,
    confirmedFacts: [{ id: "company", key: "company-name", value: "Nextech", source: "user" }],
    questions: [{ id: "auth-q", key: "auth-purpose", question: "Who should sign in?", rationale: "Changes roles and protected pages", options: [{ label: "Clients and staff", value: "clients-and-staff" }], recommendedValue: "clients-and-staff", ...(authAnswer ? { answer: authAnswer, answeredAt: "2026-07-19T00:02:00.000Z" } : {}) }],
    assumptions: [],
    scope: [
      { id: "services", key: "services", title: "IT services", description: "Custom development services", state: "confirmed" },
      { id: "products", key: "products", title: "Packaged products", description: "CRM, POS, SMS, email, hosting", state: "confirmed" },
      { id: "admin", key: "admin-panel", title: "Admin panel", description: "Not requested", state: "rejected" },
    ],
    userJourneys: [],
    pages: authAnswer ? paths.map((path, index) => ({ id: `page-${index}`, name: path === "/" ? "Home" : path.slice(1), path, description: `Nextech ${path}`, access: path === "/dashboard" ? ("authenticated" as const) : ("public" as const), requirementIds: [path.includes("product") ? "products" : "services"] })) : [],
    dataModel: [], apiContracts: [], auth: authAnswer ? { mode: "session", roles: ["client", "staff"] } : { mode: "none", roles: [] },
    design: { direction: "deep black with warm gold" }, sources: [],
    acceptanceCriteria: [{ id: "navigation", statement: "Every confirmed page is reachable", requirementIds: ["services", "products"] }],
  };
}

function createWorkspaceHarness() {
  const service = new WorkspaceService(new MemoryWorkspaceStore());
  const startedBuilds: ApprovedBuildInput[] = [];
  return {
    startedBuilds,
    create: (userId: string, name: string) => service.createWorkspace(userId, name),
    snapshot: (userId: string, workspaceId: string) => service.snapshot(userId, workspaceId),
    async send(userId: string, workspaceId: string, idempotencyKey: string, clientMessageId: string, content: string) {
      const begun = await service.beginTurn(userId, workspaceId, idempotencyKey, clientMessageId, content);
      if (begun.kind === "replay") return begun.turn;
      const completed = await service.completeTurn(begun.turn.id, `assistant:${begun.turn.id}`, "I need one material clarification.");
      await service.saveDraftSpec(userId, workspaceId, nextechSpec(workspaceId, 1));
      return completed;
    },
    async answer(userId: string, workspaceId: string, idempotencyKey: string, answer: string) {
      const begun = await service.beginTurn(userId, workspaceId, idempotencyKey, idempotencyKey, answer);
      if (begun.kind === "created") await service.completeTurn(begun.turn.id, `assistant:${begun.turn.id}`, "Your build specification is ready.");
      return service.saveDraftSpec(userId, workspaceId, nextechSpec(workspaceId, 2, answer));
    },
    async approve(userId: string, workspaceId: string, specId: string, hash: string, idempotencyKey: string) {
      const result = await service.approveSpecAndCreateRun(userId, workspaceId, specId, hash, idempotencyKey);
      if (!result.replay) startedBuilds.push({ runId: result.runId, workspaceId, specId: result.spec.id, specVersion: result.spec.version, specHash: result.spec.hash, spec: result.spec });
      return result;
    },
  };
}

test("Nextech prompt is stored once and builds the exact approved spec", async () => {
  const harness = createWorkspaceHarness();
  const workspace = await harness.create("user-1", "Nextech");
  const key = "initial:nextech";
  await harness.send("user-1", workspace.id, key, key, NEXTECH_PROMPT);
  await harness.send("user-1", workspace.id, key, key, NEXTECH_PROMPT);
  const afterPrompt = await harness.snapshot("user-1", workspace.id);
  expect(afterPrompt.messages.filter((message) => message.role === "user")).toHaveLength(1);
  expect(afterPrompt.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  expect(afterPrompt.activeSpec?.questions.map((question) => question.key)).toEqual(["auth-purpose"]);

  await harness.answer("user-1", workspace.id, "answer-auth", "Clients and staff");
  const planned = await harness.snapshot("user-1", workspace.id);
  expect(planned.activeSpec?.pages.map((page) => page.path)).toEqual(["/", "/vision", "/mission", "/about", "/services", "/products", "/contact", "/sign-in", "/sign-up", "/dashboard"]);
  expect(planned.activeSpec?.scope.some((item) => item.key === "admin-panel" && item.state === "confirmed")).toBe(false);

  const approved = await harness.approve("user-1", workspace.id, planned.activeSpec!.id, planned.activeSpec!.hash, "approve-v1");
  const replay = await harness.approve("user-1", workspace.id, planned.activeSpec!.id, planned.activeSpec!.hash, "approve-v1");
  expect(replay.runId).toBe(approved.runId);
  expect(harness.startedBuilds).toHaveLength(1);
  expect(harness.startedBuilds[0]?.specHash).toBe(planned.activeSpec?.hash);
  expect(harness.startedBuilds[0]?.spec).toEqual(expect.objectContaining({ id: planned.activeSpec?.id, version: planned.activeSpec?.version }));
  await expect(harness.snapshot("user-2", workspace.id)).rejects.toThrow("workspace_not_found");
});
```

- [ ] **Step 2: Run the regression and fix only demonstrated integration gaps**

Run: `bun test apps/api/src/workspaces/nextech-regression.test.ts`

Expected: PASS. If it fails, change only files from Tasks 1-9 implicated by the failing assertion, rerun the exact test, then rerun that task's complete test set.

- [ ] **Step 3: Run complete first-slice verification**

Run:

```powershell
bun test packages/workspace-contract/src/*.test.ts packages/db/src/workspace-schema.test.ts agents/planner/src/planner-policy.test.ts apps/api/src/auth/session.test.ts apps/api/src/routes/auth.test.ts apps/api/src/routes/workspaces.test.ts apps/api/src/routes/artifacts.test.ts apps/api/src/workspaces/*.test.ts pipeline/contracts/*.test.ts pipeline/workflows/approved-input.test.ts agents/generators/aanya/src/prompt.test.ts agents/generators/shubham/src/prompt.test.ts apps/web/lib/workspace-chat.test.ts
bun run typecheck
bun --cwd apps/web run build
rg -n 'sendChatMessage\("build it"\)|trigger_build|x-user-id|if \(userId && !await assertOwns' apps agents pipeline
```

Expected:

- Every test passes.
- Every workspace package typechecks.
- Web production build succeeds.
- The final `rg` command returns no executable matches.

- [ ] **Step 4: Perform local browser verification**

Start PostgreSQL, Redis, Temporal, API, worker, and web. Sign up with a new test account and run the Nextech prompt through the browser.

Verify:

1. The prompt appears once.
2. The assistant response appears once.
3. Refresh retains messages, answered questions, and draft plan.
4. Accept starts one build from the displayed hash.
5. Refresh resumes the build.
6. A second account cannot load the workspace URL, artifact URLs, status stream, or event stream.
7. Browser Network payloads contain no internal identities, raw prompts, provider/model routing, bearer tokens, or raw commands.

Record exact commands, pass/fail output, test account IDs (not credentials), approved spec hash, run ID, and screenshots in `docs/verification/workspace-contract-foundation.md`.

- [ ] **Step 5: Review the complete diff and commit evidence**

Run:

```powershell
git diff --check
git status --short
git diff --stat HEAD~9..HEAD
```

Expected: no whitespace errors; only planned source/test/migration/docs files are part of the slice; generated build output and scratch files remain unstaged.

```powershell
git add apps/api/src/workspaces/nextech-regression.test.ts docs/verification/workspace-contract-foundation.md
git commit -m "test(workspace): verify exact approved build contract"
```

---

## Post-Plan Sequence

After this plan passes, write separate design-backed implementation plans in this order:

1. `autonomous-ide-shell` - Workspace Rail, Command Canvas, Evidence Deck, Execution Drawer, accessibility, responsive visual system.
2. `source-and-artifact-intelligence` - secure upload/fetch, PDF/Word/image extraction, OCR/vision, citations, provenance, credentials.
3. `verified-execution-and-repair` - generic subtasks, tool evidence, browser journeys, screenshots, targeted repair, stuck detection, resume.
4. `competitive-benchmark-and-production-gate` - 100-request evaluation, complete security validation, reliability/latency/resource measurements, production release gate.

The later plans must consume the contracts created here rather than introduce alternate message, plan, approval, ownership, or event systems.
