import { expect, test, mock, spyOn } from "bun:test";
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { runInstinctCron } from "./instinct-cron.ts";

test("instinct-cron selects recurring mismatches and patches skill file", async () => {
  const obsDir = join(homedir(), ".local", "share", "nexsidi-instincts");
  mkdirSync(obsDir, { recursive: true });
  const obsPath = join(obsDir, "observations.jsonl");

  // Create two identical observations to trigger occurrences >= 2
  const obsLines = [
    JSON.stringify({ agentName: "navya", missedFinding: "Null pointer exception on sign-in", createdAt: new Date().toISOString() }),
    JSON.stringify({ agentName: "navya", missedFinding: "Null pointer exception on sign-in", createdAt: new Date().toISOString() }),
  ];
  writeFileSync(obsPath, obsLines.join("\n") + "\n", "utf-8");

  // Setup mock skill file
  const skillDir = join(process.cwd(), "packages", "agent-runtime", "skills");
  mkdirSync(skillDir, { recursive: true });
  const skillFile = join(skillDir, "navya.md");
  const originalSkillContent = `# Navya Rules\n\n## Rules\n- Rule 1`;
  writeFileSync(skillFile, originalSkillContent, "utf-8");

  // Mock geminiChat call
  mock.module("@nexsidi/llm-client", () => {
    return {
      geminiChat: async () => {
        return {
          content: `# Navya Rules\n\n## Rules\n- Rule 1\n- Rule 2 (Prevent Null pointer exception on sign-in)`
        };
      }
    };
  });

  // Spy on git commands
  const childProcess = await import("node:child_process");
  const execSyncSpy = spyOn(childProcess, "execSync").mockImplementation(() => Buffer.from("mocked execSync"));

  await runInstinctCron();

  // Assertions
  const updatedContent = readFileSync(skillFile, "utf-8");
  expect(updatedContent).toContain("Prevent Null pointer exception on sign-in");
  expect(execSyncSpy).toHaveBeenCalled();

  // Cleanup
  rmSync(obsPath, { force: true });
  writeFileSync(skillFile, originalSkillContent, "utf-8");
});
