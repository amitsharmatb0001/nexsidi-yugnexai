-- Contract half of the Clerk-to-custom-auth migration: 0001_custom_auth.sql
-- dropped clerk_id's NOT NULL on BOTH users and projects (expand) but never
-- dropped either column. schema.ts's users table has never had a clerk_id
-- field — the live platform DB already matches that (confirmed: column and
-- index both already absent), via some out-of-band change with no migration
-- record. This formalizes it so replaying migrations from scratch on a new
-- environment reaches the same state the current live DB is actually in.
DROP INDEX IF EXISTS idx_users_clerk_id;
ALTER TABLE users DROP COLUMN IF EXISTS clerk_id;

-- projects.clerk_id: same unfinished pattern, other direction — schema.ts's
-- projects table also has no clerkId field, but the live column was still
-- present (nullable, unused) rather than already dropped. Confirmed no code
-- reads projects.clerk_id (grepped the full repo) before dropping.
ALTER TABLE projects DROP COLUMN IF EXISTS clerk_id;
