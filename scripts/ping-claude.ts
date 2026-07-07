// Minimal, cheap sanity check for the Claude escalation tier's credential —
// sends one "hi" through the actual claudeChat() code path (not raw curl) so
// this validates the same client code the pipeline uses, without burning a
// full stress-test run just to find out the API key is bad.
import { claudeChat } from "../packages/llm-client/src/claude.ts";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  console.log("ANTHROPIC_API_KEY present:", !!apiKey, "length:", apiKey.length);

  try {
    const { content } = await claudeChat(
      [{ role: "user", content: "Say hi in exactly 3 words." }],
      apiKey,
      { maxTokens: 50 },
    );
    console.log("SUCCESS — Claude responded:", JSON.stringify(content));
  } catch (err) {
    console.log("FAILED —", String(err));
    process.exit(1);
  }
}

main();
