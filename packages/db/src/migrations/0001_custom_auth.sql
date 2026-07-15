-- Expand-contract migration: legacy provider columns remain only for existing data.
ALTER TABLE users ALTER COLUMN clerk_id DROP NOT NULL;
ALTER TABLE projects ALTER COLUMN clerk_id DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE projects p SET user_id = u.id FROM users u WHERE p.clerk_id = u.clerk_id AND p.user_id IS NULL;
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
