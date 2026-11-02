import { test, expect } from "bun:test";
import { buildOwnFilesPreload, withoutOldCopies } from "./builder-preload.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-11-02 (Brewline 7): what filled each team step's first message.
test("compiled output of any name, and the files named to skip, are not sent", () => {
  const d = mkdtempSync(join(tmpdir(), "preload-"));
  try {
    for (const f of ["dist-test/a.js", "dist-test-2/a.js", "dist/a.js", "src/mine.ts", "src/other.ts", "src/other.test.ts", "src/keep.test.ts"]) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), "x");
    }
    expect(buildOwnFilesPreload(d, undefined, ["src/other.ts"]).included).toEqual(["src/keep.test.ts", "src/mine.ts"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("on a restart, the old copy of the same task goes, and old copies of files go from every earlier message", () => {
  const files = (s: string) => "\n\nYOUR CURRENT FILES \u2014 1 file(s) you already wrote, whole\n\n=== FILE: a.ts ===\n" + s + "\n=== END: a.ts ===";
  const task = "BUILD PHASE 1 of 1 \u2014 the whole app\n" + "x".repeat(500);
  const out = withoutOldCopies([
    { role: "system", content: "s" },
    { role: "user", content: task + files("old") },
    { role: "model", content: "ok" },
    { role: "user", content: "A review reported: fix a.ts" + files("older") },
  ] as never, task + files("new")) as Array<{ role: string; content: string }>;
  expect(out[0]!.content).toBe("s");
  expect(out[1]!.content).not.toContain("xxxx");
  expect(out[1]!.content).not.toContain("old");
  expect(out[2]!.content).toBe("ok");
  expect(out[3]!.content).toBe("A review reported: fix a.ts");
});

test("a different task is kept, without its old copies of files", () => {
  const out = withoutOldCopies([{ role: "user", content: "Fix the login page\n\nYOUR CURRENT FILES \u2014 stale" }] as never, "Fix the menu page") as Array<{ content: string }>;
  expect(out[0]!.content).toBe("Fix the login page");
});

test("the loop uses it when a saved conversation is resumed", () => {
  const src = readFileSync(join(import.meta.dir, "gemini-loop.ts"), "utf-8");
  expect(src).toContain("withoutOldCopies(messages, initialMessage)");
  expect(src).toContain("ownFilesSection(config.sandboxDir, config.preloadSkip)");
});
