import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rememberTestingStart, readTestingStart, clearTestingStart, TEST_WINDOW_TABLES_SQL } from "./index.ts";

// 2026-11-02 (Brewline 8): 63 of the 78 menu items a customer would see came from the checks ("Americano 1793617466605151"). No account
// owns them, the recorded ids missed them, and the time window covered only public form tables and only the current activity. The start
// of testing is now kept across restarts, every table is cleaned from it, and it is forgotten at delivery, so a customer's rows are safe.
test("the first start of testing is kept, through later rounds and restarts", () => {
  const d = mkdtempSync(join(tmpdir(), "window-"));
  try {
    expect(readTestingStart(d)).toBeNull();
    expect(rememberTestingStart(d, "2026-11-02 11:04:00+00")).toBe("2026-11-02 11:04:00+00");
    expect(rememberTestingStart(d, "2026-11-02 11:31:00+00")).toBe("2026-11-02 11:04:00+00");
    expect(readTestingStart(d)).toBe("2026-11-02 11:04:00+00");
    clearTestingStart(d);
    expect(readTestingStart(d)).toBeNull();
    expect(rememberTestingStart(d, null)).toBeNull();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("something that is not a time is not used as one", () => {
  const d = mkdtempSync(join(tmpdir(), "window-"));
  try {
    expect(rememberTestingStart(d, "x'; DROP TABLE users; --")).toBeNull();
    expect(readTestingStart(d)).toBeNull();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("every table with a creation time is cleaned, and no account table", () => {
  expect(TEST_WINDOW_TABLES_SQL).toContain("created_at");
  expect(TEST_WINDOW_TABLES_SQL).toContain("password_hash");
  expect(TEST_WINDOW_TABLES_SQL).toContain("NOT EXISTS");
  expect(TEST_WINDOW_TABLES_SQL).not.toContain("'email'");
});

test("the gate remembers the start, the cleanup uses it, and delivery forgets it", () => {
  const riya = readFileSync(join(import.meta.dir, "index.ts"), "utf-8");
  expect(riya).toMatch(/const first = readTestingStart\(buildDir\);/);
  const gate = readFileSync(join(import.meta.dir, "../../../pipeline/orchestrator/acceptance-gate-real.ts"), "utf-8");
  expect(gate).toContain("rememberTestingStart(dir, databaseNow(dir))");
  const activities = readFileSync(join(import.meta.dir, "../../../pipeline/activities/index.ts"), "utf-8");
  expect(activities).toMatch(/markProjectDone[\s\S]{0,300}clearTestingStart\(buildDirFor\(projectId\)\)/);
});
