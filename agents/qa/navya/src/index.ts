import { agentChat } from "@nexsidi/llm-client";
import { runQAAgent, type LabeledDir } from "../../../../packages/agent-runtime/src/qa-loop.ts";

export interface QAResult {
  agent: string;
  score: number;
  passed: boolean;
  findings: Finding[];
}

export interface Finding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  detail: string;
  file?: string;
  line?: number; // P2: exact line so fixes target a location, not a whole-file re-scan
}

export interface NavyaDeps {
  chat: typeof agentChat;
}

export interface NavyaExploringDeps {
  runAgent: typeof runQAAgent;
}

export async function run(
  projectId: string,
  iteration: number,
  code: string,
  deps: NavyaDeps = { chat: agentChat },
): Promise<QAResult> {
  const messages = [
    { role: "system" as const, content: QA_SYSTEM_PROMPT },
    { role: "user" as const, content: JSON.stringify({ projectId, iteration, code }) },
  ];
  const apiKey = process.env.NIM_API_KEY ?? "";
  const options = { maxTokens: 16000 };

  const { content: first } = await deps.chat("navya", messages, apiKey, options);
  let content = first;
  const firstResult = parseAndScoreFindings(first);
  if (first.trim() === "" || firstResult.findings[0]?.category === "parse-failure") {
    console.log("[navya] first attempt returned empty or unparseable content — retrying once");
    const { content: second } = await deps.chat("navya", messages, apiKey, options);
    content = second;
  }

  return { agent: "navya", ...parseAndScoreFindings(content) };
}

export async function runExploring(
  projectId: string,
  dirs: LabeledDir[],
  deps: NavyaExploringDeps = { runAgent: runQAAgent },
  // F5 (agent-autonomy-assessment): the spec/API-contract/DB-schema this
  // codebase should implement — see qa-loop.test.ts for why QA judging code
  // shape alone (no intent) produces cheap false positives every round.
  systemContext?: string,
): Promise<QAResult> {
  const result = await deps.runAgent({
    agentName: "navya",
    systemPrompt: QA_SYSTEM_PROMPT,
    reviewFocus: "logic errors (null references, invalid state transitions, algorithm flaws, race conditions, and API/type contract mismatches)",
    dirs,
    systemContext,
    // Cost-control plan Task 3: shares one FileReadCache with Karan/Deepika
    // for this same round (all three are dispatched with the same
    // projectId — see stage5-adversarial-qa.ts's runStage5WithAgents, which
    // clears the cache before dispatching them).
    projectId,
  });

  const hasFatalError = result.errors.some(
    (error) =>
      !error.includes("Max iterations") &&
      !error.includes("stopped without calling submit_findings") &&
      !error.includes("Stuck:"),
  );
  if (result.findings.length === 0 && hasFatalError) {
    return {
      agent: "navya",
      score: 0,
      passed: false,
      findings: [
        {
          severity: "CRITICAL",
          category: "review-incomplete",
          detail: `Navya's review did not complete: ${result.errors.join("; ")}`,
        },
      ],
    };
  }

  const score = scoreFindings(result.findings);
  return { agent: "navya", score, passed: score >= 85, findings: result.findings };
}

function stripMarkdownFences(content: string): string {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1]! : trimmed;
}

function scoreFindings(findings: Finding[]): number {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return Math.max(
    0,
    100 - counts.CRITICAL * 20 - counts.HIGH * 10 - counts.MEDIUM * 5 - counts.LOW,
  );
}

export function parseAndScoreFindings(content: string): {
  score: number;
  passed: boolean;
  findings: Finding[];
} {
  let findings: Finding[];
  try {
    const parsed = JSON.parse(stripMarkdownFences(content)) as { findings?: unknown[] } | unknown[];
    const raw = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
    if (!Array.isArray(raw)) throw new Error("findings is not an array");
    findings = raw.map((entry): Finding => {
      const item = entry as Record<string, unknown>;
      const severity = item.severity;
      const validSeverity =
        severity === "CRITICAL" || severity === "HIGH" || severity === "MEDIUM" || severity === "LOW"
          ? severity
          : "MEDIUM";
      return {
        severity: validSeverity,
        category: typeof item.category === "string" ? item.category : "unspecified",
        detail: typeof item.detail === "string" ? item.detail : "unspecified finding",
        file: typeof item.file === "string" ? item.file : undefined,
        line: typeof item.line === "number" ? item.line : undefined,
      };
    });
  } catch {
    return {
      score: 0,
      passed: false,
      findings: [
        {
          severity: "CRITICAL",
          category: "parse-failure",
          detail: `Navya's output could not be parsed as JSON — treating the review as incomplete per the default-FAIL contract. Raw output: ${content.slice(0, 200)}`,
        },
      ],
    };
  }

  const score = scoreFindings(findings);
  return { score, passed: score >= 85, findings };
}

export const QA_SYSTEM_PROMPT = `You are Navya, an adversarial logic QA engineer. Your job is to maximize error detection, NOT to confirm correctness and NOT to suggest fixes.
Hunt specifically for: null or undefined dereferences, invalid state transitions, algorithm flaws, race conditions, unreachable branches, and mismatches between API, database, and TypeScript contracts.
EVIDENCE RULE: report a finding only when you can cite the concrete code path, triggering input or interleaving, and resulting incorrect behavior. Do not infer a defect merely because a familiar pattern is present. If you cannot establish the failure path from the code, do not report it.
Whenever you cite a file, also cite the exact line number the issue is on (from read_file's output) — this is what lets the fix target that line directly instead of re-scanning the whole file.
Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1). Pass threshold is 85 — this is computed by the caller, not by you.
Output ONLY valid JSON with quoted keys, exactly this shape: {"findings": [{"severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "category": string, "detail": string, "file": string, "line": number}]}
If the code has no logic issues at all, output: {"findings": []}`;
