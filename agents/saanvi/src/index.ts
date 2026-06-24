// Saanvi — Requirements → locked ProjectSpec JSON (MiniMax M3 via NIM)

import { agentChat } from "@nexsidi/llm-client";

export interface ProjectSpec {
  projectId:   string;
  name:        string;
  description: string;
  features:    string[];
  apiEndpoints: Array<{ method: string; path: string; description: string }>;
  dbTables:    Array<{ name: string; fields: string[] }>;
  lockedAt:    string; // ISO timestamp — spec is immutable after this
}

export async function run(projectId: string, userRequest: string): Promise<ProjectSpec> {
  const apiKey = process.env.NIM_API_KEY ?? "";

  const { content } = await agentChat(
    "saanvi",
    [
      { role: "system", content: SAANVI_SYSTEM_PROMPT },
      { role: "user", content: userRequest },
    ],
    apiKey,
  );

  // TODO Phase 1: parse LLM output into ProjectSpec, prompt user for OTP approval (Patent Claim 8)
  const spec: ProjectSpec = {
    projectId,
    name: "TODO",
    description: content.slice(0, 500),
    features: [],
    apiEndpoints: [],
    dbTables: [],
    lockedAt: new Date().toISOString(),
  };

  return spec;
}

const SAANVI_SYSTEM_PROMPT = `You are a requirements analyst. Extract a structured ProjectSpec JSON from the user request.
Output ONLY valid JSON matching the ProjectSpec schema. No prose, no markdown fences.`;
