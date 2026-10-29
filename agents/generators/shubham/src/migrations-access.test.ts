import { test, expect } from "bun:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { shubhamReadOnlyDirs, buildFixTask } from "./index.ts";

// 2026-10-03 (Ledgerly benchmark run 4): the backend wrote
// ON CONFLICT (user_id, financial_year) against a migration with no such
// unique constraint — every invoice save failed. The backend builder now
// reads the database builder's migrations (it cannot change them).
// 2026-10-29 (team plan, stage 1): the whole project is readable, not only the migrations.
test("the backend builder reads the whole project (the migrations included), and is told so", () => {
  expect(shubhamReadOnlyDirs("/b/p1/backend")).toEqual([resolve("/b/p1")]);
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  // both the build run and the fix run get the folder
  expect((src.match(/readOnlyDirs: shubhamReadOnlyDirs\(outputDir\)/g) ?? []).length).toBe(2);
  expect(buildFixTask(["x"], { projectId: "p1", spec: {}, tasks: [] } as never)).toContain("../db/migrations");
});

// 2026-10-25 (brewline3): in a fix round the backend builder tried `ls ../db/migrations` and list_files on `../db` (both refused), never
// found out that the database builder had already added order_items.name_at_time, reported itself blocked, and the finding looped.
// The migrations are now in its task text, word for word, so it does not have to find them.
test("the fix task carries the migrations word for word", () => {
  const root = mkdtempSync(join(tmpdir(), "mig-note-"));
  const prev = process.env.BUILD_DIR;
  process.env.BUILD_DIR = root;
  try {
    mkdirSync(join(root, "p9", "db", "migrations"), { recursive: true });
    writeFileSync(join(root, "p9", "db", "migrations", "0001_fix.sql"), 'ALTER TABLE "order_items" ADD COLUMN "name_at_time" text;');
    const task = buildFixTask(["x"], { projectId: "p9", spec: {}, tasks: [] } as never);
    expect(task).toContain("0001_fix.sql");
    expect(task).toContain('ADD COLUMN "name_at_time"');
  } finally {
    if (prev === undefined) delete process.env.BUILD_DIR; else process.env.BUILD_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
});
