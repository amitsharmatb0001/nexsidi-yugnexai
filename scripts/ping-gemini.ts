// Minimal, cheap sanity check for the Gemini-via-Vertex escalation path
// (packages/llm-client/src/gemini.ts) — sends one "hi" through the actual
// geminiChat() code path, same convention as ping-claude.ts / ping-claude-vertex.ts.
import { geminiChat, geminiWebSearch } from "../packages/llm-client/src/gemini.ts";

async function main(): Promise<void> {
  console.log("GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT ?? "(unset)");

  try {
    const { content } = await geminiChat([{ role: "user", content: "Say hi in exactly 3 words." }]);
    console.log("CHAT SUCCESS —", JSON.stringify(content));
  } catch (err) {
    console.log("CHAT FAILED —", String(err));
    process.exit(1);
  }

  try {
    const { content, sources } = await geminiWebSearch("what is the current stable version of Next.js in 2026");
    console.log("SEARCH SUCCESS —", JSON.stringify(content.slice(0, 300)));
    console.log("SOURCES —", sources.slice(0, 3).map((s) => s.url));
  } catch (err) {
    console.log("SEARCH FAILED —", String(err));
    process.exit(1);
  }
}

main();
