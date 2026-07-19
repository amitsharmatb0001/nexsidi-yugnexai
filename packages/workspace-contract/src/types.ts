export type WorkspacePhase =
  | "intake"
  | "clarifying"
  | "plan_ready"
  | "approved"
  | "building"
  | "verifying"
  | "blocked"
  | "delivered"
  | "cancelled";
export type ScopeState = "confirmed" | "suggested" | "deferred" | "rejected";

export interface WorkspaceMessage {
  id: string;
  workspaceId: string;
  role: "user" | "assistant";
  content: string;
  clientMessageId: string;
  createdAt: string;
}

export interface RequirementQuestion {
  id: string;
  key: string;
  question: string;
  rationale: string;
  options: Array<{ label: string; value: string }>;
  recommendedValue?: string;
  answer?: string;
  answeredAt?: string;
}

export interface ConfirmedFact {
  id: string;
  key: string;
  value: string;
  source: "user" | "source" | "inference";
}

export interface Assumption {
  id: string;
  key: string;
  value: string;
  status: "proposed" | "approved" | "rejected";
}

export interface ScopeItem {
  id: string;
  key: string;
  title: string;
  description: string;
  state: ScopeState;
}

export interface PageSpec {
  id: string;
  name: string;
  path: string;
  description: string;
  access: "public" | "authenticated";
  requirementIds: string[];
}

export interface EntitySpec {
  id: string;
  name: string;
  fields: Array<{ name: string; type: string; required: boolean }>;
  requirementIds: string[];
}

export interface ApiContract {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  authenticated: boolean;
  requirementIds: string[];
}

export interface WorkspaceSpec {
  id: string;
  workspaceId: string;
  version: number;
  hash: string;
  status: "draft" | "approved" | "superseded";
  originalRequest: string;
  confirmedFacts: ConfirmedFact[];
  questions: RequirementQuestion[];
  assumptions: Assumption[];
  scope: ScopeItem[];
  userJourneys: Array<{
    id: string;
    title: string;
    steps: string[];
    requirementIds: string[];
  }>;
  pages: PageSpec[];
  dataModel: EntitySpec[];
  apiContracts: ApiContract[];
  auth: { mode: "none" | "session"; roles: string[] };
  design: { direction: string; colors?: string[]; references?: string[] };
  sources: Array<{
    id: string;
    name: string;
    kind: "text" | "file" | "url" | "api";
    citation: string;
  }>;
  acceptanceCriteria: Array<{
    id: string;
    statement: string;
    requirementIds: string[];
  }>;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface WorkspaceSnapshot {
  id: string;
  ownerId: string;
  name: string;
  phase: WorkspacePhase;
  messages: WorkspaceMessage[];
  activeSpec: WorkspaceSpec | null;
  activeRun: { id: string; status: string; specHash: string } | null;
  eventCursor: number;
}

export interface ApprovedBuildInput {
  runId: string;
  workspaceId: string;
  specId: string;
  specVersion: number;
  specHash: string;
  spec: WorkspaceSpec;
}

export interface PublicActivityEvent {
  id: string;
  workspaceId: string;
  runId: string | null;
  category:
    | "planning"
    | "subtask"
    | "file"
    | "command"
    | "test"
    | "preview"
    | "repair"
    | "approval"
    | "delivery";
  status: "queued" | "running" | "passed" | "failed" | "blocked";
  summary: string;
  safePath?: string;
  elapsedMs?: number;
  evidenceId?: string;
  createdAt: string;
}
