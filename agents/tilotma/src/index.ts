// Tilotma — Chief AI Officer
// Uses claude-opus-4-8 (Anthropic SDK) as its brain.
// The model calls pipeline tools; the tool runner handles the agentic loop.
// See orchestrator.ts for the full system prompt and tool definitions.

import { orchestrate } from "./orchestrator.ts";
import type Redis from "ioredis";

export interface TilotmaInput {
  projectId: string;
  userRequest: string;
}

export async function run(input: TilotmaInput, redis: Redis): Promise<void> {
  // Security Layer 1: strip injection attempts before handing to Claude
  const sanitised = sanitiseInput(input.userRequest);
  await orchestrate({ projectId: input.projectId, userRequest: sanitised }, redis);
}

// Layer 1: remove common prompt-injection patterns and hard-cap input size.
// The model never sees the raw user string — only this sanitised version.
function sanitiseInput(raw: string): string {
  return raw
    .replace(/ignore\s+(?:all\s+)?previous\s+instructions/gi, "[BLOCKED]")
    .replace(/you\s+are\s+now\s+(?:a\s+)?/gi, "[BLOCKED]")
    .replace(/disregard\s+(?:your\s+)?(?:system\s+)?prompt/gi, "[BLOCKED]")
    .replace(/act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:a\s+)?/gi, "[BLOCKED]")
    .slice(0, 8_000); // hard cap — NIM free-tier context limit is 32K; leave headroom
}
