import { test, expect } from "bun:test";
import { execScreenshot } from "./screenshot.ts";

test("execScreenshot blocks non-localhost URLs (same policy as http_request)", async () => {
  const result = await execScreenshot({ url: "https://example.com", outputPath: "shot.png" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("localhost");
});

test("execScreenshot rejects a path traversal attempt in outputPath", async () => {
  const result = await execScreenshot({ url: "http://localhost:3200", outputPath: "../../etc/shot.png" });
  expect(result.status).toBe("error");
});

test("execScreenshot rejects a sibling-directory path that shares a string prefix but is not actually inside cwd", async () => {
  // When `bun test packages/agent-runtime/src/tools/screenshot.test.ts` runs from the repo root,
  // process.cwd() is the repo root itself (e.g. ".../worktrees/eager-varahamihira-967edb"), not the
  // package directory. "../eager-varahamihira-967edb-evil/x.png" resolves to a sibling directory
  // (".../worktrees/eager-varahamihira-967edb-evil/x.png") that shares a string prefix with cwd
  // (the raw string "eager-varahamihira-967edb") but is NOT inside it. A bare `startsWith(cwdAbs)`
  // check would incorrectly allow this; the fixed guard must reject it.
  const cwdName = process.cwd().split(/[\\/]/).filter(Boolean).pop()!;
  const result = await execScreenshot({ url: "http://localhost:3200", outputPath: `../${cwdName}-evil/x.png` });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("escapes the working directory");
});
