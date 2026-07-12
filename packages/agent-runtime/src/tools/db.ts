// Read-only database verification tool for live QA.
//
// 2026-07-11 (Layer 3): lets a review agent confirm "did the data actually
// land in the DB / does it read back" — e.g. after driving the UI to create a
// task, query the tasks table and see the row. Connects to the DEPLOYED app's
// Postgres via the TIER3_DB_URL env var (set by Stage 6 to the host-accessible
// connection string). STRICTLY read-only: the query must be a single SELECT
// (or WITH...SELECT) — any write/DDL keyword or statement stacking is rejected
// before it ever reaches the database, so a QA agent can never mutate the very
// app it is reviewing.
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

const WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do|vacuum|reindex|comment|set|begin|commit|rollback)\b/i;

// Exported for direct unit testing — the guard is the security boundary.
export function isReadOnlyQuery(raw: string): { ok: true } | { ok: false; reason: string } {
  const q = raw.trim().replace(/;+\s*$/, ""); // allow one trailing semicolon
  if (!q) return { ok: false, reason: "empty query" };
  if (q.includes(";")) return { ok: false, reason: "multiple statements are not allowed (single SELECT only)" };
  if (!/^(select|with)\b/i.test(q)) return { ok: false, reason: "only SELECT (or WITH...SELECT) queries are allowed" };
  if (WRITE_KEYWORDS.test(q)) return { ok: false, reason: "query contains a write/DDL keyword — read-only queries only" };
  return { ok: true };
}

export async function execDbQuery(args: { query: string }): Promise<ToolResult> {
  const dbUrl = process.env.TIER3_DB_URL;
  if (!dbUrl) {
    return { status: "error", summary: "db_query unavailable: TIER3_DB_URL is not set (the deployed app's database connection was not provided to this review)" };
  }
  const guard = isReadOnlyQuery(args.query);
  if (!guard.ok) {
    return { status: "error", summary: `db_query rejected: ${guard.reason}` };
  }

  let sql: import("postgres").Sql | null = null;
  try {
    const postgres = (await import("postgres")).default;
    sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
    const rows = await sql.unsafe(args.query);
    const preview = JSON.stringify(rows).slice(0, 4000);
    return {
      status: "success",
      summary: `Query returned ${rows.length} row(s)`,
      output: preview,
    };
  } catch (err) {
    return { status: "error", summary: `db_query failed: ${String(err instanceof Error ? err.message : err)}` };
  } finally {
    if (sql) await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export const DB_QUERY_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "db_query",
    description: "Run a READ-ONLY SQL SELECT against the deployed app's database to verify data. Use to confirm a write actually persisted (e.g. after creating a task through the UI, `SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5`) or that expected tables/columns exist (query information_schema). Only a single SELECT/WITH statement is permitted; writes are rejected.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "a single read-only SELECT statement" } },
      required: ["query"],
    },
  },
};
