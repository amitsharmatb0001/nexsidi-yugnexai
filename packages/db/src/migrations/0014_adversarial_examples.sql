-- Patent claim 4: the adversarial example database and the training history of each checker.
-- adversarial_examples: a defect that was planted in test code, per checker, with how often the checker caught or missed it.
-- training_rounds: one row per training round (how many defects were planted at a level and how many were caught).
-- IF NOT EXISTS everywhere: migrate.ts applies every .sql file on every run.
CREATE TABLE IF NOT EXISTS adversarial_examples (
  checker     TEXT NOT NULL,
  id          TEXT NOT NULL,
  operator    TEXT NOT NULL,
  level       INTEGER NOT NULL,
  file        TEXT NOT NULL,
  description TEXT NOT NULL,
  before_text TEXT NOT NULL DEFAULT '',
  after_text  TEXT NOT NULL DEFAULT '',
  hint        TEXT NOT NULL,
  caught      INTEGER NOT NULL DEFAULT 0,
  missed      INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (checker, id)
);
CREATE INDEX IF NOT EXISTS adversarial_examples_missed_idx ON adversarial_examples (checker, missed DESC);
CREATE TABLE IF NOT EXISTS training_rounds (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checker   TEXT NOT NULL,
  level     INTEGER NOT NULL,
  planted   INTEGER NOT NULL,
  caught    INTEGER NOT NULL,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_rounds_checker_idx ON training_rounds (checker, ran_at);
