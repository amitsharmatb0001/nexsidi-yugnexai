// 2026-09-28 (Amit): Claude is a feature flag, OFF unless CLAUDE_ENABLED=true.
// The Anthropic account has no credit, so any Claude call can only fail.
// Flip the env var — no code change — once credit is available. While off,
// every Claude use falls back to Gemini: agent escalation (claude-loop.ts)
// and web search (tools/websearch.ts). ESCALATION_PROVIDER=gemini still pins
// Gemini even when Claude is enabled.
export function isClaudeEnabled(): boolean {
  return process.env.CLAUDE_ENABLED === "true";
}

export function usesClaude(): boolean {
  return isClaudeEnabled() && process.env.ESCALATION_PROVIDER !== "gemini";
}
