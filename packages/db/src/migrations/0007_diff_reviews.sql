-- Accept/reject review state for the IDE's Changes view.
--
-- Only "accepted" is ever persisted here — a file the user marked reviewed
-- with nothing to change. "Rejected" is not a status: it is an action (the
-- API route reverts the file to its pre-build content via git and commits
-- the revert), after which the file has no diff against the baseline and
-- simply no longer appears in the list — nothing left to store.
--
-- Scoped to (project_id, baseline, path) rather than just (project_id, path)
-- so a redeploy's new baseline commit naturally starts every file
-- unreviewed again: old rows for a superseded baseline are never queried
-- again, because the diff endpoint always looks up the CURRENT baseline.
--
-- IF NOT EXISTS keeps this safe to re-run (migrate.ts applies every .sql
-- file on every invocation, not a tracked one-shot journal).
CREATE TABLE IF NOT EXISTS diff_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  baseline CHAR(7) NOT NULL,
  path TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, baseline, path)
);
