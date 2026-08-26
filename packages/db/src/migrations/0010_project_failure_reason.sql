-- Real gap found live: escalateTilotma/markProjectFailed only ever
-- console.error'd why a build stopped (spec_rejected_too_many_times,
-- stuck_state, budget_exceeded, deploy_failed, ...) — the DB row just said
-- status: "needs_review"/"failed" with nothing queryable explaining why, and
-- the frontend had no defined handling for "needs_review" at all, so a
-- project in that state looked indistinguishable from "still building."
--
-- IF NOT EXISTS keeps this safe to re-run (migrate.ts applies every .sql
-- file on every invocation).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS failure_reason TEXT;
