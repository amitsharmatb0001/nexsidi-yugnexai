import { test, expect } from "bun:test";
import { writeCheckpoint, readCheckpoint } from "./checkpoint.ts";
import { rmSync } from "fs";
import { join } from "path";

const TEST_PROJECT = "test-checkpoint-proj";

test("writeCheckpoint then readCheckpoint returns the same data", () => {
  writeCheckpoint(TEST_PROJECT, "01-requirements", { specId: "abc123", done: true });
  const result = readCheckpoint<{ specId: string; done: boolean }>(TEST_PROJECT, "01-requirements");
  expect(result).toEqual({ specId: "abc123", done: true });
  rmSync(join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", TEST_PROJECT), { recursive: true, force: true });
});

test("readCheckpoint returns null when no checkpoint exists (fresh start)", () => {
  const result = readCheckpoint(TEST_PROJECT, "nonexistent-stage");
  expect(result).toBeNull();
});
