import type { GeminiMessage } from "@nexsidi/llm-client";

// Deterministic generator-agent-style Gemini history (aanya/shubham shape
// from the 2026-09-26 replay): the same few files rewritten over and over
// with large content, long model text, and one UNRESOLVED error early on.
// The middle's floor is dominated by write_file args and text, which is why
// the first triage version lost every error in these histories.

export const GENERATOR_TASK = "Build the backend: tasks CRUD with due dates, auth, and migrations.";
export const TURN3_ERROR = { status: "error", summary: "npx tsc --noEmit: src/routes/tasks.ts(12,5): error TS2322: Type 'string' is not assignable to type 'Date'." };

export function buildGeneratorHistory(turnCount: number, opts: { contentChars?: number; textChars?: number } = {}): GeminiMessage[] {
  const contentChars = opts.contentChars ?? 20_000;
  const textChars = opts.textChars ?? 1_500;
  const files = ["src/routes/tasks.ts", "src/routes/auth.ts", "src/db/schema.ts", "src/index.ts", "src/middleware/auth.ts"];
  const messages: GeminiMessage[] = [
    { role: "system", content: "You are the backend generator." },
    { role: "user", content: GENERATOR_TASK },
  ];
  for (let i = 0; i < turnCount; i++) {
    let name: string;
    let args: Record<string, unknown>;
    let response: Record<string, unknown>;
    if (i === 3) {
      name = "run_command";
      args = { command: "npx tsc --noEmit" };
      response = { ...TURN3_ERROR };
    } else if (i % 6 === 5) {
      name = "run_command";
      args = { command: `npm test -- --run ${i}` };
      response = { status: "success", output: `ok ${i}` };
    } else {
      const path = files[i % files.length]!;
      name = "write_file";
      args = { path, content: `// ${path} v${i}\n${"x".repeat(contentChars)}` };
      response = { status: "success", summary: `wrote ${path}` };
    }
    messages.push({ role: "model", content: [{ text: `Turn ${i}: ${"reasoning ".repeat(Math.ceil(textChars / 10)).slice(0, textChars)}` }, { functionCall: { name, args } }] });
    messages.push({ role: "user", content: [{ functionResponse: { name, response } }] });
  }
  return messages;
}
