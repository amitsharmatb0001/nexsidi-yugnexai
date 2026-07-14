import { expect, test, mock, spyOn } from "bun:test";
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runMetaSupervisor } from "./meta-supervisor.ts";

test("meta-supervisor parses logs, invokes LLM, and patches file", async () => {
  const projectId = "test-project-999";
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const projectBuildDir = join(buildDir, projectId);
  
  mkdirSync(projectBuildDir, { recursive: true });
  
  const logPath = join(projectBuildDir, "run.log");
  writeFileSync(
    logPath,
    `Some logs here...\n[instinct-mismatch] agent navya submitted 0 findings but later stage found CRITICAL: Task modal fails to submit with button clicks\nMore logs...`,
    "utf-8"
  );

  // Setup mock agent file
  const agentDir = join(process.cwd(), "agents", "qa", "navya", "src");
  mkdirSync(agentDir, { recursive: true });
  const agentFile = join(agentDir, "index.ts");
  
  const originalAgentContent = `
export const QA_SYSTEM_PROMPT = \`You are Navya...\`;
const config = {
  reviewFocus: "logic errors",
};
`;
  writeFileSync(agentFile, originalAgentContent, "utf-8");

  // Mock geminiChat call
  mock.module("@nexsidi/llm-client", () => {
    return {
      geminiChat: async () => {
        return {
          content: JSON.stringify({
            reviewFocus: "logic errors AND task submission validation",
            QA_SYSTEM_PROMPT: "You are Navya, optimized prompt..."
          })
        };
      }
    };
  });

  // Spy on git commands to avoid executing real git commands in tests
  const childProcess = await import("node:child_process");
  const execSyncSpy = spyOn(childProcess, "execSync").mockImplementation(() => Buffer.from("mocked execSync"));

  await runMetaSupervisor(projectId);

  // Assertions
  const updatedContent = readFileSync(agentFile, "utf-8");
  expect(updatedContent).toContain("logic errors AND task submission validation");
  expect(updatedContent).toContain("You are Navya, optimized prompt...");
  expect(execSyncSpy).toHaveBeenCalled();

  // Cleanup
  rmSync(logPath, { force: true });
  writeFileSync(agentFile, originalAgentContent, "utf-8");
});
