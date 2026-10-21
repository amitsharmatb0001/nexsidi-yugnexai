-- Patent claim 8: the security checker's pattern database. Source patterns (OWASP/CWE) and package advisories (CVE/GHSA).
-- IF NOT EXISTS everywhere: migrate.ts applies every .sql file on every run.
CREATE TABLE IF NOT EXISTS security_patterns (
  key         TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  category    TEXT NOT NULL,
  cwe         TEXT NOT NULL,
  severity    TEXT NOT NULL,
  pattern     TEXT NOT NULL,
  flags       TEXT,
  path_regex  TEXT,
  description TEXT NOT NULL,
  remediation TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS security_advisories (
  id         TEXT NOT NULL,
  ghsa       TEXT,
  package    TEXT NOT NULL,
  range      TEXT NOT NULL,
  fixed_in   TEXT NOT NULL,
  severity   TEXT NOT NULL,
  summary    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, package, range)
);
CREATE INDEX IF NOT EXISTS security_advisories_package_idx ON security_advisories (package);
