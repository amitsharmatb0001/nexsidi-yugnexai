-- Task 1 of docs/nexsidi/plans/2026-08-11-cost-control.md — per-project hard
-- token/$ budget with early halt. Real incident: a project burned $29K of
-- GCP/Gemini credits in a week because nothing anywhere in the pipeline
-- ever checked a running dollar total against a ceiling. This table is the
-- persisted running total pipeline/activities/index.ts's assertWithinBudget
-- checks before every generator/QA activity runs.
--
-- Expand-only (D8): a wholly new, additive table — no existing column or
-- constraint is touched.
CREATE TABLE IF NOT EXISTS token_spend (
  project_id varchar(64) PRIMARY KEY,
  total_tokens_in integer NOT NULL DEFAULT 0,
  total_tokens_out integer NOT NULL DEFAULT 0,
  total_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
