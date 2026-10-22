-- Spend per agent and model for each project (2026-10-22). token_spend keeps one total per project, so after the Trailhead
-- rerun ($36.94) the split by agent had to be rebuilt from worker logs. Each model call now also adds to its agent's row.
-- IF NOT EXISTS: migrate.ts applies every .sql file on every run. Expand-only: token_spend is unchanged.
CREATE TABLE IF NOT EXISTS agent_spend (
  project_id  VARCHAR(64) NOT NULL,
  agent       TEXT NOT NULL,
  model       TEXT NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  tokens_in   BIGINT NOT NULL DEFAULT 0,
  tokens_out  BIGINT NOT NULL DEFAULT 0,
  cached_in   BIGINT NOT NULL DEFAULT 0,
  cost_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, agent, model)
);
