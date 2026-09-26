import type { GeminiMessage } from "@nexsidi/llm-client";

// Deterministic QA-evidence-style Gemini history for compaction tests: the
// shape the real QA agents produce (browser/http/docker/read calls, fact
// ledger stays empty), with one UNRESOLVED error at turn 5 that today's
// compaction drops once turn 5 leaves the trailing window.

export const QA_TASK = "Collect evidence that sign-up, task creation and persistence work at http://localhost:3201.";
export const TURN5_ERROR = { status: "error", summary: 'POST /api/tasks -> 500 Internal Server Error: column "due_date" does not exist' };

export function buildQaHistory(turnCount: number, opts: { outputChars?: number; systemChars?: number } = {}): GeminiMessage[] {
  const outputChars = opts.outputChars ?? 6_000;
  const filler = (label: string) => `${label} `.repeat(Math.ceil(outputChars / (label.length + 1))).slice(0, outputChars);
  const messages: GeminiMessage[] = [
    { role: "system", content: `You are the QA evidence collector.${" ".repeat(opts.systemChars ?? 0)}` },
    { role: "user", content: QA_TASK },
  ];
  for (let i = 0; i < turnCount; i++) {
    let name: string;
    let args: Record<string, unknown>;
    let response: Record<string, unknown>;
    if (i === 5) {
      name = "http_request";
      args = { method: "POST", url: "http://localhost:3001/api/tasks", body: "{}" };
      response = { ...TURN5_ERROR };
    } else if (i % 4 === 0) {
      name = "read_file";
      args = { path: `frontend/app/page-${i % 12}.tsx` };
      response = { status: "success", output: filler(`page-${i % 12}`) };
    } else if (i % 4 === 1) {
      name = "http_request";
      args = { method: "GET", url: `http://localhost:3001/api/items/${i}` };
      response = { status: "success", output: filler(`item-${i}`) };
    } else if (i % 4 === 2) {
      name = "docker_compose";
      args = { action: "logs", service: "backend" };
      response = { status: "success", output: filler(`log-${i}`) };
    } else {
      name = "browser_get_text";
      args = { selector: "main", page: i % 5 };
      response = { status: "success", output: filler(`text-${i}`) };
    }
    messages.push({ role: "model", content: [{ text: `Step ${i}: checking ${name}.` }, { functionCall: { name, args } }] });
    messages.push({ role: "user", content: [{ functionResponse: { name, response } }] });
  }
  return messages;
}
