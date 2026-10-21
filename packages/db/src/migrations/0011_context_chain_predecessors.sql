-- Patent claim 10: each context record carries the SHA-256 hashes of ALL predecessor records of its project, so the
-- whole chain can be audited and any altered, removed or reordered record is detected.
-- Nullable: the 330 records written before this stay as they are, outside the chain.
-- IF NOT EXISTS keeps this safe to re-run (migrate.ts applies every .sql file on every invocation).
ALTER TABLE context_chain ADD COLUMN IF NOT EXISTS chain_seq INTEGER;
ALTER TABLE context_chain ADD COLUMN IF NOT EXISTS predecessor_hashes JSONB;
ALTER TABLE context_chain ADD COLUMN IF NOT EXISTS chain_hash CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS ctx_chain_project_seq_uq ON context_chain (project_id, chain_seq) WHERE chain_seq IS NOT NULL;
