CREATE TABLE IF NOT EXISTS workspace_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL, client_message_id varchar(96) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, client_message_id)
);
CREATE TABLE IF NOT EXISTS workspace_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key varchar(96) NOT NULL, status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  user_message_id uuid NOT NULL REFERENCES workspace_messages(id), assistant_message_id uuid REFERENCES workspace_messages(id),
  error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS workspace_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL, hash char(64) NOT NULL, status text NOT NULL CHECK (status IN ('draft','approved','superseded')),
  body jsonb NOT NULL, approved_at timestamptz, approved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_one_approved_spec ON workspace_specs(workspace_id) WHERE status = 'approved';
CREATE TABLE IF NOT EXISTS build_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spec_id uuid NOT NULL REFERENCES workspace_specs(id), spec_version integer NOT NULL, spec_hash char(64) NOT NULL,
  idempotency_key varchar(96) NOT NULL, workflow_id text, status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS workspace_events (
  cursor bigserial PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid(), workspace_id varchar(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id uuid REFERENCES build_runs(id), category text NOT NULL, status text NOT NULL, summary text NOT NULL,
  safe_path text, elapsed_ms integer, evidence_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id)
);
CREATE INDEX IF NOT EXISTS workspace_events_resume_idx ON workspace_events(workspace_id, cursor);
