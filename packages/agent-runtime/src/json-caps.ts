// String caps for tool payloads kept in history. Moved out of
// context-selection.ts (2026-09-26, triage compaction plan Task 4) so the
// triage pass can reuse them without an import cycle; behavior at the
// default `max` is unchanged. See context-selection.ts's trailing-window
// size-cap comment for the live bug these exist for.

export const DEFAULT_MAX_STRING = 4_000;

// Truncates from the middle: keeps the head (usually the meaningful summary)
// and the tail (usually the final status/error line of a long log).
// `slack` (default 0, the original behavior) leaves strings up to max+slack
// alone. A capped string is max + a ~30-char marker long, so a slack above
// the marker length makes re-capping an already-capped string a no-op, which
// the triage pass needs to stay idempotent across repeated compactions.
export function capString(s: string, max = DEFAULT_MAX_STRING, slack = 0): string {
  if (s.length <= max + slack) return s;
  const headLen = Math.floor(max * 0.7);
  const tailLen = max - headLen;
  return `${s.slice(0, headLen)}\n…[${s.length - max} chars truncated]…\n${s.slice(-tailLen)}`;
}

// Caps every string value anywhere inside arbitrary per-tool JSON.
export function capJsonStrings(value: unknown, max = DEFAULT_MAX_STRING, slack = 0, depth = 0): unknown {
  if (depth > 6) return value; // pathological nesting guard
  if (typeof value === "string") return capString(value, max, slack);
  if (Array.isArray(value)) return value.map((v) => capJsonStrings(v, max, slack, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = capJsonStrings(v, max, slack, depth + 1);
    return out;
  }
  return value;
}
