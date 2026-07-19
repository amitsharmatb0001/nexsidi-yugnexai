import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMetaSupervisor } from "./meta-supervisor.ts";

test("meta-supervisor patches and commits only files under the injected repository root", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "nexsidi-meta-supervisor-test-"));
  const projectId = `test-project-${Date.now()}`;
  const buildDir = join(tempRoot, "builds");
  const repositoryRoot = join(tempRoot, "repository");
  const logPath = join(buildDir, projectId, "run.log");
  const agentFile = join(repositoryRoot, "agents", "qa", "navya", "src", "index.ts");
  const previousBuildDir = process.env.BUILD_DIR;
  const committed: Array<{ agentFilePath: string; agentName: string }> = [];
  let chatCalls = 0;

  try {
    process.env.BUILD_DIR = join(tempRoot, "unused-builds");
    mkdirSync(join(buildDir, projectId), { recursive: true });
    mkdirSync(join(repositoryRoot, "agents", "qa", "navya", "src"), { recursive: true });
    writeFileSync(
      logPath,
      "Some logs here...\n[instinct-mismatch] agent navya submitted 0 findings but later stage found CRITICAL: Task modal fails to submit with button clicks\nMore logs...",
      "utf-8",
    );
    writeFileSync(
      agentFile,
      'export const QA_SYSTEM_PROMPT = `You are Navya...`;\nconst config = {\n  reviewFocus: "logic errors",\n};\n',
      "utf-8",
    );

    await runMetaSupervisor(projectId, {
      buildDir,
      repositoryRoot,
      chat: async () => {
        chatCalls++;
        return {
          content: JSON.stringify({
            reviewFocus: "logic errors AND task submission validation",
            QA_SYSTEM_PROMPT: "You are Navya, optimized prompt...",
          }),
        };
      },
      commitAgent: async (agentFilePath, agentName) => {
        committed.push({ agentFilePath, agentName });
      },
    });

    const updatedContent = readFileSync(agentFile, "utf-8");
    expect(updatedContent).toContain("logic errors AND task submission validation");
    expect(updatedContent).toContain("You are Navya, optimized prompt...");
    expect(chatCalls).toBe(1);
    expect(committed).toEqual([{ agentFilePath: agentFile, agentName: "navya" }]);
  } finally {
    if (previousBuildDir === undefined) delete process.env.BUILD_DIR;
    else process.env.BUILD_DIR = previousBuildDir;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
