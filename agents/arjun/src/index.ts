// Arjun — Pipeline lead, task decomposition, parallel dispatch (Mistral-Nemotron via NIM)
// D22: ambitious planner (not minimal). D23: sprint contracts via files before code starts.

import { agentChat } from "@nexsidi/llm-client";
import type { ProjectSpec } from "../../saanvi/src/index.ts";

export interface TaskPlan {
  projectId:        string;
  independenceCheck: boolean; // true = Shubham/Aanya/Pranav can run in parallel
  shubhamTasks:     string[];
  aanyaTasks:       string[];
  pranavTasks:      string[];
}

export async function run(spec: ProjectSpec): Promise<TaskPlan> {
  const apiKey = process.env.NIM_API_KEY ?? "";

  const { content } = await agentChat(
    "arjun",
    [
      { role: "system", content: ARJUN_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(spec) },
    ],
    apiKey,
  );

  // TODO Phase 1: parse into TaskPlan, validate independence, dispatch to worktrees
  return {
    projectId:        spec.projectId,
    independenceCheck: true,
    shubhamTasks:     [],
    aanyaTasks:       [],
    pranavTasks:      [],
  };
}

const ARJUN_SYSTEM_PROMPT = `You are a technical lead. Given a ProjectSpec JSON, produce a TaskPlan JSON.
Be ambitious — include everything needed. Verify that backend, frontend and database tasks are independent
(no agent needs another's in-progress output). Output ONLY valid JSON.`;
