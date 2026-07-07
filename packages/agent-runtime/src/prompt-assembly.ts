// Phase 5 Task 6 (final-bundle/phase5-harness-enforcement-plan.md): skills
// injected into every agent's system prompt at runtime, provider-agnostic.
// Fixed layering order: core-reasoning doctrine -> agent's own doctrine (if
// any) -> agent basePrompt -> task context. Doctrine files are checked-in
// copies under packages/agent-runtime/skills/ (single source synced from
// the skills repo zip by Task 8's sync-skills.ts) — an agent with no
// doctrine file just gets core-reasoning + base, never a throw.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dir, "..", "skills");

function loadDoctrine(name: string): string {
  try {
    return readFileSync(join(SKILLS_DIR, `${name}.md`), "utf-8").trim();
  } catch {
    return "";
  }
}

// Rough token estimate (chars/4) — exact tokenization is provider-specific
// and this module must stay provider-agnostic (nexsidi-token-budget rule).
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export interface AssembleSystemPromptArgs {
  agentName: string;
  basePrompt: string;
  taskContext?: string;
  contextBudgetTokens?: number;
}

export function assembleSystemPrompt(args: AssembleSystemPromptArgs): string {
  const coreReasoning = loadDoctrine("core-reasoning");
  const agentDoctrine = loadDoctrine(args.agentName);
  const basePrompt = args.basePrompt;
  let taskContext = args.taskContext ?? "";

  if (args.contextBudgetTokens !== undefined) {
    // Protected, never trimmed: core-reasoning (foundational discipline) and
    // basePrompt (the agent's locked instructions). Trim order: task
    // context first, agent doctrine second.
    const protectedTokens = estimateTokens(coreReasoning) + estimateTokens(basePrompt);
    let remaining = args.contextBudgetTokens - protectedTokens;

    if (remaining <= 0) {
      taskContext = "";
      // No budget left even for doctrine.
      return [coreReasoning, basePrompt].filter(Boolean).join("\n\n");
    }

    if (estimateTokens(taskContext) > remaining) {
      taskContext = trimToTokens(taskContext, remaining);
      remaining = 0;
    } else {
      remaining -= estimateTokens(taskContext);
    }

    const trimmedDoctrine = estimateTokens(agentDoctrine) > remaining ? trimToTokens(agentDoctrine, remaining) : agentDoctrine;
    return [coreReasoning, trimmedDoctrine, basePrompt, taskContext].filter(Boolean).join("\n\n");
  }

  return [coreReasoning, agentDoctrine, basePrompt, taskContext].filter(Boolean).join("\n\n");
}
