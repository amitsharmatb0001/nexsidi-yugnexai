-- Contract half of 0001_custom_auth.sql's expand-contract migration: that
-- migration added password_hash as a plain nullable TEXT column (correct,
-- since existing Clerk-only rows at the time had no password) but never
-- followed up with the contract step once every real registration path
-- (apps/api/src/auth/service.ts) started always providing one. Confirmed
-- live: 0 existing rows have a NULL password_hash on this platform DB, and
-- the login path already treats a missing password_hash as an unusable
-- account (service.ts's `if (!user?.passwordHash || ...) return null`) — so
-- this constraint only makes explicit what was already functionally true.
-- Backfill guard kept for safety on any other environment where a stale
-- Clerk-only row might still exist; such a row has no real password and was
-- already unable to log in before this migration.
UPDATE users SET password_hash = 'LEGACY_ACCOUNT_NO_PASSWORD_SET' WHERE password_hash IS NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
