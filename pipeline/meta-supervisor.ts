import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { geminiChat } from "@nexsidi/llm-client";

export interface MetaSupervisorDeps {
  buildDir?: string;
  repositoryRoot?: string;
  chat?: typeof geminiChat;
  commitAgent?: (agentFilePath: string, agentName: string) => void | Promise<void>;
}

function commitAgentWithGit(agentFilePath: string, agentName: string): void {
  execFileSync("git", ["add", "--", agentFilePath], { stdio: "inherit" });
  execFileSync(
    "git",
    ["commit", "-m", `chore(qa-rules): meta-supervisor optimized system prompt for ${agentName} to address missed finding`],
    { stdio: "inherit" },
  );
}

export async function runMetaSupervisor(projectId: string, deps: MetaSupervisorDeps = {}): Promise<void> {
  const buildDir = deps.buildDir ?? process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const repositoryRoot = deps.repositoryRoot ?? process.cwd();
  const chat = deps.chat ?? geminiChat;
  const commitAgent = deps.commitAgent ?? commitAgentWithGit;
  const logPath = join(buildDir, projectId, "run.log");
  if (!existsSync(logPath)) {
    console.log(`[meta-supervisor] No run log found at ${logPath}`);
    return;
  }

  const logContent = readFileSync(logPath, "utf-8");
  const regex = /\[instinct-mismatch\] agent (\w+) submitted 0 findings but later stage found CRITICAL: (.*)/g;
  let match;
  const mismatches: { agentName: string; missedFinding: string }[] = [];

  while ((match = regex.exec(logContent)) !== null) {
    const agentName = match[1]!;
    const missedFinding = match[2]!.trim();
    mismatches.push({ agentName, missedFinding });
  }

  if (mismatches.length === 0) {
    console.log(`[meta-supervisor] No agent-submission mismatches found in log`);
    return;
  }

  console.log(`[meta-supervisor] Found ${mismatches.length} mismatches to process`);

  for (const { agentName, missedFinding } of mismatches) {
    const agentFilePath = join(repositoryRoot, "agents", "qa", agentName, "src", "index.ts");
    if (!existsSync(agentFilePath)) {
      console.warn(`[meta-supervisor] Agent file does not exist: ${agentFilePath}`);
      continue;
    }

    let fileContent = readFileSync(agentFilePath, "utf-8");

    // Extract current reviewFocus
    const reviewFocusMatch = fileContent.match(/reviewFocus:\s*"(.*?)"/s) || fileContent.match(/reviewFocus:\s*`(.*?)`/s);
    const currentReviewFocus = reviewFocusMatch ? reviewFocusMatch[1] : "";

    // Extract current QA_SYSTEM_PROMPT
    const promptMatch = fileContent.match(/export const QA_SYSTEM_PROMPT = `([\s\S]*?)`;/);
    const currentPrompt = promptMatch ? promptMatch[1] : "";

    if (!currentReviewFocus && !currentPrompt) {
      console.warn(`[meta-supervisor] Could not find reviewFocus or QA_SYSTEM_PROMPT in ${agentFilePath}`);
      continue;
    }

    const llmPrompt = `You are a supervisor optimizing system prompts for the adversarial QA agent "${agentName}".
The agent recently reviewed a codebase and submitted 0 findings, but a later stage found the following CRITICAL defect:
"${missedFinding}"

Here is the current "reviewFocus" definition:
---
${currentReviewFocus}
---

Here is the current "QA_SYSTEM_PROMPT" definition:
---
${currentPrompt}
---

Explain why this defect was missed, and write an improved version of both reviewFocus and QA_SYSTEM_PROMPT that explicitly instructs the agent to detect this type of issue.
Output ONLY a valid JSON object matching this exact schema, with no markdown code blocks:
{
  "reviewFocus": "improved reviewFocus string...",
  "QA_SYSTEM_PROMPT": "improved QA_SYSTEM_PROMPT string..."
}
`;

    try {
      console.log(`[meta-supervisor] Invoking LLM to optimize prompt for ${agentName} to address: "${missedFinding}"`);
      const response = await chat([{ role: "user", content: llmPrompt }]);
      let text = response.content.trim();
      
      // Strip markdown code fences if LLM wrapped it
      if (text.startsWith("```")) {
        const match = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
        if (match) text = match[1]!;
      }

      const parsed = JSON.parse(text) as { reviewFocus: string; QA_SYSTEM_PROMPT: string };
      
      let updated = false;
      if (parsed.reviewFocus && currentReviewFocus) {
        fileContent = fileContent.replace(currentReviewFocus, parsed.reviewFocus);
        updated = true;
      }
      if (parsed.QA_SYSTEM_PROMPT && currentPrompt) {
        fileContent = fileContent.replace(currentPrompt, parsed.QA_SYSTEM_PROMPT);
        updated = true;
      }

      if (updated) {
        writeFileSync(agentFilePath, fileContent, "utf-8");
        console.log(`[meta-supervisor] Patched ${agentFilePath} successfully`);

        // Git commit
        try {
          await commitAgent(agentFilePath, agentName);
          console.log(`[meta-supervisor] Git committed changes for ${agentName}`);
        } catch (gitErr) {
          console.error(`[meta-supervisor] Git commit failed: ${String(gitErr)}`);
        }
      }
    } catch (err) {
      console.error(`[meta-supervisor] Failed to optimize prompt for ${agentName}: ${String(err)}`);
    }
  }
}
