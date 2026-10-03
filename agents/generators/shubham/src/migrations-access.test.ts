import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shubhamReadOnlyDirs, buildFixTask } from "./index.ts";

// 2026-10-03 (Ledgerly benchmark run 4): the backend wrote
// ON CONFLICT (user_id, financial_year) against a migration with no such
// unique constraint — every invoice save failed. The backend builder now
// reads the database builder's migrations (it cannot change them).
test("the backend builder is given the database builder's migrations read-only, and told so", () => {
  expect(shubhamReadOnlyDirs("/b/p1/backend")).toEqual([resolve("/b/p1/db/migrations")]);
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  // both the build run and the fix run get the folder
  expect((src.match(/readOnlyDirs: shubhamReadOnlyDirs\(outputDir\)/g) ?? []).length).toBe(2);
  expect(buildFixTask(["x"], { projectId: "p1", spec: {}, tasks: [] } as never)).toContain("../db/migrations");
});
