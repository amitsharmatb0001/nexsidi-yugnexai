import type { GeminiMessage, NimMessage, ClaudeMessage } from "@nexsidi/llm-client";

// Pure validators for the one invariant every compaction path must keep:
// a tool result never appears without the call that produced it, and a call
// is never left unanswered mid-history. All three providers reject a request
// that breaks it. Each returns human-readable violations; empty = valid.
// Used by compaction tests and the replay harness (scripts/compaction-replay.ts).

export function findNimPairingViolations(messages: NimMessage[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    if (m.role === "tool") {
      let j = i - 1;
      while (j >= 0 && messages[j]!.role === "tool") j--;
      const owner = messages[j];
      const ids = owner && owner.role === "assistant" ? (owner.tool_calls ?? []).map((c) => c.id) : [];
      if (!ids.includes(m.tool_call_id)) out.push(`tool result ${m.tool_call_id} at ${i} has no matching call`);
    }
    if (m.role === "assistant" && m.tool_calls?.length && i < messages.length - 1) {
      const answered = new Set<string>();
      for (let k = i + 1; k < messages.length; k++) {
        const next = messages[k]!;
        if (next.role !== "tool") break;
        answered.add(next.tool_call_id);
      }
      for (const c of m.tool_calls) if (!answered.has(c.id)) out.push(`tool call ${c.id} at ${i} has no result`);
    }
  });
  return out;
}

function geminiCallNames(m: GeminiMessage | undefined): string[] {
  if (!m || m.role !== "model" || !Array.isArray(m.content)) return [];
  return m.content.flatMap((p) => ("functionCall" in p ? [p.functionCall.name] : []));
}

function geminiResponseNames(m: GeminiMessage | undefined): string[] {
  if (!m || !Array.isArray(m.content)) return [];
  return m.content.flatMap((p) => ("functionResponse" in p ? [p.functionResponse.name] : []));
}

export function findGeminiPairingViolations(messages: GeminiMessage[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    const responses = geminiResponseNames(m);
    if (responses.length && JSON.stringify(geminiCallNames(messages[i - 1])) !== JSON.stringify(responses)) {
      out.push(`functionResponse turn at ${i} does not follow a matching functionCall turn`);
    }
    const calls = geminiCallNames(m);
    if (calls.length && i < messages.length - 1 && JSON.stringify(geminiResponseNames(messages[i + 1])) !== JSON.stringify(calls)) {
      out.push(`functionCall turn at ${i} is not answered by the next turn`);
    }
  });
  return out;
}

type ClaudeBlock = { type?: string; id?: string; tool_use_id?: string };

function claudeBlocks(m: ClaudeMessage | undefined): ClaudeBlock[] {
  return m && Array.isArray(m.content) ? (m.content as ClaudeBlock[]) : [];
}

export function findClaudePairingViolations(messages: ClaudeMessage[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const useIds = prev?.role === "assistant" ? claudeBlocks(prev).filter((b) => b.type === "tool_use").map((b) => b.id) : [];
    for (const b of claudeBlocks(m)) {
      if (b.type === "tool_result" && !useIds.includes(b.tool_use_id)) out.push(`tool_result ${b.tool_use_id} at ${i} has no matching tool_use`);
    }
    if (m.role === "assistant" && i < messages.length - 1) {
      const answered = new Set(claudeBlocks(messages[i + 1]).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
      for (const b of claudeBlocks(m)) if (b.type === "tool_use" && !answered.has(b.id)) out.push(`tool_use ${b.id} at ${i} has no tool_result`);
    }
  });
  return out;
}
