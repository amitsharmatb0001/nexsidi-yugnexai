import {
  boolean, char, index, integer, jsonb, pgTable,
  text, timestamp, uuid, varchar,
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
  clerkId:   text("clerk_id").notNull().unique(),
  email:     text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Projects ────────────────────────────────────────────────────────────────
// id = first 12 chars of SHA-256 of (sessionId + projectName)
// clerkId = Clerk user ID (text) — stored directly, no UUID FK for Phase 1
export const projects = pgTable("projects", {
  id:         varchar("id", { length: 12 }).primaryKey(),
  clerkId:    text("clerk_id").notNull(),             // Clerk user ID (user_xxx)
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
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_conv_project_idx").on(t.projectId),
]);
