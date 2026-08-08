// One-off diagnostic — NOT part of the pipeline. Confirms whether the
// recurring 429 RESOURCE_EXHAUSTED on Vertex's "global" Gemini endpoint
// (see packages/llm-client/src/gemini.ts's resolveGeminiLocation — "global"
// is the hardcoded default) is a real per-project quota ceiling or a
// region/endpoint-specific issue on Google's side. Sends the SAME minimal
// generateContent request against "global" plus several real regions and
// reports pass/fail per region — a region that succeeds while "global"
// 429s confirms it's not project quota exhaustion, it's endpoint-specific.
import { GoogleAuth } from "google-auth-library";

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error("GOOGLE_CLOUD_PROJECT is not set");
  process.exit(1);
}

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
const LOCATIONS = ["global", "us-central1", "us-east1", "us-east4", "us-west1", "europe-west1", "asia-southeast1"];

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function probe(location: string): Promise<{ location: string; status: "ok" | "quota" | "other-error"; detail: string }> {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${MODEL}:generateContent`;

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with exactly one word: pong" }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });
    const ms = Date.now() - start;
    const text = await res.text();

    if (res.ok) {
      return { location, status: "ok", detail: `${res.status} in ${ms}ms — ${text.slice(0, 120)}` };
    }
    if (res.status === 429 || text.includes("RESOURCE_EXHAUSTED")) {
      return { location, status: "quota", detail: `${res.status} in ${ms}ms — ${text.slice(0, 200)}` };
    }
    return { location, status: "other-error", detail: `${res.status} in ${ms}ms — ${text.slice(0, 200)}` };
  } catch (err) {
    return { location, status: "other-error", detail: String(err).slice(0, 200) };
  }
}

console.log(`Probing model=${MODEL} project=${projectId} across ${LOCATIONS.length} locations...\n`);

for (const location of LOCATIONS) {
  const result = await probe(location);
  const marker = result.status === "ok" ? "PASS" : result.status === "quota" ? "QUOTA" : "ERROR";
  console.log(`[${marker}] ${result.location.padEnd(16)} ${result.detail}`);
  // Small gap between probes so we're not self-inflicting a burst 429.
  await new Promise((r) => setTimeout(r, 1500));
}
