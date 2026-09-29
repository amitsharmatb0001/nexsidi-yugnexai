// 2026-09-28: real crash (project a034f90ba50e). loop.ts (NIM, OpenAI-style
// messages) and gemini-loop.ts (Gemini messages) persist an agent's
// conversation to the SAME agentConversations row (projectId + agentName).
// When a NIM run escalated to Gemini, the Gemini loop loaded the NIM-format
// history (assistant turns with content: null + tool_calls, "tool" turns) and
// crashed in compaction, failing a 71-minute deploy+review activity. Each loop
// now only resumes a history in its own format; otherwise it starts fresh (the
// escalation message already carries what the previous attempt did).

type Msg = { role?: unknown; content?: unknown };

export function isGeminiHistory(messages: unknown): boolean {
  return Array.isArray(messages) && messages.every((m: Msg) =>
    (m?.role === "system" && typeof m.content === "string") ||
    ((m?.role === "user" || m?.role === "model") && (typeof m.content === "string" || Array.isArray(m.content))),
  );
}

export function isNimHistory(messages: unknown): boolean {
  return Array.isArray(messages) && messages.every((m: Msg) =>
    ((m?.role === "system" || m?.role === "user" || m?.role === "tool") && typeof m.content === "string") ||
    (m?.role === "assistant" && (typeof m.content === "string" || m.content === null)),
  );
}
