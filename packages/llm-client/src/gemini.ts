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
import { canRequest, recordFailure, recordSuccess, waitForCircuit } from "./circuit-breaker.ts";
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

// 2026-07-24 (NexSidi full agentic upgrade, W0.1): Gemini 3.x attaches a
// `thoughtSignature` to the model's functionCall part and REQUIRES it be
// echoed back verbatim on the next turn of a multi-step call — omitting it
// is a hard 400, not a soft degradation. It was previously typed only as a
// mis-named `signature` field on the `thought` variant (never on
// `functionCall`, the variant that actually needs it), so any code
// constructing/inspecting a functionCall part had no type-level signal to
// preserve it. Both fields are now named to match the real API field.
export type GeminiPart =
  | { text: string }
  | { thought: true; text?: string; thoughtSignature?: string }  // Gemini 3.x thought parts — preserve verbatim
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
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
  promptTokens?: number;  // from usageMetadata — used for compaction threshold check
  // 2026-07-24 (W0.3): surfaced so callers/logs can observe implicit prompt-
  // caching effectiveness (Vertex AI Gemini caches a repeated prefix — e.g.
  // a stable system instruction + base code context — automatically when
  // the prefix is byte-identical across calls; this field is how a cache HIT
  // becomes visible, since there's no separate "cache hit" flag otherwise).
  cachedContentTokens?: number;
}

// Shape of the `usageMetadata` object Vertex AI returns on every
// generateContent response. cachedContentTokenCount is present (and > 0)
// only when the request's cacheable prefix matched a live implicit cache.
export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
}

// 2026-07-24 (W0.3): pure formatter, extracted so the cache-hit visibility
// this fix adds is unit-testable without a network call — before this,
// cachedContentTokenCount was never read from the API response at all, so a
// cache hit and a cache miss were indistinguishable in the logs.
export function formatUsageLog(usage: GeminiUsageMetadata): string {
  const base = `usage: ${usage.promptTokenCount} in / ${usage.candidatesTokenCount} out / ${usage.totalTokenCount} total`;
  if (usage.cachedContentTokenCount && usage.cachedContentTokenCount > 0) {
    return `${base} (${usage.cachedContentTokenCount} cached)`;
  }
  return base;
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
    .filter((p): p is { text: string } => "text" in p && !("thought" in p))
    .map((p) => p.text)
    .join("\n");
}

export function partsToToolCalls(parts: GeminiPart[]): GeminiToolCall[] {
  let index = 0;
  return parts
    .filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => "functionCall" in p)
    .map((p) => ({ id: `${p.functionCall.name}-${index++}`, name: p.functionCall.name, input: p.functionCall.args ?? {} }));
}

// 2026-07-24 (NexSidi full agentic upgrade, W0.1): extracted from the inline
// contents-assembly duplicated in geminiChat/geminiChatWithTools so the
// thoughtSignature round-trip (API response -> stored GeminiMessage history
// -> next outgoing request body) is unit-testable without mocking the
// network. This function does a straight pass-through of each message's
// GeminiPart[] — it must NOT reconstruct individual parts (that's exactly
// what would silently drop thoughtSignature), only route system vs
// user/model content.
export function buildGeminiContents(
  messages: GeminiMessage[],
): { systemParts: string[]; contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> } {
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
  return { systemParts, contents };
}

function describeError(err: unknown): string {
  return String(err);
}

// ── One-shot chat (mirrors claudeChat()'s shape) ───────────────────────────

// 2026-07-25 (Phase 0, full MVP upgrade): Gemini 3.x replaced the legacy
// `thinking_budget` integer with a `thinking_level` enum — sending both in
// the same request is a hard 400 (gemini_3_1_pro.md / gemini_3_5_flash.md /
// gemini_3_6_flash.md, all read in full from E:/ai yug/, §"Thinking Level
// Configuration"). 3.1 Pro only documents LOW/MEDIUM/HIGH (no MINIMAL);
// 3.5/3.6 Flash document MINIMAL too. Passing MINIMAL to 3.1 Pro isn't
// documented as erroring, but callers should prefer LOW there — see
// thinkingLevelForTier in router.ts, which already picks per-tier, not
// per-model, so this type stays a superset.
export type GeminiThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

function buildThinkingConfig(level: GeminiThinkingLevel | undefined): { thinkingLevel: GeminiThinkingLevel } | undefined {
  return level ? { thinkingLevel: level } : undefined;
}

export async function geminiChat(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; model?: string; thinkingLevel?: GeminiThinkingLevel },
): Promise<{ content: string }> {
  // Validated before any network activity (circuit breaker, token bucket, or
  // the ADC auth call itself) so a missing-project error is immediate and
  // deterministic instead of surfacing only after a live round-trip to
  // Google's OAuth token endpoint — see gemini.test.ts's regression test.
  projectIdOrThrow();
  const model = opts?.model ?? resolveGeminiModel();
  const location = resolveGeminiLocation();
  const circuitKey = circuitKeyFor(model);
  if (!canRequest(circuitKey)) {
    // 2026-07-11: don't fail the whole pipeline over a self-healing OPEN
    // circuit — wait out the cooldown (bounded, see waitForCircuit) and let
    // the HALF_OPEN probe below have a real shot before giving up.
    console.log(`[llm-client] Circuit breaker OPEN for ${model} — waiting for cooldown before retry`);
    await waitForCircuit(circuitKey);
    if (!canRequest(circuitKey)) {
      throw new Error(`[llm-client] Circuit breaker OPEN for ${model} — all retries exhausted`);
    }
  }

  await waitForToken(model, GEMINI_RPM_LIMIT);

  // geminiChat's ChatMessage role is "assistant", not Gemini's "model" — map
  // it before handing off to the shared builder (which expects GeminiMessage).
  const geminiMessages: GeminiMessage[] = messages.map((m) =>
    m.role === "system"
      ? { role: "system", content: m.content }
      : { role: m.role === "assistant" ? "model" : "user", content: m.content },
  );
  const { systemParts, contents } = buildGeminiContents(geminiMessages);

  // 2026-07-25 (Phase 0): 64k is the documented output ceiling for every
  // provisioned model (3.1 Pro, 3.5/3.6 Flash all list "Output token limit:
  // 64k"). The old 16000 default was an arbitrary conservative guess that
  // caused the MAX_TOKENS truncation-resend loop documented in
  // gemini-loop.ts. Still overridable via GEMINI_MAX_OUTPUT_TOKENS.
  const body: Record<string, unknown> = {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } } : {}),
    generationConfig: { maxOutputTokens: opts?.maxTokens ?? Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 64000) },
  };
  const thinkingConfig = buildThinkingConfig(opts?.thinkingLevel);
  if (thinkingConfig) {
    (body.generationConfig as Record<string, unknown>).thinkingConfig = thinkingConfig;
  }

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
      usageMetadata?: GeminiUsageMetadata;
    };
    recordSuccess(circuitKey);

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const content = partsToText(parts);
    if (data.usageMetadata) {
      console.log(`[gemini:${model}] ${formatUsageLog(data.usageMetadata)}`);
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
  opts?: { model?: string; thinkingLevel?: GeminiThinkingLevel; cachedContent?: string },
): Promise<GeminiChatWithToolsResult> {
  projectIdOrThrow();
  // 2026-07-12: per-role model routing. Two-model cost strategy — the pricey
  // pro (thinking) model for code GENERATION, cheap flash for high-volume
  // tool-driving (QA exploration, Tier 3 interactive review). Caller passes
  // opts.model; falls back to GEMINI_MODEL (default flash).
  const model = opts?.model ?? resolveGeminiModel();
  const location = resolveGeminiLocation();
  const circuitKey = circuitKeyFor(model);
  if (!canRequest(circuitKey)) {
    // 2026-07-11: don't fail the whole pipeline over a self-healing OPEN
    // circuit — wait out the cooldown (bounded, see waitForCircuit) and let
    // the HALF_OPEN probe below have a real shot before giving up.
    console.log(`[llm-client] Circuit breaker OPEN for ${model} — waiting for cooldown before retry`);
    await waitForCircuit(circuitKey);
    if (!canRequest(circuitKey)) {
      throw new Error(`[llm-client] Circuit breaker OPEN for ${model} — all retries exhausted`);
    }
  }

  await waitForToken(model, GEMINI_RPM_LIMIT);

  const { systemParts, contents } = buildGeminiContents(messages);

  // 2026-07-25 (Phase 0): 64k is the documented ceiling for every
  // provisioned model — not a 3.1-Pro-specific bump. The old 32000 was
  // itself already a guess-and-raise off the original 16000 default; both
  // undershot the real limit and were the direct cause of the MAX_TOKENS
  // truncation-resend loop (gemini-loop.ts:262-279). Still overridable via
  // GEMINI_MAX_OUTPUT_TOKENS.
  const body: Record<string, unknown> = {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } } : {}),
    tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
    generationConfig: { maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 64000) },
    // 2026-07-25 (Phase 0.4): real explicit context caching — a handle
    // created via geminiCreateCachedContent() for the stable prefix (system
    // prompt + build plan + NexUI reference). Distinct from Gemini's
    // automatic IMPLICIT caching (which needs no wiring and already applies
    // to any byte-identical repeated prefix); this is the EXPLICIT form the
    // docs list separately ("Context Caching" + "Implicit Caching" as two
    // capabilities). Sending both cachedContent and a non-empty systemParts
    // in the same request is fine — the cache only covers what was baked
    // into it at creation time, not the live systemInstruction.
    ...(opts?.cachedContent ? { cachedContent: opts.cachedContent } : {}),
  };
  // 2026-07-24 (W0.2)/2026-07-25 (Phase 0): thinkingLevel wasn't previously
  // plumbed through the tool-calling path at all (only the one-shot
  // geminiChat had it) — the QA tier's HIGH requirement had no way to reach
  // the actual API request for qa-loop.ts's tool-calling agent. Now sends
  // the current thinking_level enum instead of the legacy thinking_budget
  // integer (see buildThinkingConfig's comment above geminiChat).
  const thinkingConfig = buildThinkingConfig(opts?.thinkingLevel);
  if (thinkingConfig) {
    (body.generationConfig as Record<string, unknown>).thinkingConfig = thinkingConfig;
  }

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
      usageMetadata?: GeminiUsageMetadata;
    };
    recordSuccess(circuitKey);

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    if (data.usageMetadata) {
      console.log(`[gemini:${model}] ${formatUsageLog(data.usageMetadata)}`);
    }

    return {
      content: partsToText(parts),
      toolCalls: partsToToolCalls(parts),
      stopReason: candidate?.finishReason ?? null,
      rawParts: parts,
      promptTokens: data.usageMetadata?.promptTokenCount,
      cachedContentTokens: data.usageMetadata?.cachedContentTokenCount,
    };
  } catch (err) {
    recordFailure(circuitKey);
    throw new Error(`[Gemini ${model}] ${describeError(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Explicit context caching (Phase 0.4) ────────────────────────────────────
// Prior state: GeminiChatWithToolsResult.cachedContentTokens and
// formatUsageLog already READ cachedContentTokenCount from the response —
// but nothing in this file ever created a cache or sent `cachedContent` in a
// request, so that field was always 0 and the log line was permanently dead.
// This is the write side. Vertex AI's cachedContents resource: POST once per
// stable prefix (system prompt + build plan + NexUI reference — the same
// bytes on every turn of one agent run), get back a `name` handle, then pass
// that handle as `cachedContent` on every subsequent geminiChatWithTools call
// for that run. Billed once to create, then a fraction of input-token price
// per hit — the "70-80% cost cut" only exists once this function is called.
export interface GeminiCachedContentHandle {
  name: string;
  expireTime?: string;
}

function cachedContentsEndpoint(location: string): string {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectIdOrThrow()}/locations/${location}/cachedContents`;
}

// 2026-07-25: real bug found LIVE on nextech10's first real end-to-end run
// (the run this whole Phase 0-3 upgrade was built to make work). Vertex's
// cachedContents API rejects a bare `publishers/google/models/{model}` —
// it requires the FULLY QUALIFIED path including project and location, or
// it 400s with "The project `` in Model name ... should match the one in
// the CachedContent resource". Confirmed live: every single explicit cache
// creation attempt this run failed with exactly this error (fail-open
// caught it, the run continued uncached on the explicit path — but see the
// second bug below, implicit caching is what was ACTUALLY producing the
// real cache hits seen throughout the run).
function fullyQualifiedModelPath(model: string, location: string): string {
  return `projects/${projectIdOrThrow()}/locations/${location}/publishers/google/models/${model}`;
}

// Fail-open by design (see callers in gemini-loop.ts): if cache creation
// errors (quota, transient, prefix too small — Vertex requires a minimum
// token count to accept a cache), the caller falls back to sending the full
// prefix uncached rather than failing the run. This function itself throws
// on error; callers wrap it in try/catch.
export async function geminiCreateCachedContent(
  systemInstruction: string,
  content: string,
  opts?: { model?: string; ttlSeconds?: number },
): Promise<GeminiCachedContentHandle> {
  projectIdOrThrow();
  const model = opts?.model ?? resolveGeminiModel();
  const location = resolveGeminiLocation();

  const body = {
    model: fullyQualifiedModelPath(model, location),
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: content }] }],
    ttl: `${opts?.ttlSeconds ?? 3600}s`,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const token = await getAccessToken();
    const res = await fetch(cachedContentsEndpoint(location), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`[Gemini ${model}] cachedContents create ${res.status}: ${errBody}`);
    }
    const data = (await res.json()) as { name: string; expireTime?: string };
    return { name: data.name, expireTime: data.expireTime };
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
    // 2026-07-11: don't fail the whole pipeline over a self-healing OPEN
    // circuit — wait out the cooldown (bounded, see waitForCircuit) and let
    // the HALF_OPEN probe below have a real shot before giving up.
    console.log(`[llm-client] Circuit breaker OPEN for ${model} — waiting for cooldown before retry`);
    await waitForCircuit(circuitKey);
    if (!canRequest(circuitKey)) {
      throw new Error(`[llm-client] Circuit breaker OPEN for ${model} — all retries exhausted`);
    }
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
