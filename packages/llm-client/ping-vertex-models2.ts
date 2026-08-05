import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

const combos: Array<{ model: string; region: string }> = [
  { model: "claude-sonnet-5", region: "global" },
  { model: "claude-opus-4-1@20250805", region: "global" },
  { model: "claude-opus-4-1@20250805", region: "us-east5" },
  { model: "claude-sonnet-4@20250514", region: "global" },
];

for (const { model, region } of combos) {
  const client = new AnthropicVertex({ projectId: "ai-yug", region });
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 30,
      messages: [{ role: "user", content: "Say hi in exactly 3 words." }],
    });
    const text = msg.content.find((b) => b.type === "text");
    console.log(`OK    ${model} @ ${region} → ${text && "text" in text ? JSON.stringify(text.text) : "(no text)"}`);
  } catch (err) {
    console.log(`FAIL  ${model} @ ${region} → ${String(err).slice(0, 200)}`);
  }
}
