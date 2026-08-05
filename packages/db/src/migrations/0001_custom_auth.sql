-- Expand-contract migration: legacy provider columns remain only for existing data.
-- 2026-08-05: guarded — migrate.ts has no applied-migrations tracking table,
-- it re-runs every .sql file unconditionally every time (see its own header
-- comment). clerk_id was fully dropped from both tables by 0004_drop_clerk_id.sql
-- (completing what this migration only half-did); these guards make this file
-- replayable both before AND after that later migration has run, instead of
-- erroring the instant clerk_id no longer exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'clerk_id') THEN
    ALTER TABLE users ALTER COLUMN clerk_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'clerk_id') THEN
    ALTER TABLE projects ALTER COLUMN clerk_id DROP NOT NULL;
  END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'clerk_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'clerk_id') THEN
    UPDATE projects p SET user_id = u.id FROM users u WHERE p.clerk_id = u.clerk_id AND p.user_id IS NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email) WHERE email <> '';
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects (user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
