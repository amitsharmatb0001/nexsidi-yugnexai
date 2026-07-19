import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  buildRuns,
  workspaceEvents,
  workspaceMessages,
  workspaceSpecs,
  workspaceTurns,
} from "./schema.ts";

const dialect = new PgDialect();
const migrationSql = readFileSync(
  new URL("./migrations/0002_workspace_contract.sql", import.meta.url),
  "utf8",
);

function columns(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => [
    column.name,
    column.getSQLType(),
    column.notNull,
    column.hasDefault,
    column.primary,
  ]);
}

function checks(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((constraint) => ({
    name: constraint.name,
    sql: dialect.sqlToQuery(constraint.value).sql,
  }));
}

function indexes(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((entry) => ({
    name: entry.config.name,
    unique: entry.config.unique,
    columns: entry.config.columns.map((column) => {
      if (!("name" in column) || typeof column.name !== "string") {
        throw new Error("workspace index must use named columns");
      }
      return column.name;
    }),
    where: entry.config.where ? dialect.sqlToQuery(entry.config.where).sql : null,
  }));
}

function uniqueConstraints(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).uniqueConstraints.map((constraint) => ({
    name: constraint.name,
    columns: constraint.columns.map((column) => column.name),
  }));
}

function foreignKeys(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map((key) => {
    const reference = key.reference();
    return {
      name: key.getName(),
      columns: reference.columns.map((column) => column.name),
      foreignTable: getTableName(reference.foreignTable),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: key.onDelete,
    };
  });
}

test("exports every durable workspace table", () => {
  expect(
    [workspaceMessages, workspaceTurns, workspaceSpecs, buildRuns, workspaceEvents].map(
      getTableName,
    ),
  ).toEqual([
    "workspace_messages",
    "workspace_turns",
    "workspace_specs",
    "build_runs",
    "workspace_events",
  ]);
});

test("models SQL UNIQUE declarations as named Drizzle constraints", () => {
  expect(uniqueConstraints(workspaceMessages)).toContainEqual({
    name: "workspace_messages_workspace_id_client_message_id_key",
    columns: ["workspace_id", "client_message_id"],
  });
  expect(uniqueConstraints(workspaceTurns)).toContainEqual({
    name: "workspace_turns_workspace_id_idempotency_key_key",
    columns: ["workspace_id", "idempotency_key"],
  });
  expect(uniqueConstraints(workspaceSpecs)).toContainEqual({
    name: "workspace_specs_workspace_id_version_key",
    columns: ["workspace_id", "version"],
  });
  expect(uniqueConstraints(buildRuns)).toContainEqual({
    name: "build_runs_workspace_id_idempotency_key_key",
    columns: ["workspace_id", "idempotency_key"],
  });
  expect(uniqueConstraints(workspaceEvents)).toContainEqual({
    name: "workspace_events_id_key",
    columns: ["id"],
  });
});

test("provides composite parent keys for workspace-owned records", () => {
  expect(uniqueConstraints(workspaceMessages)).toContainEqual({
    name: "workspace_messages_workspace_id_id_key",
    columns: ["workspace_id", "id"],
  });
  expect(uniqueConstraints(workspaceSpecs)).toContainEqual({
    name: "workspace_specs_workspace_id_id_key",
    columns: ["workspace_id", "id"],
  });
  expect(uniqueConstraints(buildRuns)).toContainEqual({
    name: "build_runs_workspace_id_id_key",
    columns: ["workspace_id", "id"],
  });
});

test("binds child records to parents in the same workspace", () => {
  expect(foreignKeys(workspaceTurns)).toContainEqual({
    name: "workspace_turns_user_message_workspace_fk",
    columns: ["workspace_id", "user_message_id"],
    foreignTable: "workspace_messages",
    foreignColumns: ["workspace_id", "id"],
    onDelete: "no action",
  });
  expect(foreignKeys(workspaceTurns)).toContainEqual({
    name: "workspace_turns_assistant_message_workspace_fk",
    columns: ["workspace_id", "assistant_message_id"],
    foreignTable: "workspace_messages",
    foreignColumns: ["workspace_id", "id"],
    onDelete: "no action",
  });
  expect(foreignKeys(buildRuns)).toContainEqual({
    name: "build_runs_spec_workspace_fk",
    columns: ["workspace_id", "spec_id"],
    foreignTable: "workspace_specs",
    foreignColumns: ["workspace_id", "id"],
    onDelete: "no action",
  });
  expect(foreignKeys(workspaceEvents)).toContainEqual({
    name: "workspace_events_run_workspace_fk",
    columns: ["workspace_id", "run_id"],
    foreignTable: "build_runs",
    foreignColumns: ["workspace_id", "id"],
    onDelete: "no action",
  });
});

test("defines the exact durable workspace columns, types, nullability, and defaults", () => {
  expect(columns(workspaceMessages)).toEqual([
    ["id", "uuid", true, true, true],
    ["workspace_id", "varchar(12)", true, false, false],
    ["role", "text", true, false, false],
    ["content", "text", true, false, false],
    ["client_message_id", "varchar(96)", true, false, false],
    ["created_at", "timestamp with time zone", true, true, false],
  ]);
  expect(columns(workspaceTurns)).toEqual([
    ["id", "uuid", true, true, true],
    ["workspace_id", "varchar(12)", true, false, false],
    ["idempotency_key", "varchar(96)", true, false, false],
    ["status", "text", true, false, false],
    ["user_message_id", "uuid", true, false, false],
    ["assistant_message_id", "uuid", false, false, false],
    ["error_code", "text", false, false, false],
    ["created_at", "timestamp with time zone", true, true, false],
    ["updated_at", "timestamp with time zone", true, true, false],
  ]);
  expect(columns(workspaceSpecs)).toEqual([
    ["id", "uuid", true, true, true],
    ["workspace_id", "varchar(12)", true, false, false],
    ["version", "integer", true, false, false],
    ["hash", "char(64)", true, false, false],
    ["status", "text", true, false, false],
    ["body", "jsonb", true, false, false],
    ["approved_at", "timestamp with time zone", false, false, false],
    ["approved_by", "uuid", false, false, false],
    ["created_at", "timestamp with time zone", true, true, false],
  ]);
  expect(columns(buildRuns)).toEqual([
    ["id", "uuid", true, true, true],
    ["workspace_id", "varchar(12)", true, false, false],
    ["spec_id", "uuid", true, false, false],
    ["spec_version", "integer", true, false, false],
    ["spec_hash", "char(64)", true, false, false],
    ["idempotency_key", "varchar(96)", true, false, false],
    ["workflow_id", "text", false, false, false],
    ["status", "text", true, true, false],
    ["created_at", "timestamp with time zone", true, true, false],
    ["updated_at", "timestamp with time zone", true, true, false],
  ]);
  expect(columns(workspaceEvents)).toEqual([
    ["cursor", "bigserial", true, true, true],
    ["id", "uuid", true, true, false],
    ["workspace_id", "varchar(12)", true, false, false],
    ["run_id", "uuid", false, false, false],
    ["category", "text", true, false, false],
    ["status", "text", true, false, false],
    ["summary", "text", true, false, false],
    ["safe_path", "text", false, false, false],
    ["elapsed_ms", "integer", false, false, false],
    ["evidence_id", "text", false, false, false],
    ["created_at", "timestamp with time zone", true, true, false],
  ]);

  const buildStatus = getTableConfig(buildRuns).columns.find(
    (column) => column.name === "status",
  );
  expect(buildStatus?.default).toBe("queued");
});

test("defines named role and status checks", () => {
  expect(checks(workspaceMessages)).toEqual([{
    name: "workspace_messages_role_check",
    sql: `"workspace_messages"."role" IN ('user', 'assistant')`,
  }]);
  expect(checks(workspaceTurns)).toEqual([{
    name: "workspace_turns_status_check",
    sql: `"workspace_turns"."status" IN ('processing', 'completed', 'failed')`,
  }]);
  expect(checks(workspaceSpecs)).toEqual([{
    name: "workspace_specs_status_check",
    sql: `"workspace_specs"."status" IN ('draft', 'approved', 'superseded')`,
  }]);
});

test("cascades workspace ownership and preserves optional child references", () => {
  for (const [table, name] of [
    [workspaceMessages, "workspace_messages_workspace_id_projects_id_fk"],
    [workspaceTurns, "workspace_turns_workspace_id_projects_id_fk"],
    [workspaceSpecs, "workspace_specs_workspace_id_projects_id_fk"],
    [buildRuns, "build_runs_workspace_id_projects_id_fk"],
    [workspaceEvents, "workspace_events_workspace_id_projects_id_fk"],
  ] as const) {
    expect(foreignKeys(table)).toContainEqual({
      name,
      columns: ["workspace_id"],
      foreignTable: "projects",
      foreignColumns: ["id"],
      onDelete: "cascade",
    });
  }
  expect(workspaceTurns.assistantMessageId.notNull).toBe(false);
  expect(workspaceEvents.runId.notNull).toBe(false);
});

test("keeps only the approved-spec partial index and ordered resume index", () => {
  expect(indexes(workspaceMessages)).toEqual([]);
  expect(indexes(workspaceTurns)).toEqual([]);
  expect(indexes(workspaceSpecs)).toEqual([{
    name: "workspace_one_approved_spec",
    unique: true,
    columns: ["workspace_id"],
    where: `"workspace_specs"."status" = 'approved'`,
  }]);
  expect(indexes(buildRuns)).toEqual([]);
  expect(indexes(workspaceEvents)).toEqual([{
    name: "workspace_events_resume_idx",
    unique: false,
    columns: ["workspace_id", "cursor"],
    where: null,
  }]);
});

test("migration creates named unique constraints and same-workspace foreign keys", () => {
  expect(
    [...migrationSql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(
      (match) => match[1],
    ),
  ).toEqual([
    "workspace_messages",
    "workspace_turns",
    "workspace_specs",
    "build_runs",
    "workspace_events",
  ]);
  for (const check of [
    "workspace_messages_role_check",
    "workspace_turns_status_check",
    "workspace_specs_status_check",
  ]) {
    expect(migrationSql).toContain(`CONSTRAINT ${check} CHECK`);
  }
  for (const constraint of [
    "workspace_messages_workspace_id_client_message_id_key",
    "workspace_messages_workspace_id_id_key",
    "workspace_turns_workspace_id_idempotency_key_key",
    "workspace_specs_workspace_id_version_key",
    "workspace_specs_workspace_id_id_key",
    "build_runs_workspace_id_idempotency_key_key",
    "build_runs_workspace_id_id_key",
    "workspace_events_id_key",
    "workspace_turns_user_message_workspace_fk",
    "workspace_turns_assistant_message_workspace_fk",
    "build_runs_spec_workspace_fk",
    "workspace_events_run_workspace_fk",
  ]) {
    expect(migrationSql).toContain(`CONSTRAINT ${constraint}`);
  }
  expect(migrationSql).toContain(
    "FOREIGN KEY (workspace_id, user_message_id) REFERENCES workspace_messages(workspace_id, id)",
  );
  expect(migrationSql).toContain(
    "FOREIGN KEY (workspace_id, assistant_message_id) REFERENCES workspace_messages(workspace_id, id)",
  );
  expect(migrationSql).toContain(
    "FOREIGN KEY (workspace_id, spec_id) REFERENCES workspace_specs(workspace_id, id)",
  );
  expect(migrationSql).toContain(
    "FOREIGN KEY (workspace_id, run_id) REFERENCES build_runs(workspace_id, id)",
  );
  expect(migrationSql.match(/REFERENCES projects\(id\) ON DELETE CASCADE/g)).toHaveLength(5);
  expect(migrationSql).toContain("status text NOT NULL DEFAULT 'queued'");
  expect(migrationSql).toContain(
    "CREATE UNIQUE INDEX IF NOT EXISTS workspace_one_approved_spec ON workspace_specs(workspace_id) WHERE status = 'approved'",
  );
  expect(migrationSql).toContain(
    "CREATE INDEX IF NOT EXISTS workspace_events_resume_idx ON workspace_events(workspace_id, cursor)",
  );
  expect(migrationSql).not.toContain("REFERENCES workspace_messages(id)");
  expect(migrationSql).not.toContain("REFERENCES workspace_specs(id)");
  expect(migrationSql).not.toContain("REFERENCES build_runs(id)");
});

test("migration safely upgrades an already-applied 0002 without destructive data changes", () => {
  expect(migrationSql).toContain("DO $$");
  expect(migrationSql).toContain("FROM pg_constraint");
  expect(migrationSql).toContain(
    "DROP CONSTRAINT IF EXISTS workspace_turns_user_message_id_fkey",
  );
  expect(migrationSql).toContain(
    "DROP CONSTRAINT IF EXISTS workspace_turns_assistant_message_id_fkey",
  );
  expect(migrationSql).toContain("DROP CONSTRAINT IF EXISTS build_runs_spec_id_fkey");
  expect(migrationSql).toContain("DROP CONSTRAINT IF EXISTS workspace_events_run_id_fkey");
  expect(migrationSql).not.toMatch(/\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
});
