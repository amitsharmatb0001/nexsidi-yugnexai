// Checks a Gemini model before the pipeline relies on it. Costs a few cents at most.
//
//   bun scripts/probe-gemini-model.ts                      # gemini-4-argon
//   bun scripts/probe-gemini-model.ts gemini-3.8-flash     # any other model, for comparison
//
// Five checks, each printed as PASS or FAIL with the reason:
//   1 it answers a plain question                      (the project and billing allow the model at all)
//   2 it follows a strict "answer only with JSON"      (the planners depend on this)
//   3 it makes a tool call when a tool is needed       (every agent loop depends on this)
//   4 it accepts a conversation that ends on its own turn, or fails in a way we can see
//                                                      (gemini-3.6 to 3.8-flash answer 400 here)
//   5 it keeps working at thinking level HIGH          (the critical tier asks for it)
// Exit code 0 only if checks 1 to 3 and 5 pass. Check 4 is reported but does not fail the probe: it only decides whether the
// loop must avoid ending a conversation on a model turn, which it already does.
import { geminiChat, geminiChatWithTools, type GeminiMessage } from "../packages/llm-client/src/gemini.ts";

const model = process.argv[2] ?? "gemini-4-argon";
let failed = 0;

async function check(name: string, required: boolean, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name} (${Date.now() - t0} ms) ${detail}`);
  } catch (err) {
    const s = String(err instanceof Error ? err.message : err);
    const reason = /BILLING_DISABLED/.test(s) ? "billing is disabled on the Google project" : /404/.test(s) ? "model not found for this project or region" : /429/.test(s) ? "rate limited" : s.slice(0, 200);
    console.log(`${required ? "FAIL" : "NOTE"}  ${name} (${Date.now() - t0} ms) ${reason}`);
    if (required) failed++;
  }
}

await check("1 plain answer", true, async () => {
  const r = await geminiChat([{ role: "user", content: "Reply with exactly the word: ready" }], { model, maxTokens: 2000, thinkingLevel: "LOW" });
  if (!/ready/i.test(r.content)) throw new Error(`unexpected answer ${JSON.stringify(r.content.slice(0, 60))}`);
  return JSON.stringify(r.content.trim().slice(0, 30));
});

await check("2 strict JSON answer", true, async () => {
  const r = await geminiChat([{ role: "user", content: 'Answer ONLY with JSON, no other text: {"sum": <2+3>, "word": "ok"}' }], { model, maxTokens: 2000, thinkingLevel: "MEDIUM" });
  const text = r.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(text);
  if (parsed.sum !== 5) throw new Error(`wrong sum in ${text.slice(0, 80)}`);
  return text.slice(0, 40);
});

await check("3 tool call", true, async () => {
  const r = await geminiChatWithTools(
    [{ role: "user", content: "What is the weather in Jaipur? Use the tool." }],
    [{ name: "get_weather", description: "Weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    { model, thinkingLevel: "MEDIUM" },
  );
  const call = r.toolCalls[0];
  if (!call || call.name !== "get_weather") throw new Error(`no tool call (answered ${JSON.stringify(r.content.slice(0, 60))})`);
  return `${call.name}(${JSON.stringify(call.input)})`;
});

await check("4 conversation ending on a model turn", false, async () => {
  const messages: GeminiMessage[] = [
    { role: "user", content: "Say hello." },
    { role: "model", content: "Hello." },
  ];
  const r = await geminiChatWithTools(messages, [{ name: "noop", description: "does nothing", parameters: { type: "object", properties: {} } }], { model, thinkingLevel: "LOW" });
  return `accepted (${JSON.stringify(r.content.slice(0, 30))}); the loop need not work around it`;
});

await check("5 thinking level HIGH", true, async () => {
  const r = await geminiChat([{ role: "user", content: "A bat and ball cost 1.10 together; the bat costs 1.00 more than the ball. How many cents is the ball? Answer with just the number." }], { model, maxTokens: 4000, thinkingLevel: "HIGH" });
  if (!/\b5\b/.test(r.content)) throw new Error(`expected 5, got ${JSON.stringify(r.content.slice(0, 60))}`);
  return JSON.stringify(r.content.trim().slice(0, 30));
});

console.log(failed === 0 ? `\n${model}: ready to use.` : `\n${model}: ${failed} required check(s) failed; do not rely on it yet.`);
process.exit(failed === 0 ? 0 : 1);
