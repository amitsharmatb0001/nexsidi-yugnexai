"use client";

// Live telemetry hooks for the YugNex console.
//
// Two independent real-time sources, deliberately kept separate because they
// have different lifetimes: system vitals are global and stay connected for
// as long as the console is open, while the build stream is per-project and
// must be torn down and rebuilt whenever the project id changes.

import { useCallback, useEffect, useRef, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const wsBase = () => API.replace(/^http/, "ws");

// ── Types ───────────────────────────────────────────────────────────────────

/** Circuit states as reported by packages/llm-client/src/circuit-breaker.ts. */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN" | string;

export interface RpmState {
  tokens: number;
  utilizationPct: number;
}

export interface SystemVitals {
  ts: number;
  circuits: Record<string, CircuitState>;
  rpm: Record<string, RpmState>;
}

/**
 * A structured tool event, as written to events.jsonl by the agent runtime
 * and relayed by /ws/pipeline/:projectId.
 *
 * `agent` here is ALREADY the public workstream label ("Backend", "Logic QA",
 * …) — the API's sanitizePipelineEvent rewrites the internal roster name
 * before it ever leaves the server. Never render any other field as an
 * identity.
 */
export interface ToolEvent {
  ts: number;
  agent: string;
  /**
   * "thinking" carries the agent's own plain-language reasoning, which is
   * what the narration panel renders instead of raw log text.
   */
  type: "tool_call" | "tool_result" | "repair" | "thinking";
  tool: string;
  /** Present on "thinking" events — one summarised sentence. */
  text?: string;
  input?: Record<string, unknown>;
  status?: string;
  summary?: string;
  path?: string;
  outputPath?: string;
  errorSnippet?: string;
  [key: string]: unknown;
}

export type StreamItem =
  | { kind: "log"; id: number; text: string }
  | { kind: "event"; id: number; event: ToolEvent };

/**
 * A stream item before the sequence id is assigned.
 *
 * Spelled out rather than written as Omit<StreamItem, "id">: Omit does not
 * distribute over a union, so that form collapses to the common members only
 * and drops `text` and `event` entirely.
 */
type StreamItemInput =
  | { kind: "log"; text: string }
  | { kind: "event"; event: ToolEvent };

export type ConnState = "connecting" | "live" | "retrying";

// ── System vitals (/ws/agents) ──────────────────────────────────────────────

/**
 * Subscribes to the global agent-health socket, which pushes circuit-breaker
 * state and per-model RPM utilisation every 2s.
 *
 * This feed already existed and streamed continuously, but nothing in the UI
 * had ever consumed it — so every circuit trip and quota stall was invisible
 * to the user, who could only see that a build had mysteriously slowed down.
 */
export function useSystemVitals(enabled = true): { vitals: SystemVitals | null; conn: ConnState } {
  const [vitals, setVitals] = useState<SystemVitals | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      const ws = new WebSocket(`${wsBase()}/ws/agents`);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConn("live");
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type === "agent_health") {
            setVitals({ ts: data.ts, circuits: data.circuits ?? {}, rpm: data.rpm ?? {} });
          }
        } catch {
          // A malformed frame must never kill the socket.
        }
      };
      // Retry forever with capped backoff. A console can be left open across
      // an API restart; permanently giving up would strand it showing stale
      // numbers with no indication they had stopped updating.
      ws.onclose = () => {
        if (closedRef.current) return;
        setConn("retrying");
        const delay = Math.min(1000 * 2 ** attemptRef.current, 30000);
        attemptRef.current++;
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      attemptRef.current = 0;
    };
  }, [enabled]);

  return { vitals, conn };
}

// ── Build stream (/ws/pipeline/:id) ─────────────────────────────────────────

const MAX_ITEMS = 1500;

/**
 * Subscribes to a single project's live log + structured event stream.
 *
 * Every dependency that identifies *which* project this is belongs in the
 * effect's dep array: a client-side navigation between two projects that
 * happen to share a phase must still tear down the old socket and open a new
 * one. Refs are explicitly nulled on teardown, since calling .close() leaves
 * a truthy (merely closed) object behind that a later `if (!ref.current)`
 * guard would read as "still connected".
 */
export function useBuildStream(projectId: string, enabled = true) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const seqRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !projectId) return;
    closedRef.current = false;
    // A project switch starts from an empty feed rather than showing the
    // previous project's history under the new project's name.
    setItems([]);
    seqRef.current = 0;

    const push = (item: StreamItemInput) => {
      setItems((prev) => {
        const next = [...prev, { ...item, id: seqRef.current++ } as StreamItem];
        // Bounded: a long build emits tens of thousands of lines, and an
        // unbounded array degrades the whole tab.
        return next.length > MAX_ITEMS ? next.slice(next.length - MAX_ITEMS) : next;
      });
    };

    const connect = () => {
      if (closedRef.current) return;
      const ws = new WebSocket(`${wsBase()}/ws/pipeline/${projectId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConn("live");
        // /ws/pipeline/:id sends COMPLETE state on every connect — the whole
        // pipeline.log followed by every line of events.jsonl — and only then
        // starts tailing deltas. Appending that to what we already have would
        // duplicate the entire history on every reconnect, and this hook
        // reconnects indefinitely (an API restart mid-build is routine). The
        // replay is authoritative, so rebuild from it rather than append to a
        // feed that already contains it.
        setItems([]);
        seqRef.current = 0;
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type === "log" && data.content) {
            push({ kind: "log", text: data.content });
          } else if (data?.type === "event" && data.event) {
            push({ kind: "event", event: data.event as ToolEvent });
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (closedRef.current) return;
        setConn("retrying");
        const delay = Math.min(1000 * 2 ** attemptRef.current, 30000);
        attemptRef.current++;
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      attemptRef.current = 0;
    };
  }, [projectId, enabled]);

  const clear = useCallback(() => setItems([]), []);

  return { items, conn, clear };
}

// ── Derived views over the event stream ─────────────────────────────────────

export interface WorkstreamActivity {
  /** Public workstream label, already sanitised server-side. */
  agent: string;
  lastTool: string;
  lastAt: number;
  calls: number;
  errors: number;
  active: boolean;
}

/**
 * Rolls the raw event feed up into one row per workstream.
 *
 * "Active" is a recency window rather than an explicit start/stop signal: the
 * runtime emits per-tool-call events with no session boundaries, so the only
 * honest read of "working right now" is "emitted something a moment ago".
 */
export function deriveWorkstreams(items: StreamItem[], now: number, activeWindowMs = 20_000): WorkstreamActivity[] {
  const byAgent = new Map<string, WorkstreamActivity>();

  for (const item of items) {
    if (item.kind !== "event") continue;
    const ev = item.event;
    const agent = ev.agent || "Build Agent";
    const existing = byAgent.get(agent);
    const isError = ev.status === "error";

    if (!existing) {
      byAgent.set(agent, {
        agent,
        lastTool: ev.tool,
        lastAt: ev.ts,
        calls: ev.type === "tool_call" ? 1 : 0,
        errors: isError ? 1 : 0,
        active: false,
      });
    } else {
      if (ev.ts >= existing.lastAt) {
        existing.lastAt = ev.ts;
        existing.lastTool = ev.tool;
      }
      if (ev.type === "tool_call") existing.calls++;
      if (isError) existing.errors++;
    }
  }

  return [...byAgent.values()]
    .map((w) => ({ ...w, active: now - w.lastAt < activeWindowMs }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** Files touched by write/edit/delete events, most recent first. */
export function deriveTouchedFiles(items: StreamItem[]): { path: string; at: number; tool: string }[] {
  const byPath = new Map<string, { path: string; at: number; tool: string }>();

  for (const item of items) {
    if (item.kind !== "event") continue;
    const ev = item.event;
    if (ev.type !== "tool_call") continue;

    const paths: string[] = [];
    const single = (ev.input?.path ?? ev.path) as unknown;
    if (typeof single === "string") paths.push(single);
    const many = ev.input?.paths as unknown;
    if (Array.isArray(many)) for (const p of many) if (typeof p === "string") paths.push(p);

    if (!WRITE_TOOLS.has(ev.tool)) continue;
    for (const p of paths) byPath.set(p, { path: p, at: ev.ts, tool: ev.tool });
  }

  return [...byPath.values()].sort((a, b) => b.at - a.at);
}

const WRITE_TOOLS = new Set(["write_file", "write_files", "edit_file", "delete_file"]);
