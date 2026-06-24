// Shubham — code generator agent (Qwen2.5-Coder 7B via local Ollama)
// Runs in an isolated git worktree during parallel generation phase.
import { agentChat } from "@nexsidi/llm-client";

export async function run(projectId: string, tasks: string[]): Promise<void> {
  const { content } = await agentChat(
    "shubham",
    [
      { role: "system", content: "You are a senior shubham developer. Generate production-quality code only. No explanations." },
      { role: "user", content: JSON.stringify({ projectId, tasks }) },
    ],
    process.env.NIM_API_KEY ?? "",
  );
  // TODO Phase 1: write generated files to worktree
  console.log("[shubham]", content.slice(0, 100));
}
