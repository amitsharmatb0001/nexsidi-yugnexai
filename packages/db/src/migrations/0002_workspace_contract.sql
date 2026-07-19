CREATE TABLE IF NOT EXISTS workspace_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(12) NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  client_message_id varchar(96) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_messages_role_check CHECK (role IN ('user','assistant')),
  CONSTRAINT workspace_messages_workspace_id_client_message_id_key UNIQUE (workspace_id, client_message_id),
  CONSTRAINT workspace_messages_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT workspace_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(12) NOT NULL,
  idempotency_key varchar(96) NOT NULL,
  status text NOT NULL,
  user_message_id uuid NOT NULL,
  assistant_message_id uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_turns_status_check CHECK (status IN ('processing','completed','failed')),
  CONSTRAINT workspace_turns_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT workspace_turns_user_message_workspace_fk FOREIGN KEY (workspace_id, user_message_id) REFERENCES workspace_messages(workspace_id, id),
  CONSTRAINT workspace_turns_assistant_message_workspace_fk FOREIGN KEY (workspace_id, assistant_message_id) REFERENCES workspace_messages(workspace_id, id),
  CONSTRAINT workspace_turns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(12) NOT NULL,
  version integer NOT NULL,
  hash char(64) NOT NULL,
  status text NOT NULL,
  body jsonb NOT NULL,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_specs_status_check CHECK (status IN ('draft','approved','superseded')),
  CONSTRAINT workspace_specs_workspace_id_version_key UNIQUE (workspace_id, version),
  CONSTRAINT workspace_specs_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT workspace_specs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT workspace_specs_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_one_approved_spec ON workspace_specs(workspace_id) WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS build_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(12) NOT NULL,
  spec_id uuid NOT NULL,
  spec_version integer NOT NULL,
  spec_hash char(64) NOT NULL,
  idempotency_key varchar(96) NOT NULL,
  workflow_id text,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT build_runs_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT build_runs_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT build_runs_spec_workspace_fk FOREIGN KEY (workspace_id, spec_id) REFERENCES workspace_specs(workspace_id, id),
  CONSTRAINT build_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_events (
  cursor bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id varchar(12) NOT NULL,
  run_id uuid,
  category text NOT NULL,
  status text NOT NULL,
  summary text NOT NULL,
  safe_path text,
  elapsed_ms integer,
  evidence_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_events_id_key UNIQUE (id),
  CONSTRAINT workspace_events_run_workspace_fk FOREIGN KEY (workspace_id, run_id) REFERENCES build_runs(workspace_id, id),
  CONSTRAINT workspace_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workspace_events_resume_idx ON workspace_events(workspace_id, cursor);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_messages'::regclass
      AND conname = 'workspace_messages_workspace_id_fkey'
  ) THEN
    ALTER TABLE workspace_messages
      DROP CONSTRAINT IF EXISTS workspace_messages_workspace_id_projects_id_fk;
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_messages'::regclass
      AND conname = 'workspace_messages_workspace_id_projects_id_fk'
  ) THEN
    ALTER TABLE workspace_messages
      RENAME CONSTRAINT workspace_messages_workspace_id_projects_id_fk TO workspace_messages_workspace_id_fkey;
  ELSE
    ALTER TABLE workspace_messages
      ADD CONSTRAINT workspace_messages_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_turns'::regclass
      AND conname = 'workspace_turns_workspace_id_fkey'
  ) THEN
    ALTER TABLE workspace_turns
      DROP CONSTRAINT IF EXISTS workspace_turns_workspace_id_projects_id_fk;
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_turns'::regclass
      AND conname = 'workspace_turns_workspace_id_projects_id_fk'
  ) THEN
    ALTER TABLE workspace_turns
      RENAME CONSTRAINT workspace_turns_workspace_id_projects_id_fk TO workspace_turns_workspace_id_fkey;
  ELSE
    ALTER TABLE workspace_turns
      ADD CONSTRAINT workspace_turns_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_specs'::regclass
      AND conname = 'workspace_specs_workspace_id_fkey'
  ) THEN
    ALTER TABLE workspace_specs
      DROP CONSTRAINT IF EXISTS workspace_specs_workspace_id_projects_id_fk;
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_specs'::regclass
      AND conname = 'workspace_specs_workspace_id_projects_id_fk'
  ) THEN
    ALTER TABLE workspace_specs
      RENAME CONSTRAINT workspace_specs_workspace_id_projects_id_fk TO workspace_specs_workspace_id_fkey;
  ELSE
    ALTER TABLE workspace_specs
      ADD CONSTRAINT workspace_specs_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_specs'::regclass
      AND conname = 'workspace_specs_approved_by_fkey'
  ) THEN
    ALTER TABLE workspace_specs
      DROP CONSTRAINT IF EXISTS workspace_specs_approved_by_users_id_fk;
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_specs'::regclass
      AND conname = 'workspace_specs_approved_by_users_id_fk'
  ) THEN
    ALTER TABLE workspace_specs
      RENAME CONSTRAINT workspace_specs_approved_by_users_id_fk TO workspace_specs_approved_by_fkey;
  ELSE
    ALTER TABLE workspace_specs
      ADD CONSTRAINT workspace_specs_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES users(id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'build_runs'::regclass
      AND conname = 'build_runs_workspace_id_fkey'
  ) THEN
    ALTER TABLE build_runs
      DROP CONSTRAINT IF EXISTS build_runs_workspace_id_projects_id_fk;
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'build_runs'::regclass
      AND conname = 'build_runs_workspace_id_projects_id_fk'
  ) THEN
    ALTER TABLE build_runs
      RENAME CONSTRAINT build_runs_workspace_id_projects_id_fk TO build_runs_workspace_id_fkey;
  ELSE
    ALTER TABLE build_runs
      ADD CONSTRAINT build_runs_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_events'::regclass
      AND conname = 'workspace_events_workspace_id_fkey'
  ) THEN
    ALTER TABLE workspace_events
      DROP CONSTRAINT IF EXISTS workspace_events_workspace_id_projects_id_fk;
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_events'::regclass
      AND conname = 'workspace_events_workspace_id_projects_id_fk'
  ) THEN
    ALTER TABLE workspace_events
      RENAME CONSTRAINT workspace_events_workspace_id_projects_id_fk TO workspace_events_workspace_id_fkey;
  ELSE
    ALTER TABLE workspace_events
      ADD CONSTRAINT workspace_events_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_messages'::regclass
      AND conname = 'workspace_messages_workspace_id_client_message_id_key'
  ) THEN
    ALTER TABLE workspace_messages
      ADD CONSTRAINT workspace_messages_workspace_id_client_message_id_key UNIQUE (workspace_id, client_message_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_messages'::regclass
      AND conname = 'workspace_messages_workspace_id_id_key'
  ) THEN
    ALTER TABLE workspace_messages
      ADD CONSTRAINT workspace_messages_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_turns'::regclass
      AND conname = 'workspace_turns_workspace_id_idempotency_key_key'
  ) THEN
    ALTER TABLE workspace_turns
      ADD CONSTRAINT workspace_turns_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_specs'::regclass
      AND conname = 'workspace_specs_workspace_id_version_key'
  ) THEN
    ALTER TABLE workspace_specs
      ADD CONSTRAINT workspace_specs_workspace_id_version_key UNIQUE (workspace_id, version);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_specs'::regclass
      AND conname = 'workspace_specs_workspace_id_id_key'
  ) THEN
    ALTER TABLE workspace_specs
      ADD CONSTRAINT workspace_specs_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'build_runs'::regclass
      AND conname = 'build_runs_workspace_id_idempotency_key_key'
  ) THEN
    ALTER TABLE build_runs
      ADD CONSTRAINT build_runs_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'build_runs'::regclass
      AND conname = 'build_runs_workspace_id_id_key'
  ) THEN
    ALTER TABLE build_runs
      ADD CONSTRAINT build_runs_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_events'::regclass
      AND conname = 'workspace_events_id_key'
  ) THEN
    ALTER TABLE workspace_events
      ADD CONSTRAINT workspace_events_id_key UNIQUE (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_turns'::regclass
      AND conname = 'workspace_turns_user_message_workspace_fk'
  ) THEN
    ALTER TABLE workspace_turns
      ADD CONSTRAINT workspace_turns_user_message_workspace_fk
      FOREIGN KEY (workspace_id, user_message_id) REFERENCES workspace_messages(workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_turns'::regclass
      AND conname = 'workspace_turns_assistant_message_workspace_fk'
  ) THEN
    ALTER TABLE workspace_turns
      ADD CONSTRAINT workspace_turns_assistant_message_workspace_fk
      FOREIGN KEY (workspace_id, assistant_message_id) REFERENCES workspace_messages(workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'build_runs'::regclass
      AND conname = 'build_runs_spec_workspace_fk'
  ) THEN
    ALTER TABLE build_runs
      ADD CONSTRAINT build_runs_spec_workspace_fk
      FOREIGN KEY (workspace_id, spec_id) REFERENCES workspace_specs(workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_events'::regclass
      AND conname = 'workspace_events_run_workspace_fk'
  ) THEN
    ALTER TABLE workspace_events
      ADD CONSTRAINT workspace_events_run_workspace_fk
      FOREIGN KEY (workspace_id, run_id) REFERENCES build_runs(workspace_id, id);
  END IF;
END $$;

ALTER TABLE workspace_turns
  DROP CONSTRAINT IF EXISTS workspace_turns_user_message_id_fkey,
  DROP CONSTRAINT IF EXISTS workspace_turns_assistant_message_id_fkey,
  DROP CONSTRAINT IF EXISTS workspace_turns_user_message_id_workspace_messages_id_fk,
  DROP CONSTRAINT IF EXISTS workspace_turns_assistant_message_id_workspace_messages_id_fk;

ALTER TABLE build_runs
  DROP CONSTRAINT IF EXISTS build_runs_spec_id_fkey,
  DROP CONSTRAINT IF EXISTS build_runs_spec_id_workspace_specs_id_fk;

ALTER TABLE workspace_events
  DROP CONSTRAINT IF EXISTS workspace_events_run_id_fkey,
  DROP CONSTRAINT IF EXISTS workspace_events_run_id_build_runs_id_fk;
