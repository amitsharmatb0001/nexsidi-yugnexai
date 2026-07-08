// 2026-07-08: after 10-20 stress-test runs, the pipeline still wasn't
// clearing a basic app's QA gate. Root cause: Shubham/Aanya only ever got a
// stronger model's eyes on their code AFTER the cheap NIM tier failed
// OUTRIGHT (runAgentEscalated only escalates on success:false). Code NIM
// "succeeded" at — passed tsc, called task_complete — but was still
// insecure (e.g. a SQL injection in a dynamic UPDATE query) never got
// reviewed by a stronger model at all, since escalation only fires on
// failure, not on subtly-bad success. GENERATOR_TIER=gemini routes
// GENERATION itself (not just escalation) through Gemini directly for
// these two agents — same override pattern as ESCALATION_PROVIDER
// (claude-loop.ts's resolveEscalationRunner).
import { runAgentEscalated } from "./claude-loop.ts";
import { runAgentWithGemini } from "./gemini-loop.ts";
import type { AgentRunConfig, AgentRunResult } from "./loop.ts";

export type GeneratorRunner = (config: AgentRunConfig) => Promise<AgentRunResult & { escalated: boolean }>;

async function runGeminiDirect(config: AgentRunConfig): Promise<AgentRunResult & { escalated: boolean }> {
  const result = await runAgentWithGemini(config);
  return { ...result, escalated: false };
}

export function resolveGeneratorRunner(): GeneratorRunner {
  return process.env.GENERATOR_TIER === "gemini" ? runGeminiDirect : runAgentEscalated;
}
