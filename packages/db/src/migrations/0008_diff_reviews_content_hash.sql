-- Closes a staleness gap found live while verifying 0007: diff_reviews was
-- keyed on (project_id, baseline, path) alone, so if a file's content
-- changed again against the SAME still-unchanged baseline (the pipeline
-- doesn't do this in normal operation — a build's baseline is fixed for
-- that run — but nothing enforced it), the OLD "accepted" mark from the
-- previous version of that diff would incorrectly carry over onto the new,
-- different diff for the same path. Adding the file's current git blob hash
-- to the key means "accepted" means exactly one specific diff, never a
-- stale approximation of it.
--
-- IF NOT EXISTS / a guarded DO block keep this safe to re-run (migrate.ts
-- applies every .sql file on every invocation).
ALTER TABLE diff_reviews ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';

-- Real bug found live testing this same migration: 0007's inline
-- `UNIQUE (project_id, baseline, path)` was never given an explicit name,
-- so Postgres auto-named it "diff_reviews_project_id_baseline_path_key"
-- (its own <table>_<col>_..._key convention) — NOT
-- "diff_reviews_project_baseline_path_key", the name this DROP originally
-- checked for. That typo meant the old 3-column constraint was never
-- actually dropped: it stayed active alongside the new 4-column one below,
-- and silently absorbed every accept-insert's onConflictDoNothing() as a
-- false "already accepted" — every /diff/accept call appeared to succeed
-- but the row never actually landed, so the file stayed unreviewed no
-- matter how many times it was accepted. Confirmed via
-- pg_get_constraintdef before writing this fix.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'diff_reviews_project_id_baseline_path_key'
  ) THEN
    ALTER TABLE diff_reviews DROP CONSTRAINT diff_reviews_project_id_baseline_path_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'diff_reviews_project_baseline_path_hash_key'
  ) THEN
    ALTER TABLE diff_reviews
      ADD CONSTRAINT diff_reviews_project_baseline_path_hash_key
      UNIQUE (project_id, baseline, path, content_hash);
  END IF;
END $$;

-- Rows written before this column existed default to content_hash='' —
-- a value no real git blob hash (or the literal "deleted") will ever equal
-- again, so they can never be matched by a future GET /diff and are dead
-- weight. Harmless to discard: they only ever represented review marks
-- under the now-superseded (project, baseline, path) key.
DELETE FROM diff_reviews WHERE content_hash = '';
