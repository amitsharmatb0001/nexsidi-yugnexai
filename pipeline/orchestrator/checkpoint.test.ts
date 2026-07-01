import { test, expect } from "bun:test";
import { writeCheckpoint, readCheckpoint } from "./checkpoint.ts";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_PROJECT = "test-checkpoint-proj";
const BUILD_DIR = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";

test("writeCheckpoint then readCheckpoint returns the same data", () => {
  writeCheckpoint(TEST_PROJECT, "01-requirements", { specId: "abc123", done: true });
  const result = readCheckpoint<{ specId: string; done: boolean }>(TEST_PROJECT, "01-requirements");
  expect(result).toEqual({ specId: "abc123", done: true });
  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});

test("readCheckpoint returns null when no checkpoint exists (fresh start)", () => {
  const result = readCheckpoint(TEST_PROJECT, "nonexistent-stage");
  expect(result).toBeNull();
});

test("writeCheckpoint throws on a path-traversal projectId", () => {
  expect(() => writeCheckpoint("../../escaped-project", "01-requirements", { pwned: true })).toThrow();
});

test("readCheckpoint throws on a path-traversal projectId", () => {
  expect(() => readCheckpoint(TEST_PROJECT + "/../escaped", "01-requirements")).toThrow();
});

test("readCheckpoint throws a clear error on malformed JSON on disk", () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "checkpoints");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "corrupt-stage.json"), "{ not valid json", "utf-8");

  expect(() => readCheckpoint(TEST_PROJECT, "corrupt-stage")).toThrow(
    /Checkpoint corrupt: test-checkpoint-proj\/corrupt-stage/
  );

  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});
