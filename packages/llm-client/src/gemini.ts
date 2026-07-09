// Gemini via Vertex AI (GCP-credit escalation tier) — added 2026-07-06 after
// confirming Claude on Vertex is blocked project-wide by Google's
// partner-model sales gating (every Claude model either has 0 quota or
// isn't enabled — see packages/llm-client/src/claude.ts's resolveClaudeModel
// comment and the live curl tests in scripts/ping-claude-vertex.ts). Gemini
// is a first-party Google model on the SAME project/credit with no such
// gating — confirmed live via a raw generateContent call before writing any
// of this. No official Anthropic-style SDK wraps Gemini the way
// @anthropic-ai/vertex-sdk wraps Claude, so this uses the documented REST
// endpoint directly (mirrors nim.ts's raw-fetch pattern) with
// google-auth-library supplying the ADC bearer token (the same credential
// `gcloud auth application-default login` already set up for Claude-on-Vertex).
import { GoogleAuth } from "google-auth-library";
import { canRequest, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import { waitForToken } from "./token-bucket.ts";
import type { ChatMessage } from "./types.ts";
import type { NimToolDef } from "./nim.ts";

// Confirmed live 2026-07-06 (curl against the real generateContent endpoint,
// see scripts/ping-vertex-models2.ts history) — works with zero quota
// blockers on this project's global endpoint.
export const GEMINI_ESCALATION_MODEL = "gemini-3.5-flash";

// GEMINI_MODEL overrides the model per environment — same override pattern
// as claude.ts's resolveClaudeModel, for the same reason (a newer/older
// Gemini model may have different quota/availability per project).
export function resolveGeminiModel(): string {
  const override = process.env.GEMINI_MODEL?.trim();
  return override ? override : GEMINI_ESCALATION_MODEL;
}

// Gemini's "global" endpoint (no region prefix on the host, locations/global
// in the path) is what actually worked live — Claude's global endpoint 404'd
// on this project, but Gemini's did not. Overridable for parity with
// GOOGLE_CLOUD_REGION on the Claude path, but global is the confirmed-working
// default so it's safe to default here (unlike Claude's region, which has no
// safe default — see claude.ts's comment on GOOGLE_CLOUD_REGION).
export function resolveGeminiLocation(): string {
  const override = process.env.GEMINI_LOCATION?.trim();
  return override ? override : "global";
}

const GEMINI_RPM_LIMIT = 50;
const GEMINI_TIMEOUT_MS = 120_000;

function circuitKeyFor(model: string): string {
  return `gemini:${model}`;
}

// 2026-07-09: real bug found live (stress-full-gemini6 run) — a transient
// 429 RESOURCE_EXHAUSTED from a one-shot QA call (Deepika, via agentChat)
// threw immediately and crashed the ENTIRE pipeline, discarding all the
// generation work that had already succeeded. The tool-calling loops
// (loop.ts/claude-loop.ts/gemini-loop.ts) already retry transient failures
// with backoff; geminiChat/geminiChatWithTools/geminiWebSearch (the
// one-shot path agentChat uses for Navya/Karan/Deepika) had none of that
// resilience — this closes that gap.
const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_DELAY_MS = 5000;

export function isRetryableGeminiStatus(status: number): boolean {
  return status === 429 || status === 503;
}

// Exponential backoff: 5s, 10s, 20s for attempts 0, 1, 2.
export function geminiRetryDelayMs(attempt: number): number {
  return GEMINI_RETRY_BASE_DELAY_MS * 2 ** attempt;
}

// Shared by all three fetch call sites below — a 429/503 retries with
// backoff up to GEMINI_MAX_RETRIES; any other status (including a 429/503
// on the FINAL attempt) is returned as-is for the caller's existing
// !res.ok handling to report normally.
async function fetchGeminiWithRetry(url: string, init: RequestInit, logPrefix: string): Promise<Response> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, init);
    if (!isRetryableGeminiStatus(res.status) || attempt >= GEMINI_MAX_RETRIES) return res;
    const delay = geminiRetryDelayMs(attempt);
    console.log(`[${logPrefix}] ${res.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${GEMINI_MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

let cachedAuth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return cachedAuth;
}

async function getAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("[llm-client] Gemini: GoogleAuth returned no access token — check `gcloud auth application-default login`");
  }
  return token.token;
}

function projectIdOrThrow(): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("[llm-client] Gemini via Vertex requires GOOGLE_CLOUD_PROJECT to be set");
  }
  return projectId;
}

function endpointFor(model: string, location: string, method: "generateContent"): string {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectIdOrThrow()}/locations/${location}/publishers/google/models/${model}:${method}`;
}

// ── Gemini content-part / tool types (mirrors claude.ts's ClaudeContentBlockParam family) ──

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiToolCall {
  // Gemini doesn't assign call ids the way OpenAI/Anthropic do — synthesized
  // as `${name}-${index within this turn}` so callers have a stable key to
  // correlate functionResponse parts back to the call that produced them.
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type GeminiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | GeminiPart[] }
  | { role: "model"; content: string | GeminiPart[] };

export interface GeminiChatWithToolsResult {
  content: string;
  toolCalls: GeminiToolCall[];
  stopReason: string | null;
  // Raw response parts — callers building a multi-turn tool loop push this
  // back as the next "model" turn verbatim, mirroring claude.ts's rawContent.
  rawParts: GeminiPart[];
}

// Lets the EXISTING NIM-shaped tool defs (packages/agent-runtime/src/tools/*.ts)
// be reused for a Gemini-based loop, same role claude.ts's
// translateNimToolToClaudeTool plays for the Claude path. Gemini's
// FunctionDeclaration schema is an OpenAPI-subset, close enough to NIM's
// OpenAI-style {name, description, parameters} to pass parameters through
// directly rather than rewriting the schema shape.
export function translateNimToolToGeminiTool(tool: NimToolDef): GeminiToolDef {
  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  };
}

export function partsToText(parts: GeminiPart[]): string {
  return parts
    .filter((p): p is { text: string } => "text" in p)
    .map((p) => p.text)
    .join("\n");
}

export function partsToToolCalls(parts: GeminiPart[]): GeminiToolCall[] {
  let index = 0;
  return parts
    .filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in p)
    .map((p) => ({ id: `${p.functionCall.name}-${index++}`, name: p.functionCall.name, input: p.functionCall.args ?? {} }));
}

function describeError(err: unknown): string {
  return String(err);
}

// ── One-shot chat (mirrors claudeChat()'s shape) ───────────────────────────

export async function geminiChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number },
): Promise<{ content: string }> {
  // Validated before any network activity (circuit breaker, token bucket, or
  // the ADC auth call itself) so a missing-project error is immediate and
  // deterministic instead of surfacing only after a live round-trip to
  // Google's OAuth token endpoint — see gemini.test.ts's regression test.
  projectIdOrThrow();
  const model = resolveGeminiModel();
  const location = resolveGeminiLocation();
  const circuitKey = circuitKeyFor(model);
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${model} — all retries exhausted`);
  }

  await waitForToken(model, GEMINI_RPM_LIMIT);

  const systemParts: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
    }
  }

  const body: Record<string, unknown> = {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } } : {}),
    generationConfig: { maxOutputTokens: opts?.maxTokens ?? 8000 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const token = await getAccessToken();
    const res = await fetchGeminiWithRetry(endpointFor(model, location, "generateContent"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    }, "gemini:geminiChat");

    if (!res.ok) {
      const errBody = await res.text();
      recordFailure(circuitKey);
      throw new Error(`[Gemini ${model}] ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: GeminiPart[] }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
    };
    recordSuccess(circuitKey);

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const content = partsToText(parts);
    if (data.usageMetadata) {
      console.log(`[gemini:${model}] usage: ${data.usageMetadata.promptTokenCount} in / ${data.usageMetadata.candidatesTokenCount} out / ${data.usageMetadata.totalTokenCount} total`);
    }
    return { content };
  } catch (err) {
    recordFailure(circuitKey);
    throw new Error(`[Gemini ${model}] ${describeError(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Tool-calling chat (mirrors claudeChatWithTools()'s shape) ──────────────

export async function geminiChatWithTools(
  messages: GeminiMessage[],
  tools: GeminiToolDef[],
): Promise<GeminiChatWithToolsResult> {
  projectIdOrThrow();
  const model = resolveGeminiModel();
  const location = resolveGeminiLocation();
  const circuitKey = circuitKeyFor(model);
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${model} — all retries exhausted`);
  }

  await waitForToken(model, GEMINI_RPM_LIMIT);

  const systemParts: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    const parts: GeminiPart[] = typeof m.content === "string" ? [{ text: m.content }] : m.content;
    contents.push({ role: m.role, parts });
  }

  const body: Record<string, unknown> = {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } } : {}),
    tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
    generationConfig: { maxOutputTokens: 16000 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const token = await getAccessToken();
    const res = await fetchGeminiWithRetry(endpointFor(model, location, "generateContent"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    }, "gemini:geminiChatWithTools");

    if (!res.ok) {
      const errBody = await res.text();
      recordFailure(circuitKey);
      throw new Error(`[Gemini ${model}] ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: GeminiPart[] }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
    };
    recordSuccess(circuitKey);

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    if (data.usageMetadata) {
      console.log(`[gemini:${model}] usage: ${data.usageMetadata.promptTokenCount} in / ${data.usageMetadata.candidatesTokenCount} out / ${data.usageMetadata.totalTokenCount} total`);
    }

    return {
      content: partsToText(parts),
      toolCalls: partsToToolCalls(parts),
      stopReason: candidate?.finishReason ?? null,
      rawParts: parts,
    };
  } catch (err) {
    recordFailure(circuitKey);
    throw new Error(`[Gemini ${model}] ${describeError(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Search (mirrors websearch.ts's execWebSearch, Gemini's google_search grounding tool) ──

export interface GeminiSearchResult {
  content: string;
  sources: Array<{ title: string; url: string }>;
}

// Gemini's server-side Google Search grounding — same "the model runs the
// search itself" shape as Claude's web_search_20260209 server tool
// (packages/agent-runtime/src/tools/websearch.ts), so this is a drop-in
// alternative for that tool when the escalation provider is Gemini.
export async function geminiWebSearch(query: string, opts?: { timeoutMs?: number }): Promise<GeminiSearchResult> {
  projectIdOrThrow();
  const model = resolveGeminiModel();
  const location = resolveGeminiLocation();
  const circuitKey = circuitKeyFor(model);
  if (!canRequest(circuitKey)) {
    throw new Error(`[llm-client] Circuit breaker OPEN for ${model} — all retries exhausted`);
  }

  await waitForToken(model, GEMINI_RPM_LIMIT);

  const body = {
    contents: [{ role: "user", parts: [{ text: query }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: 2048 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(opts?.timeoutMs ?? 10_000, 30_000));

  try {
    const token = await getAccessToken();
    const res = await fetchGeminiWithRetry(endpointFor(model, location, "generateContent"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    }, "gemini:geminiWebSearch");

    if (!res.ok) {
      const errBody = await res.text();
      recordFailure(circuitKey);
      throw new Error(`[Gemini ${model}] ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{
        content: { parts: GeminiPart[] };
        groundingMetadata?: { groundingChunks?: Array<{ web?: { uri: string; title: string } }> };
      }>;
    };
    recordSuccess(circuitKey);

    const candidate = data.candidates?.[0];
    const content = partsToText(candidate?.content?.parts ?? []);
    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .filter((c): c is { web: { uri: string; title: string } } => !!c.web)
      .map((c) => ({ title: c.web.title, url: c.web.uri }));

    return { content, sources };
  } catch (err) {
    recordFailure(circuitKey);
    throw new Error(`[Gemini ${model}] ${describeError(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
