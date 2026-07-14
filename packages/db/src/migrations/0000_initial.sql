-- NexSidi platform initial schema
-- Generated: 2026-06-24

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Agent registry (Fix #6)
CREATE TABLE IF NOT EXISTS agents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  model       TEXT NOT NULL,
  role        TEXT NOT NULL,
  phase       INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'active',
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Users (synced from Clerk via webhook)
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id    TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users (clerk_id);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id          VARCHAR(12) PRIMARY KEY,
  clerk_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  spec        JSONB,
  status      TEXT NOT NULL DEFAULT 'pending',
  app_url     TEXT,
  github_repo TEXT,
  iteration   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_clerk_id ON projects (clerk_id);

-- Context chain (Patent Claims 1/3/7) — append-only
CREATE TABLE IF NOT EXISTS context_chain (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    VARCHAR(64) NOT NULL,
  agent_from    TEXT NOT NULL,
  agent_to      TEXT NOT NULL,
  context_hash  CHAR(64) NOT NULL,
  signature     TEXT NOT NULL,
  verified      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctx_chain_project ON context_chain (project_id);

-- QA results (Fix #8: per-agent row)
CREATE TABLE IF NOT EXISTS qa_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  VARCHAR(64) NOT NULL,
  iteration   INTEGER NOT NULL,
  agent_name  TEXT NOT NULL,
  score       INTEGER NOT NULL,
  findings    JSONB NOT NULL DEFAULT '[]',
  passed      BOOLEAN NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qa_project_iter ON qa_results (project_id, iteration);

-- Stuck-state log (Fix #7)
CREATE TABLE IF NOT EXISTS stuck_state_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  VARCHAR(64) NOT NULL,
  iteration   INTEGER NOT NULL,
  min_score   INTEGER NOT NULL,
  improvement INTEGER NOT NULL,
  escalated   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Prompt audit (Nice-to-have #13)
CREATE TABLE IF NOT EXISTS prompt_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  VARCHAR(64),
  agent_name  TEXT NOT NULL,
  hash        CHAR(64) NOT NULL,
  ciphertext  TEXT NOT NULL,
  iv          TEXT NOT NULL,
  tag         TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_hash ON prompt_audit (hash);

-- Instinct memory (Patent Claim 2)
CREATE TABLE IF NOT EXISTS instincts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger     TEXT NOT NULL,
  action      TEXT NOT NULL,
  confidence  TEXT NOT NULL,
  domain      TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'project',
  project_id  VARCHAR(64),
  outcome     TEXT NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Agent conversations (persistent state across fix iterations)
CREATE TABLE IF NOT EXISTS agent_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  VARCHAR(64) NOT NULL,
  agent_name  TEXT NOT NULL,
  messages    JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_conv_project_idx ON agent_conversations (project_id);

-- Seed: agent roster (Phase 1 agents only — matches CLAUDE.md)
INSERT INTO agents (name, model, role, phase) VALUES
  ('tilotma', 'claude-opus-4-8',              'orchestrator',    1),
  ('saanvi',  'minimax/minimax-m3',            'requirements',    1),
  ('arjun',   'mistralai/mistral-nemotron',    'planner',         1),
  ('shubham', 'deepseek-ai/deepseek-v4-pro',  'backend-gen',     1),
  ('aanya',   'deepseek-ai/deepseek-v4-pro',  'frontend-gen',    1),
  ('pranav',  'qwen2.5-coder:7b',             'db-gen',          1),
  ('riya',    'qwen2.5-coder:7b',             'devops',          1),
  ('navya',   'moonshotai/kimi-k2.6',         'qa-logic',        1),
  ('karan',   'moonshotai/kimi-k2.6',         'qa-security',     1),
  ('deepika', 'minimax/minimax-m3',            'qa-performance',  1)
ON CONFLICT (name) DO NOTHING;
