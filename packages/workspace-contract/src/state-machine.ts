import type { WorkspacePhase } from "./types.ts";

const ALLOWED: Record<WorkspacePhase, WorkspacePhase[]> = {
  intake: ["clarifying", "plan_ready", "cancelled"],
  clarifying: ["clarifying", "plan_ready", "cancelled"],
  plan_ready: ["clarifying", "approved", "cancelled"],
  approved: ["building", "cancelled"],
  building: ["verifying", "blocked", "cancelled"],
  verifying: ["building", "blocked", "delivered", "cancelled"],
  blocked: ["building", "verifying", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function transitionWorkspace(
  from: WorkspacePhase,
  to: WorkspacePhase,
): WorkspacePhase {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`invalid_workspace_transition:${from}:${to}`);
  }
  return to;
}
