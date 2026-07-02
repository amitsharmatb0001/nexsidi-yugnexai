// Karan — adversarial QA agent (Kimi K2.6 / MiniMax M3 via NIM)
// D24: evaluator ONLY critiques — never suggests fixes.
// D25: default-FAIL contract (must earn a pass).
// D26: fresh-context evaluator — no write tools, no generation history.
// Fix #8: score returned individually; pipeline passes only if ALL agents ≥85.
//
// ── Finding/QAResult type resolution (Task 12) ──────────────────────────────
// Karan's security scoring is zero-tolerance (scoreSecurityFindings below,
// built in Task 9), NOT the severity-weighted ≥85 score Navya/Deepika use —
// those are two deliberately different scoring systems (design doc Stage 5,
// never to be mixed). scoreSecurityFindings takes SecurityFinding[]
// (severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", description: string), but
// run() used to return a DIFFERENT, generic emoji-severity Finding[] shape
// (severity: "🔴"|"🟡"|"🟢"|"💡", category, detail) hardcoded to `[]` — a
// placeholder that was never actually wired to scoreSecurityFindings.
//
// Resolution: run() now returns SecurityFinding[] directly — the shape the
// real scorer consumes — instead of the generic emoji shape. Checked via a
// repo-wide grep before making this change: the emoji Finding/QAResult pair
// Karan previously exported was never imported anywhere outside this file
// (Navya and Deepika each define their OWN separate copy of the same-shaped
// types locally in their own files — those are untouched by this change).
// Retiring Karan's copy here is safe; nothing else depended on it.
import { agentChat } from "@nexsidi/llm-client";

export interface SecurityFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  file?: string; // best-effort file path — lets Stage 5 fault-isolate to the responsible agent
}

export interface QAResult {
  agent:    string;
  score:    number;   // 100 if scoreSecurityFindings passed, 0 otherwise — zero-tolerance, not weighted
  passed:   boolean;  // mirrors scoreSecurityFindings(...).pass
  findings: SecurityFinding[];
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

  const findings = parseSecurityFindings(content);
  const { pass } = scoreSecurityFindings(findings);
  return { agent: "karan", score: pass ? 100 : 0, passed: pass, findings };
}

// D25 default-FAIL: if Karan's response isn't valid JSON, that is NOT
// evidence of "no vulnerabilities" — treat it as a (synthetic) finding so
// the zero-tolerance gate still blocks rather than silently passing on a
// parse failure.
function parseSecurityFindings(content: string): SecurityFinding[] {
  try {
    const parsed = JSON.parse(content) as { findings?: unknown[] } | unknown[];
    const raw = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
    if (!Array.isArray(raw)) throw new Error("findings is not an array");
    return raw.map((entry): SecurityFinding => {
      const r = entry as Record<string, unknown>;
      const severity = r.severity;
      const validSeverity =
        severity === "CRITICAL" || severity === "HIGH" || severity === "MEDIUM" || severity === "LOW"
          ? severity
          : "MEDIUM"; // unknown severity from the model — assume MEDIUM rather than dropping the finding
      return {
        severity: validSeverity,
        description: typeof r.description === "string" ? r.description : String(r.detail ?? "unspecified finding"),
        file: typeof r.file === "string" ? r.file : undefined,
      };
    });
  } catch {
    return [
      {
        severity: "CRITICAL",
        description: `Karan's output could not be parsed as JSON — treating as a potential vulnerability per D25 default-FAIL. Raw output: ${content.slice(0, 200)}`,
      },
    ];
  }
}

const QA_SYSTEM_PROMPT = `You are Karan, an adversarial security QA engineer (OWASP-focused). Your job is to find vulnerabilities, NOT suggest fixes.
Zero-tolerance policy: ANY finding blocks release, regardless of severity — there is no passing score to earn, only "vulnerabilities found" or "none found".
Output ONLY JSON: { findings: [{ severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", description: string, file: string }] }
If the code has no vulnerabilities at all, output: { findings: [] }`;

// Zero-tolerance: unlike Navya/Deepika's severity-weighted ≥85 score, ANY
// security finding blocks — matches the design doc's "0.1% tolerance" policy.
export function scoreSecurityFindings(findings: SecurityFinding[]): { pass: boolean; reason: string } {
  if (findings.length === 0) {
    return { pass: true, reason: "No vulnerabilities found" };
  }
  return { pass: false, reason: `${findings.length} vulnerabilit${findings.length === 1 ? "y" : "ies"} found — zero-tolerance policy blocks any finding` };
}
