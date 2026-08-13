-- Cost-control Task 2, review Finding 3: agent_conversations previously
-- persisted only `messages` (the raw conversation history). The structured
-- fact ledger (packages/agent-runtime/src/context-selection.ts) was built in
-- gemini-loop.ts alongside it but never left the function — no column
-- existed to put it in. Adds one, following the same jsonb-array-default
-- shape `messages` already uses. IF NOT EXISTS keeps this safe to re-run
-- (this repo's migrate.ts applies every .sql file in the directory on every
-- invocation, not a tracked one-shot journal — see 0004_drop_clerk_id.sql
-- for the same pattern).
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS fact_ledger jsonb NOT NULL DEFAULT '[]'::jsonb;
