export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export interface ConversationState {
  userId:      string;
  sessionId:   string;
  messages:    ChatMessage[];
  phase:       "gathering" | "confirming" | "building" | "done";
  projectId:   string | null;
  // Extracted intent — Maya fills these in as the conversation progresses
  intent: {
    projectName:  string | null;
    description:  string | null;
    features:     string[];
    confirmed:    boolean;
  };
}

export interface StreamChunk {
  type: "token" | "phase_change" | "project_started" | "error";
  content?: string;
  phase?: ConversationState["phase"];
  projectId?: string;
}
