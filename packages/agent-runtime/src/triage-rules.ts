// Deterministic keep / truncate / stub rules for old tool calls in a
// compacted history (triage compaction plan, docs/nexsidi/plans/2026-09-26-
// triage-compaction.md, Task 4). Pure: no I/O, no LLM. The keep / truncate /
// stub idea is adapted from save-token-jev (MIT); the rules themselves encode
// NexSidi's own tool semantics.
//
// Measured on real saved histories before writing these: in the part of a
// history compaction throws away, read_file and docker_compose output are
// ~72% of all tool output, ~35% of it is exact repeats (same tool + same
// args, a newer copy exists), and today's compaction keeps 1 of 123
// unresolved errors.

export interface TriageCall {
  key: string; // `${callTurn}:${callPart}`
  callTurn: number; // index of the model turn in the middle array
  callPart: number; // part index of the functionCall in that turn
  responseTurn: number; // index of the user turn holding the functionResponse
  responsePart: number; // part index of that functionResponse
  name: string;
  argsKey: string; // argsKeyOf(args)
  target: string | null; // what the call acts on, see targetOf
  rewrites: string[]; // paths this call fully overwrites or deletes (on success)
  contentPaths: string[]; // paths whose file content this call carries in its args
  resultChars: number;
  isError: boolean; // response.status === "error"
  isStub: boolean; // response.compacted === true (stubbed by an earlier compaction)
}

export type TriageAction = "keep" | "truncate" | "stub";

export interface TriageDecision {
  key: string;
  action: TriageAction; // what happens to the call's RESULT
  reason: string;
  // Files whose content in the call's ARGS is stale (fully rewritten or
  // deleted later) and can be replaced by a one-line note. Only present when
  // non-empty. Approved by Amit 2026-09-27: the replay showed generator
  // agents' middles are dominated by write_file content (46-93K tokens).
  stubArgPaths?: string[];
}

// Logs above this are cut to head + tail: the tail is usually the final
// status or error line, the head the command/banner.
export const LOG_KEEP_CHARS = 3_000;

const LOG_TOOLS = new Set(["docker_compose", "run_command"]);

// Recursive sorted-key JSON. NOT JSON.stringify(args, Object.keys(args).sort()):
// a replacer array filters keys at every nesting level, so two calls differing
// only in a nested field (e.g. http_request headers) would collide and one
// would be wrongly stubbed as a repeat.
export function argsKeyOf(args: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, normalize(obj[k])]));
    }
    return v;
  };
  return JSON.stringify(normalize(args) ?? null);
}

export function targetOf(name: string, args: Record<string, unknown>): string | null {
  if (typeof args.path === "string") return args.path;
  if (typeof args.command === "string") return args.command;
  if (typeof args.url === "string") return `${String(args.method ?? "GET")} ${args.url}`;
  if (name === "docker_compose" && typeof args.action === "string") return `docker ${args.action} ${String(args.service ?? "all")}`;
  return null;
}

// Files a call replaces wholesale; edit_file is deliberately excluded (a
// partial edit leaves most of an earlier read still accurate).
export function rewrittenPathsOf(name: string, args: Record<string, unknown>): string[] {
  if ((name === "write_file" || name === "delete_file") && typeof args.path === "string") return [args.path];
  if (name === "write_files" && Array.isArray(args.files)) {
    return (args.files as Array<{ path?: unknown }>).flatMap((f) => (typeof f?.path === "string" ? [f.path] : []));
  }
  return [];
}

// Files whose content a call carries in its args (the big part of a write).
export function contentPathsOf(name: string, args: Record<string, unknown>): string[] {
  if ((name === "write_file" || name === "edit_file") && typeof args.path === "string") return [args.path];
  if (name === "write_files") return rewrittenPathsOf(name, args);
  return [];
}

/**
 * One decision per call, in input order. Walks newest to oldest so "a newer
 * copy exists" is a set lookup. First matching rule wins:
 *   1. already stubbed                                   → keep
 *   2. same name + args appears later                    → stub
 *   3. error, later success on the same name + target    → stub
 *   4. error                                             → keep
 *   5. read_file re-read or fully rewritten later        → stub
 *   6. docker_compose / run_command over LOG_KEEP_CHARS  → truncate
 *   7. anything else                                     → keep
 * Only successful, non-stub calls count as "a newer copy": a newer failure or
 * a newer stub must never make an older full result disposable.
 */
export function decideByRules(calls: TriageCall[]): TriageDecision[] {
  const seenSignatures = new Set<string>();
  const readLater = new Set<string>();
  const rewrittenLater = new Set<string>();
  const succeededLater = new Set<string>();
  const decisions: TriageDecision[] = [];

  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]!;
    const signature = `${c.name}\u0000${c.argsKey}`;
    const targetKey = c.target === null ? null : `${c.name}\u0000${c.target}`;
    // Args: content of a file that a LATER successful call fully rewrites or
    // deletes is stale. Computed before this call's own rewrites are recorded.
    const staleContent = c.contentPaths.filter((p) => rewrittenLater.has(p));
    const decide = (action: TriageAction, reason: string) =>
      decisions.push({ key: c.key, action, reason, ...(staleContent.length > 0 ? { stubArgPaths: staleContent } : {}) });

    if (c.isStub) decide("keep", "already compacted");
    else if (seenSignatures.has(signature)) decide("stub", "same call repeated later");
    else if (c.isError && targetKey && succeededLater.has(targetKey)) decide("stub", "error resolved by a later successful call");
    else if (c.isError) decide("keep", "unresolved error");
    else if (c.name === "read_file" && c.target && (readLater.has(c.target) || rewrittenLater.has(c.target))) decide("stub", "file re-read or rewritten later");
    else if (LOG_TOOLS.has(c.name) && c.resultChars > LOG_KEEP_CHARS) decide("truncate", "long log: head and tail kept");
    else decide("keep", "no newer copy");

    if (c.isStub || c.isError) continue;
    seenSignatures.add(signature);
    if (c.name === "read_file" && c.target) readLater.add(c.target);
    for (const p of c.rewrites) rewrittenLater.add(p);
    if (targetKey) succeededLater.add(targetKey);
  }
  return decisions.reverse();
}
