import type { StreamItem, ToolEvent } from "../../lib/live";

/**
 * Turns the raw event feed into plain-language narration.
 *
 * IDEs don't put a terminal in front of you to explain what they're doing —
 * they say it in a sentence and keep the log behind a panel you can open.
 * This is that translation layer: agents' reasoning becomes the prose, tool
 * calls become short statements of what was actually done, and raw log text
 * is dropped entirely.
 */

export interface Thought {
  id: number;
  /** Public workstream label, already sanitised server-side. */
  who: string;
  /** The sentence shown to the reader. */
  text: string;
  /** Optional supporting detail — a path, a command, an error. */
  meta?: string;
  ts: number;
  kind: "thinking" | "doing" | "problem";
  /** How many identical consecutive actions this line stands for. */
  repeat?: number;
}

/** Present-tense statement of what a tool call actually does. */
export function describeAction(ev: ToolEvent): { text: string; meta?: string } | null {
  const input = (ev.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const path = str(input.path) ?? str(ev.path);

  switch (ev.tool) {
    case "write_file":
      return { text: "Writing a file", meta: path };
    case "write_files": {
      const n = num(input.count) ?? 0;
      return { text: `Writing ${n} file${n === 1 ? "" : "s"}`, meta: (input.paths as string[] | undefined)?.slice(0, 3).join(", ") };
    }
    case "edit_file":
      return { text: "Editing a file", meta: path };
    case "delete_file":
      return { text: "Removing a file", meta: path };
    case "read_file":
    case "list_files":
    case "query_symbol":
      // Reading is how an agent thinks, not something worth narrating on its
      // own — it would bury the handful of lines that describe real work.
      return null;
    case "run_command":
      return { text: "Running a command", meta: str(input.command) };
    case "http_request":
      return { text: "Checking an endpoint", meta: `${str(input.method) ?? "GET"} ${str(input.url) ?? ""}`.trim() };
    case "docker_compose":
      return { text: `Bringing the app ${str(input.action) === "down" ? "down" : "up"}`, meta: str(input.service) };
    case "web_search":
      return { text: "Looking something up", meta: str(input.query) };
    case "fetch_url":
      return { text: "Fetching a page", meta: str(input.url) };
    case "screenshot":
      return { text: "Taking a screenshot", meta: str(input.url) };
    case "db_query":
      return { text: "Querying the database", meta: str(input.query) };
    case "submit_findings":
      return { text: "Reporting review findings" };
    case "escalate_finding":
      return { text: "Escalating a finding to another workstream", meta: str(input.reason) };
    case "task_complete":
      return {
        text: input.verification_passed === true ? "Finished and verified its work" : "Finished its work",
      };
    default:
      return { text: ev.tool.replace(/_/g, " ") };
  }
}

/**
 * Collapses the stream into narration.
 *
 * Consecutive identical actions from the same workstream are folded into one
 * line with a count: an agent writing forty files should read as one
 * sentence, not forty.
 */
export function narrate(items: StreamItem[], limit = 200): Thought[] {
  const out: Thought[] = [];

  for (const item of items) {
    if (item.kind !== "event") continue;
    const ev = item.event;
    const who = ev.agent || "Build";

    if (ev.type === "thinking") {
      const text = typeof ev.text === "string" ? ev.text.trim() : "";
      if (text) out.push({ id: item.id, who, text, ts: ev.ts, kind: "thinking" });
      continue;
    }

    // A failed result is the one result worth surfacing — successes are
    // already implied by the action line that precedes them.
    if (ev.type === "tool_result") {
      if (ev.status !== "error") continue;
      out.push({
        id: item.id,
        who,
        text: "Ran into a problem",
        meta: typeof ev.summary === "string" ? ev.summary : undefined,
        ts: ev.ts,
        kind: "problem",
      });
      continue;
    }

    if (ev.type !== "tool_call") continue;

    const action = describeAction(ev);
    if (!action) continue;

    const prev = out[out.length - 1];
    if (prev && prev.kind === "doing" && prev.who === who && prev.text.startsWith(action.text)) {
      // Fold the repeat rather than emitting a near-identical line.
      const count = (prev.repeat ?? 1) + 1;
      prev.repeat = count;
      prev.text = `${action.text} (${count})`;
      prev.meta = action.meta ?? prev.meta;
      prev.ts = ev.ts;
      continue;
    }

    out.push({ id: item.id, who, text: action.text, meta: action.meta, ts: ev.ts, kind: "doing" });
  }

  return out.length > limit ? out.slice(out.length - limit) : out;
}
