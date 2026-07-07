// Minimal, cheap sanity check for the Claude-via-Vertex-AI credential path
// (see packages/llm-client/src/claude.ts's createClaudeClient) — sends one
// "hi" through the actual claudeChat() code path so this validates the same
// client code the pipeline will use, without burning a full stress-test run
// just to find out auth/region/model-enablement is wrong.
//
// Requires, before running:
//   1. GCP billing account upgraded from Free Trial (removes the partner-model block)
//   2. Vertex AI API enabled in the target project
//   3. Claude Sonnet 5 enabled in Vertex AI Model Garden (accept Anthropic's terms)
//   4. gcloud auth application-default login  (sets up ADC — this is how
//      AnthropicVertex authenticates, NOT an API key)
//   5. Env vars set: CLAUDE_PROVIDER=vertex, GOOGLE_CLOUD_PROJECT=<your project id>,
//      GOOGLE_CLOUD_REGION=<a region that serves claude-sonnet-5 — check Anthropic's
//      current Vertex AI region table, not hardcoded here on purpose>
import { claudeChat } from "../packages/llm-client/src/claude.ts";

async function main(): Promise<void> {
  console.log("CLAUDE_PROVIDER:", process.env.CLAUDE_PROVIDER ?? "(unset — defaults to direct Anthropic API)");
  console.log("GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT ?? "(unset)");
  console.log("GOOGLE_CLOUD_REGION:", process.env.GOOGLE_CLOUD_REGION ?? "(unset)");

  if (process.env.CLAUDE_PROVIDER !== "vertex") {
    console.log("CLAUDE_PROVIDER is not 'vertex' — set it to actually exercise the Vertex path. Exiting.");
    process.exit(1);
  }

  try {
    // apiKey is unused on the Vertex path (auth is via GCP ADC) but the
    // function signature is shared with the direct-Anthropic path.
    const { content } = await claudeChat(
      [{ role: "user", content: "Say hi in exactly 3 words." }],
      "",
      { maxTokens: 50 },
    );
    console.log("SUCCESS — Claude (via Vertex) responded:", JSON.stringify(content));
  } catch (err) {
    console.log("FAILED —", String(err));
    process.exit(1);
  }
}

main();
