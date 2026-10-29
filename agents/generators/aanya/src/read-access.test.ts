import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aanyaReadOnlyDirs } from "./index.ts";

// 2026-10-29 (team plan, stage 1): the frontend builder reads the whole project — the backend's routes and the
// database's migrations included — and still changes only its own folder.
test("the frontend builder reads the whole project", () => {
  expect(aanyaReadOnlyDirs("/b/p1/frontend")).toEqual([resolve("/b/p1")]);
});

test("both the build run and the fix run get the whole project to read", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect((src.match(/readOnlyDirs: aanyaReadOnlyDirs\(outputDir\)/g) ?? []).length).toBe(2);
});

test("the frontend builder's instructions let it read the backend and the database", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).not.toContain("Never read, edit, start or stop the backend");
  expect(src).toContain("You may read the backend and the database");
});
