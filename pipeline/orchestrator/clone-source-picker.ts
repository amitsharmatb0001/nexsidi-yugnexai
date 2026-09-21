// Auto-source-selection for the clone flow (2026-09-06, real user request:
// "don't mention which specific project to clone — let the system decide").
// Everything else about clone-with-changes assumed the caller already knew
// which delivered project to start from. This closes that: given a plain
// description of the desired site and the user's own real "done" projects,
// pick the closest STRUCTURAL match to clone and adapt — the same "what
// shape is this project" question project-shape.ts already answers for
// project-to-project comparison, applied here to a fresh text description
// instead. A one-shot classification call (no tools, no file access), same
// pattern as clone-plan.ts's planning step — not a full agentic loop, since
// picking one of a short list is a judgment call, not a build task.
import { agentChat, type AgentName, type ChatMessage } from "@nexsidi/llm-client";

export interface CloneSourceCandidate {
  id: string;
  name: string;
  description: string;
}

export interface PickCloneSourceResult {
  sourceId: string;
  reasoning: string;
}

export function buildPickSourcePrompt(description: string, candidates: CloneSourceCandidate[]): string {
  const listing = candidates.map((c) => `- id: "${c.id}", name: "${c.name}", description: "${c.description}"`).join("\n");
  return `A user wants a new project built with this description:
"${description}"

Here are the user's own existing, already-delivered projects available to clone from:
${listing}

Pick the SINGLE existing project whose shape — roughly how many pages, whether it needs auth/an admin area, general complexity — is the closest realistic starting point to clone and adapt for the requested description above. This is about STRUCTURAL similarity, not literal business-domain match — a consulting portal and a law firm site can be a good structural match even though the businesses differ.

Respond with ONLY this JSON shape, no other text, no markdown fences:
{
  "sourceId": "<one of the ids listed above, exactly as written>",
  "reasoning": "one sentence on why this is the closest structural match"
}`;
}

export function parsePickSourceResult(raw: string, validIds: string[]): PickCloneSourceResult {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let jsonText: string;
  if (fenceMatch?.[1]) {
    jsonText = fenceMatch[1];
  } else {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`clone source pick: no JSON object found in response: ${raw.slice(0, 300)}`);
    }
    jsonText = raw.slice(start, end + 1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`clone source pick: could not parse JSON (${String(err)}): ${raw.slice(0, 300)}`);
  }

  if (typeof parsed.sourceId !== "string" || !validIds.includes(parsed.sourceId)) {
    throw new Error(`clone source pick: sourceId "${String(parsed.sourceId)}" is not one of the real candidates (${validIds.join(", ")}) — refusing to fabricate a project id`);
  }

  return { sourceId: parsed.sourceId, reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "" };
}

export type PickSourceChatFn = (agentName: AgentName, messages: ChatMessage[], apiKey: string) => Promise<{ content: string }>;

export async function pickCloneSource(
  description: string,
  candidates: CloneSourceCandidate[],
  apiKey: string,
  deps: { chatFn?: PickSourceChatFn } = {},
): Promise<PickCloneSourceResult> {
  if (candidates.length === 0) {
    throw new Error("no candidate projects available to clone from — the user has no delivered ('done') projects yet");
  }
  // Nothing to decide — skip the LLM call entirely rather than spending a
  // real request to confirm the only option.
  if (candidates.length === 1) {
    return { sourceId: candidates[0]!.id, reasoning: "only one existing project available" };
  }

  const chatFn = deps.chatFn ?? agentChat;
  const prompt = buildPickSourcePrompt(description, candidates);
  const { content } = await chatFn("arjun", [{ role: "user", content: prompt }], apiKey);
  return parsePickSourceResult(content, candidates.map((c) => c.id));
}
