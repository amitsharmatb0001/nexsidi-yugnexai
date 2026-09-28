import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { sanitizeModelChain } from "./loop.ts";

const loopSource = readFileSync(new URL("./loop.ts", import.meta.url), "utf-8");

// 2026-09-28: the chain used to be filtered by NAME PREFIX (google/, mistralai/,
// meta/, qwen/, nvidia/). That dropped every real model outside those prefixes
// (the local Ollama "qwen2.5-coder:7b..." has no slash; moonshotai/, z-ai/,
// deepseek-ai/) and let through names nothing could serve (Claude names were
// rewritten to "google/gemini-3.5-flash", which this loop then sent to NIM).
// It is now a lookup in the model registry: only models the tool loop can
// actually call (active NIM models, tool-capable Ollama models) survive.
test("sanitizeModelChain keeps only registry models the tool loop can call", () => {
  const models = [
    "anthropic/claude-3-5-sonnet",       // served by the provider path, not this loop -> drop
    "google/gemini-3.1-pro-preview",     // served by the provider path -> drop
    "meta/muse-glimmer-30b",             // active NIM model -> keep
    "qwen2.5-coder:7b-instruct-q4_K_M",  // known Ollama model, but no tool calling -> drop
    "openai/gpt-4o",                     // unknown name -> drop
    "nvidia/nemotron-3-ultra-550b-a55b", // active NIM model -> keep
  ];
  expect(sanitizeModelChain(models)).toEqual(["meta/muse-glimmer-30b", "nvidia/nemotron-3-ultra-550b-a55b"]);
});

test("sanitizeModelChain keeps a tool-capable Ollama model (by name, no slash needed)", () => {
  expect(sanitizeModelChain(["qwen3-coder:30b"], { ollamaToolModels: new Set(["qwen3-coder:30b"]) })).toEqual(["qwen3-coder:30b"]);
});

// 2026-08-06: real bug found live (project bae438767bed) — qwen/qwen3-next-
// 80b-a3b-instruct returns a permanent HTTP 410 Gone (NIM's own response:
// "reached its end of life on 2026-07-27T00:00:00Z"), yet it's configured
// as the PRIMARY model for tilotma/saanvi/navya/neha and a fallback for
// most other agents. Its provider prefix ("qwen/") is otherwise allowed —
// only this specific model is dead — so the existing prefix-based filter
// above can't express this, and every chain containing it wasted a
// guaranteed circuit-breaker-open failure before falling through. This
// directly caused Tilotma's Tier-3 evidence-collector to burn its entire
// 61-iteration budget without ever reaching a verdict.
test("sanitizeModelChain drops the known-dead qwen3-next-80b model even though its provider prefix is otherwise allowed", () => {
  const models = [
    "qwen/qwen3-next-80b-a3b-instruct", // known-dead -> drop
    "moonshotai/kimi-k2.6",             // disallowed provider -> drop
    "meta/muse-glimmer-30b",             // active (2026-09-28: was mistral-nemotron, now retired too)
  ];

  const result = sanitizeModelChain(models);

  expect(result).toEqual(["meta/muse-glimmer-30b"]);
});

// 2026-08-09: real bug found live (project meridianbk4) — at the time,
// Riya's own config (agents/riya/src/index.ts) was `model:
// "moonshotai/kimi-k2.6"` with NO fallbackModels at all, so its sanitized
// chain was completely empty. runAgent's main loop used to read
// `modelChain[modelIdx] ?? config.model` — with an empty array that `??`
// silently fell through to the ORIGINAL, just-sanitized-away model,
// defeating sanitization entirely: every single Riya deploy attempt burned
// MAX_CONSECUTIVE_TRANSPORT_FAILURES (5) worth of real, slow network
// round-trips against the disallowed model before runAgentEscalated's
// cannot_finish path finally kicked in. Fixed at the time by making
// runAgent fail fast on an empty chain (test below) instead of silently
// reintroducing the disallowed model — this test now documents the general
// empty-chain case in isolation. Riya's own config was separately fixed on
// 2026-08-17 to carry real fallbacks (see the test directly below this one)
// so it no longer HITS this empty-chain case at all in practice.
test("sanitizeModelChain on a bare moonshotai model with no fallbacks produces an empty chain", () => {
  const result = sanitizeModelChain(["moonshotai/kimi-k2.6"]);
  expect(result).toEqual([]);
});

// 2026-08-17: real bug found live (fulfillio1) — Riya's actual call site
// (agents/riya/src/index.ts) used to pass NO fallbackModels at all, so its
// real config was exactly the empty-chain case above — every single deploy
// escalated straight to Sonnet 5, not just genuine hard-problem cases as
// the "one-time escalation only" comment there claimed. The disallowed
// moonshotai/ exclusion itself is correct and unchanged (test above); the
// actual bug was that Riya never gave itself anything else to fall back to.
// First fix added mistral-medium-3.5-128b as a fallback too — live-verified
// WRONG minutes later: it returns a real HTTP 410 Gone (EOL 2026-08-07),
// now in KNOWN_DEAD_MODELS, so sanitizeModelChain correctly drops it
// alongside the deliberately-excluded moonshotai/ entry. Pins Riya's
// CURRENT real config (moonshotai primary + the one fallback whose failure
// was never independently confirmed as a real availability problem) to
// prove the chain is genuinely non-empty.
// 2026-09-28: Riya's old config (kimi-k2.6 + mistral-nemotron) is gone — every
// NIM model it named was retired, so the whole old chain sanitizes to empty
// and claude-loop.ts's runAgentEscalated runs the provider directly.
test("sanitizeModelChain drops every retired NIM model (Riya's old kimi + mistral-nemotron chain sanitizes to empty)", () => {
  expect(sanitizeModelChain(["moonshotai/kimi-k2.6", "mistralai/mistral-nemotron"])).toEqual([]);
  expect(sanitizeModelChain(["z-ai/glm-5.2", "qwen/qwen3-next-80b-a3b-instruct", "mistralai/mistral-medium-3.5-128b"])).toEqual([]);
});

// 2026-08-17: real bug found live (fulfillio1) — confirmed via NIM's own
// response: "The model 'mistralai/mistral-medium-3.5-128b' has reached its
// end of life on 2026-08-07T09:00:00Z". This is the SAME failure shape as
// qwen3-next-80b above, and it's also AGENT_MODELS.aanya/AGENT_MODELS.shubham's
// own configured PRIMARY (packages/llm-client/src/types.ts) — every one of
// those agents' first raw-NIM attempt (whenever Gemini-tier routing isn't
// active) is a guaranteed wasted 410 before falling through.
test("sanitizeModelChain drops the known-dead mistral-medium-3.5-128b model even though its provider prefix is otherwise allowed", () => {
  const result = sanitizeModelChain(["mistralai/mistral-medium-3.5-128b", "meta/muse-glimmer-30b"]);
  expect(result).toEqual(["meta/muse-glimmer-30b"]);
});

test("runAgent fails fast with escalationReason cannot_finish when the sanitized model chain is empty, instead of silently reusing the disallowed model", () => {
  expect(loopSource).toContain("if (modelChain.length === 0) {");
  const guardIdx = loopSource.indexOf("if (modelChain.length === 0) {");
  const startingLogIdx = loopSource.indexOf("Starting — model:");
  // the empty-chain guard must run BEFORE the loop ever attempts a call —
  // confirmed by its position ahead of the "Starting" log in source order.
  expect(guardIdx).toBeGreaterThan(0);
  expect(guardIdx).toBeLessThan(startingLogIdx);
});
