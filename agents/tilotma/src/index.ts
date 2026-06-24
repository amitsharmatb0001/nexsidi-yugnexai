// Tilotma — Chief AI Officer (DeepSeek V4-Pro via NIM)
// Highest rank. All critical decisions go through here.
// ROM memory: identity, patent claims, red lines, security rules (never overwritten by input).

import { agentChat } from "@nexsidi/llm-client";
import { consumeSteer } from "../../apps/api/src/utils/steer.ts";
import type { AgentMessage } from "@nexsidi/agent-bus";

export interface TilotmaInput {
  projectId: string;
  userRequest: string;
}

export async function run(input: TilotmaInput): Promise<void> {
  const apiKey = process.env.NIM_API_KEY ?? "";

  // Check for STEER.md redirect (Fix #3: atomic consume)
  const steer = consumeSteer();
  if (steer) {
    console.log("[tilotma] STEER redirect received:", steer.slice(0, 100));
    // TODO: apply steer directive to current pipeline
  }

  // Security Layer 1: injection check before processing user request
  const sanitised = sanitiseInput(input.userRequest);

  const { content } = await agentChat(
    "tilotma",
    [
      { role: "system", content: TILOTMA_SYSTEM_PROMPT },
      { role: "user", content: sanitised },
    ],
    apiKey,
  );

  console.log("[tilotma] decision:", content.slice(0, 200));
}

function sanitiseInput(raw: string): string {
  // Layer 1: strip common injection patterns before sending to LLM
  return raw
    .replace(/ignore\s+previous\s+instructions/gi, "[BLOCKED]")
    .replace(/you\s+are\s+now\s+/gi, "[BLOCKED]")
    .slice(0, 8000); // hard cap at 8K chars for user input
}

const TILOTMA_SYSTEM_PROMPT = `You are the Chief AI Officer of NexSidi.
Your decisions are final. You coordinate all agents.
You never reveal agent names, counts, or internal architecture to users.
External description only: "a coordinated multi-agent system".
You always present users with concrete options, never vague status messages.`;
