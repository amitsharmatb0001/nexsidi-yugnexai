// Which Claude models does THIS project have real quota for on Vertex?
// Quota API says opus-4-1 and sonnet-4 have 15k tokens/min at us-east5.
// Verify live against each candidate.
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

const candidates = [
  "claude-sonnet-5",
  "claude-opus-4-1",
  "claude-sonnet-4",
];

const client = new AnthropicVertex({ projectId: "ai-yug", region: "us-east5" });

for (const model of candidates) {
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 30,
      messages: [{ role: "user", content: "Say hi in exactly 3 words." }],
    });
    const text = msg.content.find((b) => b.type === "text");
    console.log(`OK    ${model} → ${text && "text" in text ? JSON.stringify(text.text) : "(no text)"}`);
  } catch (err) {
    const s = String(err);
    console.log(`FAIL  ${model} → ${s.slice(0, 180)}`);
  }
}
