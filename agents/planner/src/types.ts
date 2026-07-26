export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  ts: number;
  // Tool call support — persists ask_user/propose_plan calls in session so the model
  // sees proper tool_call context on follow-up turns (not just plain text).
  // This is what prevents the model from reverting to text Q&A after the first ask_user.
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;  // for role:"tool" messages
  name?: string;          // for role:"tool" messages
}

// Simplified planner intent — Arjun generates the full spec inside the pipeline.
export interface BuildPlan {
  schemaVersion: "1";
  appName: string;
  appDescription: string;
  pages: Array<{
    name: string;
    path: string;
    description: string;
  }>;
  authType: "none" | "jwt";
  designNotes?: string;  // visual direction: colors, tone, references — passed verbatim to Saanvi
}

export interface PlannerState {
  userId:       string;
  sessionId:    string;
  messages:     ChatMessage[];
  phase:        "planning" | "building" | "done";
  projectId:    string | null;
  buildPlan:    BuildPlan | null;
  proposedPlan: ProposedPlan | null;  // saved after propose_plan fires; used for direct trigger_build conversion
}

// Structured plan shown to the user before the build starts (the "plan panel")
export interface ProposedPlan {
  appName: string;
  context: string;
  publicPages:    Array<{ name: string; path: string; description: string }>;
  protectedPages: Array<{ name: string; path: string; description: string }>;
  dbTables: Array<{ name: string; keyColumns: string[] }>;
  apiEndpoints: Array<{ method: string; path: string; description: string }>;
  designDirection: string;
  techStack: { frontend: string; backend: string; database: string; auth: string };
}

// Structured clarifying question shown via the ElicitationWidget before propose_plan
export interface ElicitationQuestion {
  id: string;        // e.g. "q_auth_scope" — stable identifier for the question
  text: string;      // the question text shown to the user
  type: "single" | "multi";
  options: Array<{
    value: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
}

export interface StreamChunk {
  type: "token" | "plan_proposed" | "elicitation_question" | "build_triggered" | "error" | "done";
  content?: string;
  phase?: PlannerState["phase"];
  projectId?: string;
  buildPlan?: BuildPlan;
  proposedPlan?: ProposedPlan;
  elicitationQuestion?: ElicitationQuestion;
  // Included with elicitation_question so chat.ts can persist proper tool_call context
  elicitationCallId?: string;
  elicitationArgs?: string;
}
