ALTER TABLE "context_chain" ALTER COLUMN "project_id" TYPE varchar(64);
ALTER TABLE "qa_results" ALTER COLUMN "project_id" TYPE varchar(64);
ALTER TABLE "stuck_state_log" ALTER COLUMN "project_id" TYPE varchar(64);
ALTER TABLE "prompt_audit" ALTER COLUMN "project_id" TYPE varchar(64);
ALTER TABLE "instincts" ALTER COLUMN "project_id" TYPE varchar(64);
ALTER TABLE "agent_conversations" ALTER COLUMN "project_id" TYPE varchar(64);
