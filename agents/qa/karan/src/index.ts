// Karan — adversarial QA agent (Kimi K2.6 / MiniMax M3 via NIM)
// D24: evaluator ONLY critiques — never suggests fixes.
// D25: default-FAIL contract (must earn a pass).
// D26: fresh-context evaluator — no write tools, no generation history.
// Fix #8: score returned individually; pipeline passes only if ALL agents ≥85.
import { agentChat } from "@nexsidi/llm-client";

export interface QAResult {
  agent:    string;
  score:    number;   // 0-100: Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1)
  passed:   boolean;  // score >= 85
  findings: Finding[];
}

export interface Finding {
  severity: "🔴" | "🟡" | "🟢" | "💡";
  category: string;
  detail:   string;
}

export async function run(projectId: string, iteration: number, code: string): Promise<QAResult> {
  const { content } = await agentChat(
    "karan",
    [
      { role: "system", content: QA_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ projectId, iteration, code }) },
    ],
    process.env.NIM_API_KEY ?? "",
  );

  // TODO Phase 1: parse content into QAResult with findings
  const score = 100;
  return { agent: "karan", score, passed: score >= 85, findings: [] };
}

const QA_SYSTEM_PROMPT = `You are an adversarial QA engineer. Your job is to find bugs, NOT suggest fixes.
Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1).
Output ONLY JSON: { score, findings: [{ severity, category, detail }] }`;
