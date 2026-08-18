"use client";

import { useEffect, useRef } from "react";
import type { StreamItem, ToolEvent } from "../../lib/live";
import s from "./console.module.css";

/**
 * One-line, human-readable description of what a tool call actually did.
 *
 * Reads from the summarised `input` the runtime emits (see summarizeToolInput
 * in packages/agent-runtime/src/gemini-loop.ts) — never assumes a raw arg
 * payload is present, since events written before that summariser existed,
 * and events from the two older loops, carry slightly different shapes.
 */
export function describeEvent(ev: ToolEvent): string {
  const input = (ev.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);

  const path = str(input.path) ?? str(ev.path);

  switch (ev.tool) {
    case "write_file":
      return path ? `${path}${num(input.bytes) !== undefined ? ` · ${formatBytes(num(input.bytes)!)}` : ""}` : "wrote a file";
    case "write_files": {
      const count = num(input.count) ?? 0;
      const paths = Array.isArray(input.paths) ? (input.paths as string[]) : [];
      const head = paths.slice(0, 2).join(", ");
      return count > 2 ? `${count} files · ${head}, +${count - 2} more` : head || `${count} files`;
    }
    case "edit_file":   return path ? `edited ${path}` : "edited a file";
    case "read_file":   return path ?? "read a file";
    case "delete_file": return path ? `deleted ${path}` : "deleted a file";
    case "list_files":  return `listing ${str(input.dir) ?? "."}`;
    case "run_command": return str(input.command) ?? "ran a command";
    case "http_request":return `${str(input.method) ?? "GET"} ${str(input.url) ?? ""}`.trim();
    case "docker_compose": return `compose ${str(input.action) ?? ""} ${str(input.service) ?? ""}`.trim();
    case "web_search":  return str(input.query) ?? "searched the web";
    case "fetch_url":   return str(input.url) ?? "fetched a url";
    case "screenshot":  return str(input.url) ?? "captured a screenshot";
    case "db_query":    return str(input.query) ?? "queried the database";
    case "escalate_finding": return str(input.reason) ?? "escalated a finding";
    case "task_complete":
      return input.verification_passed === true ? "completed — verified" : "completed";
    default: {
      const first = Object.entries(input).find(([, v]) => typeof v === "string");
      return first ? `${first[0]}: ${first[1]}` : "";
    }
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function clockTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function EventCard({ ev }: { ev: ToolEvent }) {
  const isError = ev.status === "error";
  const isResult = ev.type === "tool_result";
  const detail = describeEvent(ev);
  const summary = typeof ev.summary === "string" ? ev.summary : "";

  return (
    <div className={`${s.card} ${isError ? s.cardError : ""}`}>
      <span className={s.cardTime}>{clockTime(ev.ts)}</span>
      <span className={s.cardAgent}>{ev.agent}</span>
      <span className={s.cardMain}>
        <span className={s.cardTool}>{ev.tool}</span>
        {detail && <div className={s.cardDetail}>{detail}</div>}
        {isResult && summary && <div className={s.cardDetail}>{summary}</div>}
      </span>
      <span
        className={`${s.cardStatus} ${
          isError ? s.statusErr : isResult ? s.statusOk : s.statusRun
        }`}
      >
        {isError ? "error" : isResult ? (ev.status ?? "done") : "running"}
      </span>
    </div>
  );
}

export default function ActivityStream({
  items,
  filterAgent,
  showLogs,
}: {
  items: StreamItem[];
  filterAgent: string | null;
  showLogs: boolean;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const visible = items.filter((item) => {
    if (item.kind === "log") return showLogs && !filterAgent;
    return !filterAgent || item.event.agent === filterAgent;
  });

  // Follow the tail only while the reader is already at the bottom — yanking
  // the view back down while someone is scrolled up reading an earlier error
  // is the single most irritating thing a live feed can do.
  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length]);

  const onScroll = () => {
    const el = paneRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  if (visible.length === 0) {
    return (
      <div className={s.pane}>
        <div className={s.empty}>
          <div className={s.emptyTitle}>Nothing on the wire yet</div>
          <div className={s.emptyHint}>
            {filterAgent
              ? `No activity from ${filterAgent} yet. Clear the filter to see everything.`
              : "Tool calls appear here the moment agents start working."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.pane} ref={paneRef} onScroll={onScroll}>
      <div className={s.stream}>
        {visible.map((item) =>
          item.kind === "event" ? (
            <EventCard key={item.id} ev={item.event} />
          ) : (
            <pre key={item.id} className={s.logLine}>
              {item.text.replace(/\s+$/, "")}
            </pre>
          ),
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
