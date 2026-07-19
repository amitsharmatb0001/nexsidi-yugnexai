import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstinctCron } from "./instinct-cron.ts";

test("instinct-cron selects recurring mismatches and patches only the injected skill root", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "nexsidi-instinct-cron-test-"));
  const observationsPath = join(tempRoot, "observations", "observations.jsonl");
  const skillsDir = join(tempRoot, "skills");
  const skillFile = join(skillsDir, "navya.md");
  const originalEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  };
  const committed: Array<{ skillPath: string; agentName: string }> = [];
  let chatCalls = 0;

  try {
    process.env.HOME = join(tempRoot, "unused-home");
    process.env.USERPROFILE = process.env.HOME;
    process.env.XDG_DATA_HOME = join(tempRoot, "unused-data");

    mkdirSync(join(tempRoot, "observations"), { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      observationsPath,
      [
        JSON.stringify({ agentName: "navya", missedFinding: "Null pointer exception on sign-in", createdAt: new Date().toISOString() }),
        JSON.stringify({ agentName: "navya", missedFinding: "Null pointer exception on sign-in", createdAt: new Date().toISOString() }),
      ].join("\n") + "\n",
      "utf-8",
    );
    writeFileSync(skillFile, "# Navya Rules\n\n## Rules\n- Rule 1", "utf-8");

    await runInstinctCron({
      observationsPath,
      skillsDir,
      chat: async () => {
        chatCalls++;
        return {
          content: "# Navya Rules\n\n## Rules\n- Rule 1\n- Rule 2 (Prevent Null pointer exception on sign-in)",
        };
      },
      commitSkill: async (skillPath, agentName) => {
        committed.push({ skillPath, agentName });
      },
    });

    expect(readFileSync(skillFile, "utf-8")).toContain("Prevent Null pointer exception on sign-in");
    expect(chatCalls).toBe(1);
    expect(committed).toEqual([{ skillPath: skillFile, agentName: "navya" }]);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
