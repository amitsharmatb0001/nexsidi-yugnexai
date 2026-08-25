export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  ts: number;
  // Tool call support — persists ask_user/propose_plan calls in session so the model
  // sees proper tool_call context on follow-up turns (not just plain text).
  // This is what prevents the model from reverting to text Q&A after the first ask_user.
  // 2026-08-24: real bug found live — Gemini 3.x attaches a `thoughtSignature`
  // to a functionCall part and REQUIRES it be echoed back verbatim on any
  // later turn that replays this call in history; omitting it is a hard 400
  // ("Function call is missing a thought_signature"), not a soft degradation
  // (see gemini.ts's GeminiPart type for the same field on the wire format).
  // This OpenAI-shaped tool_calls entry had no field to carry it, so it was
  // silently dropped the moment a Gemini tool call got stored here — the
  // exact root cause of a whole conversation 400ing on its next round after
  // any tool call Gemini happened to sign (confirmed live via fetch_url,
  // but not specific to that tool — any tool call can come back signed).
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string }; thoughtSignature?: string }>;
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
    // 2026-08-24 (Workstream 2): some options imply required follow-up data
    // the option tile alone can't capture — e.g. "match existing site" needs
    // the actual URL. Root cause: the planner asked this exact question with
    // no follow-up field, the user picked "match existing site", was never
    // asked for a link, and the build proceeded on a provisional fallback
    // design. When present, the widget must collect this value before the
    // question counts as answered — see ElicitationWidget in
    // apps/web/app/build/[id]/page.tsx.
    followUp?: {
      type: "url" | "text";
      label: string;        // e.g. "Paste the URL of the site to match"
      placeholder?: string;
      required: boolean;    // true = cannot submit this option without a value
    };
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
  // 2026-08-24: see ChatMessage.tool_calls[].thoughtSignature's header comment
  // — carried alongside elicitationCallId/elicitationArgs so chat.ts can
  // persist it into the SAME tool_calls entry, not just the call id/args.
  elicitationThoughtSignature?: string;
}
