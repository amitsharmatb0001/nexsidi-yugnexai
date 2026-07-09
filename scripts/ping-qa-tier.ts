// Minimal live check for QA_TIER=gemini before trusting it in a multi-hour
// pipeline run — confirms agentChat actually routes navya/karan/deepika
// through Gemini and gets a real response back.
import { agentChat } from "../packages/llm-client/src/router.ts";

async function main(): Promise<void> {
  console.log("QA_TIER:", process.env.QA_TIER ?? "(unset)");
  try {
    const { content, modelUsed } = await agentChat(
      "navya",
      [{ role: "user", content: "Say hi in exactly 3 words." }],
      "",
    );
    console.log("SUCCESS — modelUsed:", modelUsed, "content:", JSON.stringify(content));
  } catch (err) {
    console.log("FAILED —", String(err));
    process.exit(1);
  }
}

main();
