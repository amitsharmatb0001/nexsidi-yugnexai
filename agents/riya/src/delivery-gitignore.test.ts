import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveToGitHub } from "./index.ts";

// 2026-09-27 (confidentiality): delivery ran `git add -A` over the whole
// build folder with no .gitignore, committing agent histories (internal
// system prompts, agent names), logs and QA notes into the customer's repo.
test("delivery writes the .gitignore before running git add", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-delivery-test-"));
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  try {
    writeFileSync(join(dir, "history-tilotma-reality-checker.json"), "[]");
    let gitignoreAtGitAdd: string | null = null;
    await archiveToGitHub("proj1", dir, {
      execFn: (cmd) => {
        if (cmd.includes("git add")) gitignoreAtGitAdd = existsSync(join(dir, ".gitignore")) ? readFileSync(join(dir, ".gitignore"), "utf-8") : null;
      },
    });
    expect(gitignoreAtGitAdd).not.toBeNull();
    expect(gitignoreAtGitAdd!).toContain("/history-*.json");
    expect(gitignoreAtGitAdd!).toContain("/logs/");
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
