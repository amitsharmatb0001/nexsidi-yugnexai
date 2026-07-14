import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { selectRecurringInstructionUpdates, type InstinctObservation } from "../packages/agent-runtime/src/instinct-observer.ts";
import { geminiChat } from "@nexsidi/llm-client";

export async function runInstinctCron(): Promise<void> {
  const obsPath = join(homedir(), ".local", "share", "nexsidi-instincts", "observations.jsonl");
  if (!existsSync(obsPath)) {
    console.log(`[instinct-cron] No observations file found at ${obsPath}`);
    return;
  }

  const lines = readFileSync(obsPath, "utf-8").trim().split("\n").filter(Boolean);
  const lastLines = lines.slice(-50);
  const observations = lastLines.map(l => JSON.parse(l) as InstinctObservation);

  const recurringUpdates = selectRecurringInstructionUpdates(observations);

  if (recurringUpdates.length === 0) {
    console.log(`[instinct-cron] No recurring mismatches (occurrences >= 2) found`);
    return;
  }

  console.log(`[instinct-cron] Found ${recurringUpdates.length} recurring mismatches to update`);

  for (const update of recurringUpdates) {
    const { agentName, missedFinding, occurrences } = update;
    const skillPath = join(process.cwd(), "packages", "agent-runtime", "skills", `${agentName}.md`);
    if (!existsSync(skillPath)) {
      console.warn(`[instinct-cron] Skill file does not exist: ${skillPath}`);
      continue;
    }

    const skillContent = readFileSync(skillPath, "utf-8");

    const prompt = `You are a senior developer supervisor optimizing instructions for the AI developer/QA agent "${agentName}".
This agent repeatedly missed the following issue during code reviews/generations:
"${missedFinding}" (missed ${occurrences} times).

Here is the current instruction file for "${agentName}":
---
${skillContent}
---

Update this instruction file to add a specific rule in the Rules section instructing the agent on how to prevent and catch this issue. Output the updated markdown file content in full. Do not wrap the output in markdown code blocks or add any introductory text. Respond only with the updated file content.
`;

    try {
      console.log(`[instinct-cron] Requesting LLM instruction update for ${agentName} (missed ${occurrences} times)`);
      const response = await geminiChat([{ role: "user", content: prompt }]);
      let updatedContent = response.content.trim();

      // Strip markdown code fences if LLM wrapped it
      if (updatedContent.startsWith("```")) {
        const match = updatedContent.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n?```$/);
        if (match) updatedContent = match[1]!;
      }

      if (updatedContent && updatedContent.length > 10) {
        writeFileSync(skillPath, updatedContent, "utf-8");
        console.log(`[instinct-cron] Updated skill file: ${skillPath}`);

        // Git commit
        try {
          execSync(`git add ${skillPath}`, { stdio: "inherit" });
          execSync(`git commit -m "chore(instinct-cron): update instruction file for ${agentName} to prevent recurring missed findings"`, { stdio: "inherit" });
          console.log(`[instinct-cron] Git committed skill changes for ${agentName}`);
        } catch (gitErr) {
          console.error(`[instinct-cron] Git commit failed: ${String(gitErr)}`);
        }
      }
    } catch (err) {
      console.error(`[instinct-cron] Failed to process update for ${agentName}: ${String(err)}`);
    }
  }
}

// Self-execute if run directly
if (import.meta.main || (process.argv[1] && process.argv[1].includes("instinct-cron"))) {
  runInstinctCron().catch(err => {
    console.error("[instinct-cron] Failed running script:", err);
  });
}
