// Minimal sanity check for a NIM model + key, mirroring ping-claude.ts.
// Usage: bun run scripts/ping-nim.ts <model-id>
import { nimChat } from "../packages/llm-client/src/nim.ts";

const modelId = process.argv[2];
if (!modelId) {
  console.error("Usage: bun run scripts/ping-nim.ts <model-id>");
  process.exit(1);
}

async function main(): Promise<void> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  console.log("NIM_API_KEY present:", !!apiKey, "length:", apiKey.length);
  console.log("model:", modelId);

  try {
    const res = await nimChat(modelId as never, [{ role: "user", content: "Say hi in exactly 3 words." }], apiKey, 50);
    console.log("SUCCESS —", JSON.stringify(res.choices[0]?.message.content));
  } catch (err) {
    console.log("FAILED —", String(err));
    process.exit(1);
  }
}

main();
