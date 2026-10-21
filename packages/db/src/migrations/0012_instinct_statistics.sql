-- Patent claim 7: recurring mistake patterns are found by statistical test across projects, not by a counter.
-- instinct_occurrences keeps one row per sighting so "how many different projects" can be answered.
-- IF NOT EXISTS everywhere: migrate.ts applies every .sql file on every run.
CREATE TABLE IF NOT EXISTS instinct_occurrences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain     TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  project_id VARCHAR(64),
  agent_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instinct_occ_pattern_idx ON instinct_occurrences (domain, trigger);
ALTER TABLE instincts ADD COLUMN IF NOT EXISTS occurrences INTEGER NOT NULL DEFAULT 1;
ALTER TABLE instincts ADD COLUMN IF NOT EXISTS project_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instincts ADD COLUMN IF NOT EXISTS significance NUMERIC(8,3);
ALTER TABLE instincts ADD COLUMN IF NOT EXISTS significant BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE instincts ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;
