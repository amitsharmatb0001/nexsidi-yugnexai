import type { GeminiMessage, GeminiPart } from "@nexsidi/llm-client";
import { estimateGeminiChars } from "./compaction.ts";
import { capJsonStrings, capString, DEFAULT_MAX_STRING } from "./json-caps.ts";
import { argsKeyOf, decideByRules, LOG_KEEP_CHARS, rewrittenPathsOf, targetOf, type TriageAction, type TriageCall } from "./triage-rules.ts";

// Triage of the middle of a Gemini history — the part selectRelevantContext
// used to drop wholesale at every compaction (triage compaction plan,
// docs/nexsidi/plans/2026-09-26-triage-compaction.md). keep / truncate / stub
// adapted from save-token-jev (MIT).
//
// Invariants (each has a test):
// - no message is removed or added, and no functionCall/functionResponse
//   pair is split: only functionResponse.response, non-thought text, and
//   screenshot bytes are ever rewritten;
// - thought parts and thoughtSignatures are never touched;
// - idempotent: re-running over an already-triaged middle changes nothing;
// - the result fits the token budget whenever stubbing results can get it
//   there (non-error results go first, oldest first; errors last).

// A capped string is max + a ~30-char marker long; this slack makes
// re-capping it a no-op (see capString).
const CAP_SLACK = 64;

export interface TriageStats {
  calls: number;
  kept: number;
  truncated: number;
  stubbed: number;
  tokensBefore: number;
  tokensAfter: number;
}

type ResponsePart = { functionResponse: { name: string; response: Record<string, unknown> } };

function responsePartsOf(m: GeminiMessage | undefined): Array<{ part: ResponsePart; index: number }> {
  if (!m || !Array.isArray(m.content)) return [];
  return m.content.flatMap((p, index) => ("functionResponse" in p ? [{ part: p as ResponsePart, index }] : []));
}

/** Pairs each model turn's functionCall parts (in order) with the next turn's functionResponse parts. */
export function collectCalls(middle: GeminiMessage[]): TriageCall[] {
  const calls: TriageCall[] = [];
  middle.forEach((m, callTurn) => {
    if (m.role !== "model" || !Array.isArray(m.content)) return;
    const responses = responsePartsOf(middle[callTurn + 1]);
    let r = 0;
    m.content.forEach((p, partIndex) => {
      if (!("functionCall" in p)) return;
      const match = responses[r++];
      if (!match || match.part.functionResponse.name !== p.functionCall.name) return;
      const args = p.functionCall.args ?? {};
      const response = match.part.functionResponse.response ?? {};
      calls.push({
        key: `${callTurn}:${partIndex}`,
        callTurn,
        responseTurn: callTurn + 1,
        responsePart: match.index,
        name: p.functionCall.name,
        argsKey: argsKeyOf(args),
        target: targetOf(p.functionCall.name, args),
        rewrites: rewrittenPathsOf(p.functionCall.name, args),
        resultChars: JSON.stringify(response).length,
        isError: response.status === "error",
        isStub: response.compacted === true,
      });
    });
  });
  return calls;
}

function stubResponse(call: TriageCall, reason: string, original: Record<string, unknown>): Record<string, unknown> {
  const what = call.target ? `${call.name} ${call.target}` : call.name;
  return {
    status: typeof original.status === "string" ? original.status : "success",
    compacted: true,
    summary: `[result omitted during compaction: ${reason}; ${what}; ${call.resultChars} chars]`,
  };
}

function responseFor(action: TriageAction, call: TriageCall, reason: string, original: Record<string, unknown>): Record<string, unknown> {
  if (action === "stub") return stubResponse(call, reason, original);
  if (action === "truncate") return capJsonStrings(original, LOG_KEEP_CHARS, CAP_SLACK) as Record<string, unknown>;
  // "keep" still gets the same 4,000-char-per-string cap the trailing window
  // uses, so one giant result can't consume the whole budget by itself.
  return capJsonStrings(original, DEFAULT_MAX_STRING, CAP_SLACK) as Record<string, unknown>;
}

function capOtherParts(m: GeminiMessage): GeminiMessage {
  if (m.role === "system") return m;
  if (typeof m.content === "string") return { ...m, content: capString(m.content, DEFAULT_MAX_STRING, CAP_SLACK) };
  return {
    ...m,
    content: m.content.map((p): GeminiPart => {
      if ("inlineData" in p) return { text: `[earlier screenshot omitted — ${p.inlineData.mimeType}, already reviewed in a previous turn]` };
      if ("text" in p && !("thought" in p)) return { ...p, text: capString(p.text, DEFAULT_MAX_STRING, CAP_SLACK) };
      return p;
    }),
  } as GeminiMessage;
}

export function triageMiddle(middle: GeminiMessage[], budgetTokens: number): { turns: GeminiMessage[]; stats: TriageStats } {
  const calls = collectCalls(middle);
  const decisions = decideByRules(calls);
  const actions = new Map<string, TriageAction>(decisions.map((d) => [d.key, d.action]));
  const reasons = new Map<string, string>(decisions.map((d) => [d.key, d.reason]));

  const turns = middle.map(capOtherParts);
  const originals = new Map<string, Record<string, unknown>>();

  const setResponse = (call: TriageCall, response: Record<string, unknown>): number => {
    const content = turns[call.responseTurn]!.content as GeminiPart[];
    const part = content[call.responsePart] as ResponsePart;
    const before = JSON.stringify(part.functionResponse).length;
    const updated: ResponsePart = { functionResponse: { ...part.functionResponse, response } };
    const nextContent = [...content];
    nextContent[call.responsePart] = updated as GeminiPart;
    turns[call.responseTurn] = { ...turns[call.responseTurn]!, content: nextContent } as GeminiMessage;
    return JSON.stringify(updated.functionResponse).length - before;
  };

  for (const call of calls) {
    const original = (middle[call.responseTurn]!.content as GeminiPart[])[call.responsePart] as ResponsePart;
    originals.set(call.key, original.functionResponse.response);
    setResponse(call, responseFor(actions.get(call.key)!, call, reasons.get(call.key)!, original.functionResponse.response));
  }

  // Budget: stub kept/truncated results, non-errors oldest first, then errors
  // oldest first, until the middle fits. Char count adjusted exactly per
  // replaced part (estimateGeminiChars counts JSON.stringify(functionResponse)).
  let chars = estimateGeminiChars(turns);
  const budgetChars = Math.max(0, budgetTokens) * 4;
  if (Math.round(chars / 4) > budgetTokens) {
    const victims = calls
      .filter((c) => !c.isStub && actions.get(c.key) !== "stub")
      .sort((a, b) => Number(a.isError) - Number(b.isError) || a.callTurn - b.callTurn);
    for (const victim of victims) {
      if (Math.round(chars / 4) <= budgetTokens || chars <= budgetChars) break;
      actions.set(victim.key, "stub");
      chars += setResponse(victim, stubResponse(victim, "over the compaction budget", originals.get(victim.key)!));
    }
  }

  const count = (a: TriageAction) => calls.filter((c) => actions.get(c.key) === a).length;
  return {
    turns,
    stats: {
      calls: calls.length,
      kept: count("keep"),
      truncated: count("truncate"),
      stubbed: count("stub"),
      tokensBefore: Math.round(estimateGeminiChars(middle) / 4),
      tokensAfter: Math.round(estimateGeminiChars(turns) / 4),
    },
  };
}
