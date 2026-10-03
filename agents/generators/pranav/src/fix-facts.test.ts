import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFix, getOutputDir } from "./index.ts";

// 2026-10-03 (evidence-only plan, T5): the database builder's fix was one
// model call that always wrote a new migration for every finding — it read
// src/schema.ts rather than the migrations that really run, and had no way to
// say a finding was not true. It now works from the real migrations, and for
// a finding the migrations disprove it answers NOT TRUE with a quote; a
// quote that is really there becomes a dispute for Tilotma, and no SQL is
// written for it.
const PLAN = { projectId: "pfix1" } as never;
const prev = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup(): string {
  dir = mkdtempSync(join(tmpdir(), "pranav-facts-"));
  process.env.BUILD_DIR = dir;
  const migrations = join(getOutputDir("pfix1"), "migrations");
  mkdirSync(migrations, { recursive: true });
  writeFileSync(join(migrations, "0000_initial.sql"), "CREATE TABLE seqs (user_id uuid, fy text);\nCREATE UNIQUE INDEX IF NOT EXISTS idx_seqs_user_fy ON seqs(user_id, fy);\n");
  return migrations;
}

test("the fix is written from the real migrations, which the model sees", async () => {
  setup();
  let seen = "";
  await runFix(PLAN, ["[performance/MEDIUM] missing index on seqs.user_id"], {
    chat: async (_a: string, msgs: Array<{ content: string }>) => {
      seen = msgs.map((m) => m.content).join("\n");
      return { content: "CREATE INDEX IF NOT EXISTS idx_seqs_user ON seqs(user_id);", modelUsed: "x" } as never;
    },
  } as never);
  expect(seen).toContain("idx_seqs_user_fy");
});

test("a finding the migrations disprove gets no SQL and becomes a dispute with the quote", async () => {
  const migrations = setup();
  const result = await runFix(PLAN, ["[logic/HIGH] seqs has no unique (user_id, fy) — ON CONFLICT fails"], {
    chat: async () => ({ content: "NOT TRUE 1: CREATE UNIQUE INDEX IF NOT EXISTS idx_seqs_user_fy ON seqs(user_id, fy);", modelUsed: "x" }) as never,
  } as never);
  expect(result.success).toBe(true);
  expect(result.filesWritten).toEqual([]);
  expect(readdirSync(migrations)).toEqual(["0000_initial.sql"]);
  const { readDisputes } = await import("../../../../packages/agent-runtime/src/tools/dispute.ts");
  const d = readDisputes("pfix1");
  expect(d.length).toBe(1);
  expect(d[0]!.agent).toBe("pranav");
  expect(d[0]!.observed).toContain("idx_seqs_user_fy");
});

test("a NOT TRUE whose quote is not in the migrations is not accepted: no dispute, the finding stays open", async () => {
  setup();
  const result = await runFix(PLAN, ["[logic/HIGH] seqs has no unique (user_id, fy)"], {
    chat: async () => ({ content: "NOT TRUE 1: ALTER TABLE seqs ADD CONSTRAINT made_up UNIQUE (user_id, fy);", modelUsed: "x" }) as never,
  } as never);
  const { readDisputes } = await import("../../../../packages/agent-runtime/src/tools/dispute.ts");
  expect(readDisputes("pfix1")).toEqual([]);
  expect(result.success).toBe(false);
  expect(result.errors.join(" ")).toContain("not in the migrations");
});
