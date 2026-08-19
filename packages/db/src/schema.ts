import { sql } from "drizzle-orm";
import {
  bigserial, boolean, char, check, foreignKey, index, integer, jsonb, numeric, pgTable,
  text, timestamp, unique, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";

// ─── Fix #6: Agent Registry ───────────────────────────────────────────────────
// Tilotma queries this table at runtime to check agent availability,
// circuit state, and model assignment — not the hardcoded CLAUDE.md roster.
export const agents = pgTable("agents", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull().unique(),
  model:     text("model").notNull(),
  role:      text("role").notNull(),
  phase:     integer("phase").notNull().default(1),
  status:    text("status").notNull().default("active"), // active | circuit_open | disabled
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:        uuid("id").primaryKey().defaultRandom(),
  email:     text("email").notNull(),
  // 2026-08-05: was nullable, matching 0001_custom_auth.sql's original
  // expand-only ALTER — but every real registration path (apps/api/src/
  // auth/service.ts) always provides one, and the login path already
  // treats a missing hash as an unusable account. See
  // 0003_password_hash_not_null.sql for the contract-half migration this
  // pairs with; schema.ts and the live DB were drifting apart with no
  // migration file capturing the DB's actual (correct) constraint.
  passwordHash: text("password_hash").notNull(),
  name:      text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull(),
  tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

// ─── Projects ────────────────────────────────────────────────────────────────
// id = first 12 chars of SHA-256 of (sessionId + projectName)
// clerkId = Clerk user ID (text) — stored directly, no UUID FK for Phase 1
export const projects = pgTable("projects", {
  id:         varchar("id", { length: 12 }).primaryKey(),
  userId:     uuid("user_id").notNull(),
  name:       text("name").notNull(),
  spec:       jsonb("spec"),
  status:     text("status").notNull().default("pending"),
  appUrl:     text("app_url"),                         // set by Riya after docker-compose up
  githubRepo: text("github_repo"),                     // Fix #9: Riya sets this after archival
  iteration:  integer("iteration").notNull().default(0),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Context Chain (Patent Claims 1/3/7) ─────────────────────────────────────
// Append-only: no UPDATE except verified flag, no DELETE ever.
export const contextChain = pgTable("context_chain", {
  id:          uuid("id").primaryKey().defaultRandom(),
  projectId:   varchar("project_id", { length: 64 }).notNull(),
  agentFrom:   text("agent_from").notNull(),
  agentTo:     text("agent_to").notNull(),
  contextHash: char("context_hash", { length: 64 }).notNull(),
  signature:   text("signature").notNull(),
  verified:    boolean("verified").notNull().default(false),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ctx_chain_project_idx").on(t.projectId),
]);

// ─── QA Results (Fix #8: per-agent row, individual pass/fail) ─────────────────
// Any single agent scoring <85 blocks the pipeline — NOT the average.
// This table stores each agent's result separately to enforce that rule.
export const qaResults = pgTable("qa_results", {
  id:          uuid("id").primaryKey().defaultRandom(),
  projectId:   varchar("project_id", { length: 64 }).notNull(),
  iteration:   integer("iteration").notNull(),
  agentName:   text("agent_name").notNull(), // navya | karan | deepika
  score:       integer("score").notNull(),
  findings:    jsonb("findings").notNull().default([]),
  // Fix #8: this is the per-agent gate, not an average
  passed:      boolean("passed").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("qa_project_iter_idx").on(t.projectId, t.iteration),
]);

// ─── Stuck-state log (Fix #7: persistent counter for Temporal workflow) ───────
export const stuckStateLog = pgTable("stuck_state_log", {
  id:            uuid("id").primaryKey().defaultRandom(),
  projectId:     varchar("project_id", { length: 64 }).notNull(),
  iteration:     integer("iteration").notNull(),
  minScore:      integer("min_score").notNull(),
  improvement:   integer("improvement").notNull(), // vs 3 iterations ago
  escalated:     boolean("escalated").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Prompt Audit (Nice-to-have #13: encrypted + hash-indexed) ───────────────
// hash   = SHA-256 of plaintext — fast lookup without decryption
// cipher = AES-256-GCM — full recovery for incident response
export const promptAudit = pgTable("prompt_audit", {
  id:         uuid("id").primaryKey().defaultRandom(),
  projectId:  varchar("project_id", { length: 64 }),
  agentName:  text("agent_name").notNull(),
  hash:       char("hash", { length: 64 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv:         text("iv").notNull(),
  tag:        text("tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_hash_idx").on(t.hash),
]);

// ─── Token Spend (cost-control Task 1, docs/nexsidi/plans/2026-08-11-cost-control.md) ──
// Running per-project token/cost total — checked BEFORE every generator/QA
// activity (pipeline/activities/index.ts's assertWithinBudget) so a project
// halts before spending more, not after discovering it overspent. Direct
// response to a real incident: a project burned $29K of GCP/Gemini credits
// in a week with no spend ceiling anywhere in the pipeline.
// One row per project, accumulated in place via UPSERT (see
// packages/agent-runtime/src/cost-budget.ts's recordSpend) rather than
// re-derived by summing a log table — a budget check is O(1) regardless of
// how many LLM calls a project has made.
export const tokenSpend = pgTable("token_spend", {
  projectId:      varchar("project_id", { length: 64 }).primaryKey(),
  totalTokensIn:  integer("total_tokens_in").notNull().default(0),
  totalTokensOut: integer("total_tokens_out").notNull().default(0),
  // 12,6 gives headroom to $999,999.999999 at 6-decimal precision — a
  // per-project total should never realistically approach that, but
  // truncating fractional cents across thousands of accumulated small
  // deltas (one per LLM call) would silently under-count real spend.
  totalCostUsd:   numeric("total_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Instinct Memory (Patent Claim 2) ────────────────────────────────────────
export const instincts = pgTable("instincts", {
  id:         uuid("id").primaryKey().defaultRandom(),
  trigger:    text("trigger").notNull(),
  action:     text("action").notNull(),
  confidence: text("confidence").notNull(), // "0.3" | "0.5" | "0.7" | "0.9"
  domain:     text("domain").notNull(),
  scope:      text("scope").notNull().default("project"), // project | global
  projectId:  varchar("project_id", { length: 64 }),
  outcome:    text("outcome").notNull(), // mistake | success
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Agent Conversations (Persistent State across Fix Iterations) ────────────
export const agentConversations = pgTable("agent_conversations", {
  id:         uuid("id").primaryKey().defaultRandom(),
  projectId:  varchar("project_id", { length: 64 }).notNull(),
  agentName:  text("agent_name").notNull(),
  messages:   jsonb("messages").notNull().default([]),
  // 2026-08-13 (cost-control Task 2, review Finding 3): the structured fact
  // ledger (packages/agent-runtime/src/context-selection.ts) was previously
  // built in gemini-loop.ts and discarded when the function returned —
  // never included in any return value, never logged, never persisted.
  // Persisted here following the exact same load/save pattern `messages`
  // already uses (see runAgentWithGemini's load block and saveHistory), so
  // it survives and accumulates across a resumed run instead of restarting
  // empty every call.
  factLedger: jsonb("fact_ledger").notNull().default([]),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_conv_project_idx").on(t.projectId),
]);

export const workspaceMessages = pgTable("workspace_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: varchar("workspace_id", { length: 12 }).notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  clientMessageId: varchar("client_message_id", { length: 96 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("workspace_messages_role_check", sql`${t.role} IN ('user', 'assistant')`),
  unique("workspace_messages_workspace_id_client_message_id_key")
    .on(t.workspaceId, t.clientMessageId),
  unique("workspace_messages_workspace_id_id_key").on(t.workspaceId, t.id),
  foreignKey({
    name: "workspace_messages_workspace_id_fkey",
    columns: [t.workspaceId],
    foreignColumns: [projects.id],
  }).onDelete("cascade"),
]);

export const workspaceTurns = pgTable("workspace_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: varchar("workspace_id", { length: 12 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 96 }).notNull(),
  status: text("status").notNull(),
  userMessageId: uuid("user_message_id").notNull(),
  assistantMessageId: uuid("assistant_message_id"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "workspace_turns_status_check",
    sql`${t.status} IN ('processing', 'completed', 'failed')`,
  ),
  unique("workspace_turns_workspace_id_idempotency_key_key")
    .on(t.workspaceId, t.idempotencyKey),
  foreignKey({
    name: "workspace_turns_user_message_workspace_fk",
    columns: [t.workspaceId, t.userMessageId],
    foreignColumns: [workspaceMessages.workspaceId, workspaceMessages.id],
  }).onDelete("no action"),
  foreignKey({
    name: "workspace_turns_assistant_message_workspace_fk",
    columns: [t.workspaceId, t.assistantMessageId],
    foreignColumns: [workspaceMessages.workspaceId, workspaceMessages.id],
  }).onDelete("no action"),
  foreignKey({
    name: "workspace_turns_workspace_id_fkey",
    columns: [t.workspaceId],
    foreignColumns: [projects.id],
  }).onDelete("cascade"),
]);

export const workspaceSpecs = pgTable("workspace_specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: varchar("workspace_id", { length: 12 }).notNull(),
  version: integer("version").notNull(),
  hash: char("hash", { length: 64 }).notNull(),
  status: text("status").notNull(),
  body: jsonb("body").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "workspace_specs_status_check",
    sql`${t.status} IN ('draft', 'approved', 'superseded')`,
  ),
  unique("workspace_specs_workspace_id_version_key").on(t.workspaceId, t.version),
  unique("workspace_specs_workspace_id_id_key").on(t.workspaceId, t.id),
  uniqueIndex("workspace_one_approved_spec")
    .on(t.workspaceId)
    .where(sql`${t.status} = 'approved'`),
  foreignKey({
    name: "workspace_specs_workspace_id_fkey",
    columns: [t.workspaceId],
    foreignColumns: [projects.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "workspace_specs_approved_by_fkey",
    columns: [t.approvedBy],
    foreignColumns: [users.id],
  }).onDelete("no action"),
]);

export const buildRuns = pgTable("build_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: varchar("workspace_id", { length: 12 }).notNull(),
  specId: uuid("spec_id").notNull(),
  specVersion: integer("spec_version").notNull(),
  specHash: char("spec_hash", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 96 }).notNull(),
  workflowId: text("workflow_id"),
  status: text("status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("build_runs_workspace_id_idempotency_key_key")
    .on(t.workspaceId, t.idempotencyKey),
  unique("build_runs_workspace_id_id_key").on(t.workspaceId, t.id),
  foreignKey({
    name: "build_runs_spec_workspace_fk",
    columns: [t.workspaceId, t.specId],
    foreignColumns: [workspaceSpecs.workspaceId, workspaceSpecs.id],
  }).onDelete("no action"),
  foreignKey({
    name: "build_runs_workspace_id_fkey",
    columns: [t.workspaceId],
    foreignColumns: [projects.id],
  }).onDelete("cascade"),
]);

// ─── Diff Reviews (accept/reject state for the IDE's Changes view) ───────────
// Only "accepted" is ever stored — a file the user marked reviewed with
// nothing to change. "Rejected" is an action (git checkout/rm of the
// baseline state + a commit — see apps/api/src/routes/artifacts.ts), not a
// status: once rejected the file has no diff against the baseline, so
// there is nothing left to persist. Scoped to (projectId, baseline, path,
// contentHash) — contentHash is the file's git blob hash at HEAD (or the
// literal "deleted" for a removed file), so "accepted" means exactly one
// specific version of that file's diff. Baseline alone isn't enough: two
// different diffs for the same path can share one still-unchanged baseline
// (see 0008_diff_reviews_content_hash.sql for the live bug this closed).
export const diffReviews = pgTable("diff_reviews", {
  id:          uuid("id").primaryKey().defaultRandom(),
  projectId:   varchar("project_id", { length: 12 }).notNull(),
  baseline:    char("baseline", { length: 7 }).notNull(),
  path:        text("path").notNull(),
  contentHash: text("content_hash").notNull(),
  reviewedAt:  timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("diff_reviews_project_baseline_path_hash_key").on(t.projectId, t.baseline, t.path, t.contentHash),
  foreignKey({
    name: "diff_reviews_project_id_fkey",
    columns: [t.projectId],
    foreignColumns: [projects.id],
  }).onDelete("cascade"),
]);

export const workspaceEvents = pgTable("workspace_events", {
  cursor: bigserial("cursor", { mode: "number" }).primaryKey(),
  id: uuid("id").notNull().defaultRandom(),
  workspaceId: varchar("workspace_id", { length: 12 }).notNull(),
  runId: uuid("run_id"),
  category: text("category").notNull(),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  safePath: text("safe_path"),
  elapsedMs: integer("elapsed_ms"),
  evidenceId: text("evidence_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("workspace_events_id_key").on(t.id),
  index("workspace_events_resume_idx").on(t.workspaceId, t.cursor),
  foreignKey({
    name: "workspace_events_run_workspace_fk",
    columns: [t.workspaceId, t.runId],
    foreignColumns: [buildRuns.workspaceId, buildRuns.id],
  }).onDelete("no action"),
  foreignKey({
    name: "workspace_events_workspace_id_fkey",
    columns: [t.workspaceId],
    foreignColumns: [projects.id],
  }).onDelete("cascade"),
]);
