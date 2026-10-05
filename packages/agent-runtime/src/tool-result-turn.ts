import type { GeminiMessage, GeminiPart } from "@nexsidi/llm-client";

// The turn that answers a model's function calls must hold the functionResponse parts and nothing else on
// gemini-3.6/3.7/3.8-flash (measured 2026-10-05: any extra text or image part in that turn is a 400). A screenshot
// and the step notices go in their own user turn right after it, which every model in the pool accepts.
export function splitToolResultTurn(parts: GeminiPart[]): GeminiMessage[] {
  const responses = parts.filter((p) => "functionResponse" in p);
  const extras = parts.filter((p) => !("functionResponse" in p));
  if (responses.length === 0) return [{ role: "user", content: parts }];
  const out: GeminiMessage[] = [{ role: "user", content: responses }];
  if (extras.length > 0) out.push({ role: "user", content: extras });
  return out;
}
