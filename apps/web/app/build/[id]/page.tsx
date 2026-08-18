"use client";

import { useEffect, useRef, useState, use, useCallback } from "react";
import Link from "next/link";
import s from "./build.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ── Types ─────────────────────────────────────────────────────────────────────

type BuildStatus = "waiting" | "building" | "done" | "failed";
type SessionPhase = "planning" | "building" | "done";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

interface StageEvent {
  type:    "stage" | "ping" | "waiting" | "complete";
  stage?:  string;
  message?:string;
}

interface ProjectResult {
  projectId:   string;
  status:      BuildStatus;
  appUrl?:     string;
  repoUrl?:    string;
  name?:       string;
  description?:string;
}

interface FileNode {
  path:     string;
  type:     "file" | "dir";
  content?: string;
  ext?:     string;
}

interface BuildPlan {
  appName: string;
  appDescription: string;
  pages?: Array<{ name: string; path: string; description: string }>;
  authType?: "none" | "jwt";
  // support both old (aanyaTasks) and new (frontendTasks) field names
  frontendTasks?: Array<{ description: string; outputFiles: string[] }>;
  aanyaTasks?:   Array<{ description: string; outputFiles: string[] }>;
  backendTasks?:  Array<{ description: string; outputFiles: string[] }>;
  apiContract?: { endpoints: Array<{ route: string; method: string; description: string }> };
  dbSchema?: { tables: Array<{ name: string; fields: Array<{ name: string; type: string }> }> };
}

interface ToolEvent {
  ts: number;
  agent: string;
  type: "tool_call" | "tool_result" | "repair";
  tool: string;
  input?: Record<string, unknown>;
  status?: "ok" | "error";
  errorSnippet?: string;
  [key: string]: unknown;
}

type TerminalEntry =
  | { kind: "log"; text: string }
  | { kind: "event"; event: ToolEvent };

interface ProposedPlan {
  appName: string;
  context: string;
  publicPages:    Array<{ name: string; path: string; description: string }>;
  protectedPages: Array<{ name: string; path: string; description: string }>;
  dbTables: Array<{ name: string; keyColumns: string[] }>;
  apiEndpoints: Array<{ method: string; path: string; description: string }>;
  designDirection: string;
  techStack: { frontend: string; backend: string; database: string; auth: string };
}

interface ElicitationQuestion {
  id: string;
  text: string;
  type: "single" | "multi";
  options: Array<{
    value: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
}

interface StreamChunk {
  type: "token" | "plan_proposed" | "elicitation_question" | "build_triggered" | "error" | "done" | "phase_change" | "project_started";
  content?: string;
  phase?: SessionPhase;
  projectId?: string;
  buildPlan?: BuildPlan;
  proposedPlan?: ProposedPlan;
  elicitationQuestion?: ElicitationQuestion;
}

// ── Tool display config ───────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: string; color: string; label: string }> = {
  write_file:      { icon: "📝", color: "#3FB950", label: "Write File"    },
  edit_file:       { icon: "✏️",  color: "#79C0FF", label: "Edit File"     },
  read_file:       { icon: "📖", color: "#8B949E", label: "Read File"     },
  run_command:     { icon: "▶️",  color: "#D2A8FF", label: "Run Command"   },
  web_search:      { icon: "🔍", color: "#FFA657", label: "Web Search"    },
  screenshot:      { icon: "📸", color: "#FF7B72", label: "Screenshot"    },
  http_request:    { icon: "🌐", color: "#79C0FF", label: "HTTP"          },
  docker_compose:  { icon: "🐳", color: "#1F6FEB", label: "Docker"        },
  db_query:        { icon: "🗄️",  color: "#FFBD2E", label: "DB Query"     },
  repair:          { icon: "🔧", color: "#FFA657", label: "Self-Repair"   },
  navya_review:    { icon: "🔬", color: "#79C0FF", label: "Logic QA"      },
  karan_review:    { icon: "🔒", color: "#F85149", label: "Security QA"   },
  deepika_review:  { icon: "⚡", color: "#D2A8FF", label: "Performance QA" },
};

function eventSummary(ev: ToolEvent): string {
  if (ev.type === "tool_result") return ev.status === "error" ? "✗ failed" : "✓ done";
  const inp = ev.input ?? {};
  if (ev.tool === "write_file")    return String(inp.path ?? "");
  if (ev.tool === "edit_file")     return String(inp.path ?? "");
  if (ev.tool === "read_file")     return String(inp.path ?? "");
  if (ev.tool === "run_command")   return String(inp.command ?? JSON.stringify(inp)).slice(0, 60);
  if (ev.tool === "web_search")    return String(inp.query ?? "");
  if (ev.tool === "http_request")  return `${inp.method ?? "GET"} ${inp.url ?? ""}`;
  if (ev.tool === "docker_compose")return String(inp.action ?? "up");
  return JSON.stringify(inp).slice(0, 60);
}

function ActionCard({ ev }: { ev: ToolEvent }) {
  if (ev.type === "repair") {
    const attempt = typeof ev.attempt === "number" ? ev.attempt : null;
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "6px 0",
                    background: "rgba(255,166,87,0.08)", borderLeft: "2px solid #FFA657",
                    paddingLeft: "10px", margin: "2px 0", borderRadius: "0 6px 6px 0" }}>
        <span style={{ fontSize: "13px", flexShrink: 0, lineHeight: 1.4 }}>🔧</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "#FFA657", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {attempt !== null ? `Fixing… attempt ${attempt}/3` : "Self-Repair"}
          </span>
          {ev.errorSnippet && (
            <div style={{ fontSize: "10px", color: "#8B949E", marginTop: "2px", fontFamily: "monospace",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {String(ev.errorSnippet).slice(0, 120)}
            </div>
          )}
        </div>
      </div>
    );
  }

  const meta    = TOOL_META[ev.tool] ?? { icon: "⚙️", color: "#8B949E", label: ev.tool };
  const isCall  = ev.type === "tool_call";
  const isResult = ev.type === "tool_result";
  const failed  = isResult && ev.status === "error";

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "4px 0", opacity: isResult ? 0.75 : 1 }}>
      <span style={{ fontSize: "13px", flexShrink: 0, lineHeight: 1.4 }}>{meta.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: "10px", fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {meta.label}
        </span>
        {isCall && (
          <div style={{ fontSize: "11px", color: "#C9D1D9", fontFamily: "monospace", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {eventSummary(ev)}
          </div>
        )}
        {isResult && (
          <div style={{ fontSize: "11px", color: failed ? "#F85149" : "#3FB950", marginTop: "1px", display: "flex", alignItems: "center", gap: "6px" }}>
            {failed ? "✗ failed" : "✓ passed"}
            {typeof ev.score === "number" && (
              <span style={{
                fontSize: "10px", fontWeight: 700, padding: "1px 5px", borderRadius: "4px",
                background: (ev.score as number) >= 85 ? "rgba(63,185,80,0.15)" : "rgba(248,81,73,0.15)",
                color: (ev.score as number) >= 85 ? "#3FB950" : "#F85149",
                fontFamily: "monospace",
              }}>
                {ev.score}/100
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Build Analytics Panel ─────────────────────────────────────────────────────

interface AgentMetric {
  label: string;
  eventCount: number;
  qaScore?: number;
  repairAttempts: number;
  firstEventTs?: number;
  lastEventTs?: number;
}

function BuildAnalyticsPanel({ entries }: { entries: TerminalEntry[] }) {
  const [open, setOpen] = useState(false);

  const metrics = (() => {
    const map = new Map<string, AgentMetric>();
    let totalRepairs = 0;

    const get = (label: string): AgentMetric => {
      if (!map.has(label)) map.set(label, { label, eventCount: 0, repairAttempts: 0 });
      return map.get(label)!;
    };

    for (const entry of entries) {
      if (entry.kind !== "event") continue;
      const ev = entry.event;
      const ts = ev.ts as number | undefined;

      if (ev.type === "repair") {
        totalRepairs++;
        const m = get("Fixer");
        m.repairAttempts++;
        m.eventCount++;
        if (ts) { if (!m.firstEventTs) m.firstEventTs = ts; m.lastEventTs = ts; }
        continue;
      }

      const label = String(ev.agent || "Builder");
      const m = get(label);
      m.eventCount++;
      if (ts) { if (!m.firstEventTs) m.firstEventTs = ts; m.lastEventTs = ts; }
      if (ev.type === "tool_result" && typeof ev.score === "number") {
        m.qaScore = ev.score as number;
      }
    }

    return { agents: Array.from(map.values()), totalRepairs };
  })();

  const durationLabel = (m: AgentMetric) => {
    if (!m.firstEventTs || !m.lastEventTs || m.firstEventTs === m.lastEventTs) return "—";
    const s = Math.round((m.lastEventTs - m.firstEventTs) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  if (metrics.agents.length === 0) return null;

  return (
    <div style={{ borderTop: "1px solid #21262D", background: "#0D1117" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", padding: "6px 14px", display: "flex", alignItems: "center", gap: "6px",
                 background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#8B949E" }}>
          📊 Build Analytics
        </span>
        {metrics.totalRepairs > 0 && (
          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "999px", background: "rgba(255,166,87,0.18)", color: "#FFA657", fontWeight: 700 }}>
            {metrics.totalRepairs} fix{metrics.totalRepairs !== 1 ? "es" : ""}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: "9px", color: "#8B949E" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 10px", fontFamily: "var(--nx-ff-mono)", fontSize: "11px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#6E7681", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ textAlign: "left", padding: "4px 0", fontWeight: 600 }}>Agent</th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Events</th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>QA Score</th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Fixes</th>
                <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 600 }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {metrics.agents.map(m => (
                <tr key={m.label} style={{ borderTop: "1px solid #161B22" }}>
                  <td style={{ padding: "5px 0", color: "#C9D1D9" }}>{m.label}</td>
                  <td style={{ textAlign: "right", padding: "5px 8px", color: "#8B949E" }}>{m.eventCount}</td>
                  <td style={{ textAlign: "right", padding: "5px 8px" }}>
                    {m.qaScore != null ? (
                      <span style={{ color: m.qaScore >= 85 ? "#3FB950" : "#F85149", fontWeight: 700 }}>
                        {m.qaScore}
                      </span>
                    ) : <span style={{ color: "#6E7681" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", padding: "5px 8px", color: m.repairAttempts > 0 ? "#FFA657" : "#6E7681" }}>
                    {m.repairAttempts > 0 ? m.repairAttempts : "—"}
                  </td>
                  <td style={{ textAlign: "right", padding: "5px 0", color: "#8B949E" }}>{durationLabel(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Live Activity Feed — right panel during build ─────────────────────────────

const PIPELINE_STAGES: Array<{ key: string; label: string; icon: string }> = [
  { key: "spec",     label: "Spec",    icon: "📋" },
  { key: "generate", label: "Build",   icon: "🔨" },
  { key: "qa",       label: "QA",      icon: "🔬" },
  { key: "repair",   label: "Fix",     icon: "🔧" },
  { key: "deploy",   label: "Deploy",  icon: "🚀" },
];

function resolveStageIdx(stage: string): number {
  if (stage.includes("spec") || stage.includes("saanvi") || stage.includes("arjun")) return 0;
  if (stage.includes("generate") || stage.includes("build") || stage.includes("aanya") || stage.includes("shubham") || stage.includes("pranav")) return 1;
  if (stage.includes("qa") || stage.includes("navya") || stage.includes("karan") || stage.includes("deepika")) return 2;
  if (stage.includes("repair") || stage.includes("fix")) return 3;
  if (stage.includes("deploy") || stage.includes("deliver") || stage.includes("riya")) return 4;
  return 0;
}

function LiveActivityFeed({
  entries, stage, stageMessage,
}: { entries: TerminalEntry[]; stage: string; stageMessage: string }) {
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [entries]);

  const currentStageIdx = resolveStageIdx(stage);

  // Only show actionable events (not every read_file/heartbeat noise)
  const feedEvents = entries.filter(e => {
    if (e.kind !== "event") return false;
    const { type, tool } = e.event;
    if (type === "repair") return true;
    if (type === "tool_result") return true;
    if (tool === "write_file" || tool === "edit_file") return true;
    if (tool === "run_command" || tool === "docker_compose") return true;
    return false;
  }).slice(-60);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Stage progress header */}
      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", flexShrink: 0 }}>
        <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--nx-text3)", marginBottom: "12px" }}>
          Pipeline Progress
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0" }}>
          {PIPELINE_STAGES.map((ps, idx) => {
            const done    = idx < currentStageIdx;
            const current = idx === currentStageIdx;
            return (
              <div key={ps.key} style={{ display: "flex", alignItems: "flex-start", flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", minWidth: 0, flex: "none", width: "44px" }}>
                  <div style={{
                    width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: done ? "10px" : "11px",
                    background: done ? "var(--nx-green)" : current ? "var(--nx-accent)" : "var(--nx-bg-base)",
                    border: `1.5px solid ${done ? "var(--nx-green)" : current ? "var(--nx-accent)" : "var(--nx-border)"}`,
                    color: done || current ? "#fff" : "var(--nx-text3)",
                    boxShadow: current ? "0 0 10px rgba(99,102,241,0.4)" : "none",
                    transition: "all 0.3s ease",
                  }}>
                    {done ? "✓" : ps.icon}
                  </div>
                  <div style={{
                    fontSize: "9px", fontWeight: current ? 700 : 500,
                    color: current ? "var(--nx-accent-text)" : done ? "var(--nx-text2)" : "var(--nx-text3)",
                    textAlign: "center", lineHeight: 1.2,
                  }}>
                    {ps.label}
                  </div>
                </div>
                {idx < PIPELINE_STAGES.length - 1 && (
                  <div style={{
                    flex: 1, height: "1.5px", marginTop: "10px",
                    background: done ? "var(--nx-green)" : "var(--nx-border)",
                    transition: "background 0.3s ease",
                  }} />
                )}
              </div>
            );
          })}
        </div>
        {/* Current status message */}
        <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "7px" }}>
          <span className={`${s.statusDot} ${s.building}`} />
          <span style={{ fontSize: "11px", color: "var(--nx-text2)", lineHeight: 1.4, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {stageMessage}
          </span>
        </div>
      </div>

      {/* Event cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", background: "#0D1117" }}>
        {feedEvents.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "80%", gap: "12px", color: "#6E7681" }}>
            <div style={{ fontSize: "26px" }}>⚙️</div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#8B949E" }}>Pipeline starting…</div>
            <div style={{ fontSize: "11px", color: "#6E7681" }}>Tool events appear here in real time</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {feedEvents.map((entry, i) =>
              entry.kind === "event" ? <ActionCard key={i} ev={entry.event} /> : null
            )}
          </div>
        )}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}

// ── File tree helpers ─────────────────────────────────────────────────────────

function extOf(path: string) { return path.split(".").pop()?.toLowerCase() ?? ""; }

function colorForExt(ext: string) {
  if (ext === "ts")   return "var(--nx-blue)";
  if (ext === "tsx")  return "var(--nx-cyan)";
  if (ext === "css")  return "var(--nx-purple)";
  if (ext === "json") return "var(--nx-yellow)";
  if (ext === "sql")  return "var(--nx-orange)";
  if (ext === "md")   return "var(--nx-text3)";
  return "var(--nx-text2)";
}

function badgeClass(ext: string): string {
  const map: Record<string, string | undefined> = { ts:s.ts, tsx:s.tsx, css:s.css, sql:s.sql, md:s.md, json:s.json };
  return map[ext] ?? "";
}

interface TreeNode {
  name: string; path: string; type: "file" | "dir"; ext?: string; content?: string; children: TreeNode[];
}

function buildTree(files: FileNode[]): TreeNode[] {
  const root: TreeNode = { name:"", path:"", type:"dir", children:[] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      let child = cur.children.find(c => c.name === part);
      if (!child) {
        const isLast = i === parts.length - 1;
        const newChild: TreeNode = {
          name: part, path: parts.slice(0, i+1).join("/"),
          type: isLast ? "file" : "dir",
          ext:  isLast ? extOf(f.path) : undefined,
          content: isLast ? f.content : undefined,
          children: [],
        };
        cur.children.push(newChild);
        child = newChild;
      }
      cur = child;
    }
  }
  return root.children;
}

function FileTreeNode({ node, depth, selected, onSelect }: {
  node: TreeNode; depth: number; selected: string | null; onSelect: (n: TreeNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const indent = depth * 12;

  if (node.type === "dir") {
    return (
      <>
        <div
          className={`${s.fileItem} ${s.folderItem} ${open ? s.open : ""}`}
          style={{ paddingLeft: 12 + indent, height: "26px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          onClick={() => setOpen(o => !o)}
        >
          <i className={`nxi ${open ? "nxi-folder-open" : "nxi-folder"} ${s.fileItemIcon}`}
             style={{ color: open ? "var(--nx-accent)" : "var(--nx-text2)", fontSize: 13 }} />
          <span className={s.fileItemName} style={{ fontSize: "12px", color: "var(--nx-text)" }}>{node.name}</span>
          <i className={`nxi ${open ? "nxi-chevron-d" : "nxi-chevron-r"}`}
             style={{ fontSize: 9, color: "var(--nx-text3)", marginLeft: "auto" }} />
        </div>
        {open && node.children.map(c => (
          <FileTreeNode key={c.path} node={c} depth={depth+1} selected={selected} onSelect={onSelect} />
        ))}
      </>
    );
  }

  const ext = node.ext ?? "";
  return (
    <div
      className={`${s.fileItem} ${selected === node.path ? s.selected : ""}`}
      style={{ paddingLeft: 12 + indent, height: "26px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
               background: selected === node.path ? "var(--nx-bg-subtle)" : "transparent" }}
      onClick={() => onSelect(node)}
    >
      <i className="nxi nxi-file" style={{ color: colorForExt(ext), fontSize: 13 }} />
      <span className={s.fileItemName} style={{ fontSize: "12px", color: selected === node.path ? "var(--nx-text)" : "var(--nx-text2)" }}>{node.name}</span>
      {ext && <span className={`${s.fileItemBadge} ${badgeClass(ext)}`} style={{ fontSize: "9px" }}>{ext}</span>}
    </div>
  );
}

// ── Plan Preview card (shown in Planning Mode right panel) ────────────────────

function PlanPreview({ plan }: { plan: BuildPlan | null }) {
  if (!plan) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
                    alignItems: "center", color: "var(--nx-text3)", gap: "12px", padding: "40px", textAlign: "center" }}>
        <div style={{ fontSize: "28px" }}>📋</div>
        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--nx-text2)" }}>Build Specification</span>
        <p style={{ fontSize: "12px", maxWidth: "240px", lineHeight: 1.6 }}>
          Chat with the assistant to plan your app. The confirmed specification will appear here.
        </p>
        {[65, 80, 55, 70].map((w, i) => (
          <div key={i} className={s.skeletonLine} style={{ width: `${w}%`, height: "8px", marginTop: "4px" }} />
        ))}
      </div>
    );
  }

  const frontendTasks = plan.frontendTasks ?? plan.aanyaTasks ?? [];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px" }}>
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--nx-accent)", marginBottom: "4px" }}>{plan.appName}</div>
        <div style={{ fontSize: "12px", color: "var(--nx-text2)", lineHeight: 1.6 }}>{plan.appDescription}</div>
      </div>

      {plan.pages?.length ? (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--nx-text3)", marginBottom: "8px" }}>Pages</div>
          {plan.pages.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontFamily: "var(--nx-ff-mono)", fontSize: "11px", color: "var(--nx-accent-text)", background: "var(--nx-bg-subtle)", padding: "1px 6px", borderRadius: "4px", flexShrink: 0 }}>{p.path}</span>
              <span style={{ fontSize: "12px", color: "var(--nx-text2)" }}>{p.description}</span>
            </div>
          ))}
        </div>
      ) : null}

      {plan.authType && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--nx-text3)", marginBottom: "6px" }}>Auth</div>
          <span style={{ fontSize: "12px", color: "var(--nx-text)", background: "var(--nx-bg-subtle)", padding: "2px 8px", borderRadius: "4px" }}>
            {plan.authType === "jwt" ? "Sign up / Login (JWT)" : "No authentication"}
          </span>
        </div>
      )}

      {plan.apiContract?.endpoints?.length ? (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--nx-text3)", marginBottom: "8px" }}>API Endpoints</div>
          {plan.apiContract.endpoints.map((ep, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", fontFamily: "var(--nx-ff-mono)", fontSize: "11px" }}>
              <span style={{ color: "var(--nx-accent-text)", fontWeight: 700, width: "44px", flexShrink: 0 }}>{ep.method}</span>
              <span style={{ color: "var(--nx-text2)" }}>{ep.route}</span>
            </div>
          ))}
        </div>
      ) : null}

      {plan.dbSchema?.tables?.length ? (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--nx-text3)", marginBottom: "8px" }}>Database Tables</div>
          {plan.dbSchema.tables.map((t, i) => (
            <div key={i} style={{ marginBottom: "4px", fontSize: "12px" }}>
              <span style={{ color: "var(--nx-text)", fontFamily: "var(--nx-ff-mono)" }}>{t.name}</span>
              <span style={{ color: "var(--nx-text3)", marginLeft: "8px" }}>({t.fields.length} fields)</span>
            </div>
          ))}
        </div>
      ) : null}

      {frontendTasks.length ? (
        <div>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--nx-text3)", marginBottom: "8px" }}>Frontend Tasks</div>
          {frontendTasks.map((t, i) => (
            <div key={i} style={{ fontSize: "12px", color: "var(--nx-text2)", marginBottom: "4px", paddingLeft: "8px", borderLeft: "2px solid var(--nx-border)" }}>
              {t.description}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Proposed Plan Panel (Claude Code-style) ───────────────────────────────────

function ProposedPlanPanel({
  plan,
  onAccept,
  onRevise,
  onReject,
  reviseInput,
  onReviseInput,
  revising,
}: {
  plan: ProposedPlan;
  onAccept: () => void;
  onRevise: (msg: string) => void;
  onReject: () => void;
  reviseInput: string;
  onReviseInput: (v: string) => void;
  revising: boolean;
}) {
  const [showRevise, setShowRevise] = useState(false);

  const dbTables = Array.isArray(plan.dbTables) ? plan.dbTables : [];
  const publicPages = Array.isArray(plan.publicPages) ? plan.publicPages : [];
  const protectedPages = Array.isArray(plan.protectedPages) ? plan.protectedPages : [];
  const apiEndpoints = Array.isArray(plan.apiEndpoints) ? plan.apiEndpoints : [];
  const techStack = plan.techStack || { frontend: "", backend: "", database: "", auth: "" };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--nx-text3)", marginBottom: "10px" }}>{title}</div>
      {children}
    </div>
  );

  const Badge = ({ label, color }: { label: string; color: string }) => (
    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", background: `${color}22`, color, border: `1px solid ${color}44`, fontFamily: "var(--nx-ff-mono)" }}>{label}</span>
  );

  const methodColor: Record<string, string> = { GET: "#3FB950", POST: "#79C0FF", PUT: "#D2A8FF", PATCH: "#FFA657", DELETE: "#F85149" };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Scrollable plan content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px 0" }}>
        {/* Header */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--nx-text)", marginBottom: "6px" }}>{plan.appName}</div>
          <div style={{ fontSize: "12px", color: "var(--nx-text2)", lineHeight: 1.7 }}>{plan.context}</div>
        </div>

        {/* Tech stack */}
        <Section title="Technology Stack">
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {[
              { label: "Frontend", value: techStack.frontend },
              { label: "Backend",  value: techStack.backend  },
              { label: "Database", value: techStack.database },
              { label: "Auth",     value: techStack.auth     },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", gap: "10px", fontSize: "12px" }}>
                <span style={{ color: "var(--nx-text3)", width: "64px", flexShrink: 0 }}>{label}:</span>
                <span style={{ color: "var(--nx-text)" }}>{value}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Public pages */}
        {publicPages.length > 0 && (
          <Section title="Public Pages (no login required)">
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {publicPages.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  <span style={{ fontFamily: "var(--nx-ff-mono)", fontSize: "11px", color: "var(--nx-green)", background: "rgba(63,185,80,0.1)", padding: "2px 7px", borderRadius: "4px", flexShrink: 0 }}>{p.path}</span>
                  <span style={{ fontSize: "12px", color: "var(--nx-text2)", paddingTop: "1px" }}>{p.description}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Protected pages */}
        {protectedPages.length > 0 && (
          <Section title="Sign-In / Protected Pages">
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {protectedPages.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  <span style={{ fontFamily: "var(--nx-ff-mono)", fontSize: "11px", color: "var(--nx-accent-text)", background: "rgba(99,102,241,0.15)", padding: "2px 7px", borderRadius: "4px", flexShrink: 0 }}>{p.path}</span>
                  <span style={{ fontSize: "12px", color: "var(--nx-text2)", paddingTop: "1px" }}>{p.description}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* API endpoints */}
        {apiEndpoints.length > 0 && (
          <Section title="API Endpoints">
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {apiEndpoints.map((ep, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Badge label={ep.method} color={methodColor[ep.method] ?? "#8B949E"} />
                  <span style={{ fontFamily: "var(--nx-ff-mono)", fontSize: "11px", color: "var(--nx-text)", flexShrink: 0 }}>{ep.path}</span>
                  <span style={{ fontSize: "11px", color: "var(--nx-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.description}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* DB tables */}
        {dbTables.length > 0 && (
          <Section title="Database Tables">
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {dbTables.map((t, i) => (
                <div key={i}>
                  <div style={{ fontFamily: "var(--nx-ff-mono)", fontSize: "12px", color: "var(--nx-yellow)", marginBottom: "3px" }}>{t.name}</div>
                  <div style={{ fontSize: "11px", color: "var(--nx-text3)", paddingLeft: "12px" }}>{Array.isArray(t.keyColumns) ? t.keyColumns.join(", ") : String(t.keyColumns)}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Design */}
        {plan.designDirection && (
          <Section title="Design Direction">
            <div style={{ fontSize: "12px", color: "var(--nx-text2)", lineHeight: 1.7, fontStyle: "italic" }}>{plan.designDirection}</div>
          </Section>
        )}
      </div>

      {/* Revise text box (shown when Revise is clicked) */}
      {showRevise && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--nx-border)", background: "var(--nx-bg-base)" }}>
          <textarea
            autoFocus
            value={reviseInput}
            onChange={e => onReviseInput(e.target.value)}
            placeholder="Describe what you'd like to change..."
            rows={2}
            style={{ width: "100%", background: "var(--nx-bg-elevated)", border: "1px solid var(--nx-border)", borderRadius: "8px", color: "var(--nx-text)", fontSize: "12px", padding: "8px 12px", fontFamily: "var(--nx-ff-sans)", resize: "none", outline: "none", boxSizing: "border-box" }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (reviseInput.trim()) { onRevise(reviseInput); setShowRevise(false); } } }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
            <button onClick={() => setShowRevise(false)} style={{ fontSize: "12px", padding: "5px 14px", borderRadius: "6px", border: "1px solid var(--nx-border)", background: "transparent", color: "var(--nx-text2)", cursor: "pointer" }}>Cancel</button>
            <button
              onClick={() => { if (reviseInput.trim()) { onRevise(reviseInput); setShowRevise(false); } }}
              disabled={!reviseInput.trim() || revising}
              style={{ fontSize: "12px", padding: "5px 14px", borderRadius: "6px", border: "none", background: "var(--nx-accent)", color: "var(--nx-text-inv)", cursor: "pointer", opacity: (!reviseInput.trim() || revising) ? 0.5 : 1 }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Accept / Revise / Reject action bar */}
      <div style={{ padding: "14px 16px", borderTop: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "12px", color: "var(--nx-text3)", flex: 1 }}>Plan ready for review</span>
        <button
          onClick={onReject}
          style={{ fontSize: "12px", padding: "7px 16px", borderRadius: "7px", border: "1px solid var(--nx-border)", background: "transparent", color: "var(--nx-text2)", cursor: "pointer", fontWeight: 600 }}
        >
          Reject
        </button>
        <button
          onClick={() => setShowRevise(v => !v)}
          style={{ fontSize: "12px", padding: "7px 16px", borderRadius: "7px", border: "1px solid var(--nx-accent)", background: "transparent", color: "var(--nx-accent-text)", cursor: "pointer", fontWeight: 600 }}
        >
          Revise…
        </button>
        <button
          onClick={onAccept}
          disabled={revising}
          style={{ fontSize: "12px", padding: "7px 20px", borderRadius: "7px", border: "none", background: "var(--nx-accent)", color: "var(--nx-text-inv)", cursor: "pointer", fontWeight: 700, opacity: revising ? 0.6 : 1 }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}

// ── Chat bubble ───────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: "12px" }}>
      <div style={{
        maxWidth: "80%",
        background: isUser ? "var(--nx-accent)" : "var(--nx-bg-elevated)",
        color: isUser ? "var(--nx-text-inv)" : "var(--nx-text)",
        borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
        padding: "10px 14px",
        fontSize: "13px",
        lineHeight: 1.6,
        border: isUser ? "none" : "1px solid var(--nx-border)",
        whiteSpace: "pre-wrap",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ── Elicitation Widget — structured question tiles (NexSidi-unique design) ───

function ElicitationWidget({
  question,
  onAnswer,
}: {
  question: ElicitationQuestion;
  onAnswer: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleOption = (value: string) => {
    if (question.type === "single") {
      onAnswer(value);
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value); else next.add(value);
        return next;
      });
    }
  };

  const handleMultiSubmit = () => {
    const vals = Array.from(selected);
    if (vals.length > 0) onAnswer(vals.join(", "));
  };

  return (
    <div style={{
      margin: "0 0 12px 0",
      background: "rgba(10, 14, 26, 0.97)",
      border: "1px solid rgba(99, 102, 241, 0.35)",
      borderRadius: "12px",
      padding: "16px",
      backdropFilter: "blur(16px)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
    }}>
      {/* Question label */}
      <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--nx-accent-text)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--nx-accent)", display: "inline-block" }} />
        Clarifying question
      </div>
      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--nx-text)", marginBottom: "12px", lineHeight: 1.5 }}>
        {question.text}
      </div>

      {/* Option tiles */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {question.options.map(opt => {
          const isSel = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => handleOption(opt.value)}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 14px", borderRadius: "9px", cursor: "pointer",
                border: isSel
                  ? "1px solid var(--nx-accent)"
                  : opt.recommended
                  ? "1px solid rgba(99,102,241,0.45)"
                  : "1px solid var(--nx-border)",
                background: isSel
                  ? "rgba(99,102,241,0.18)"
                  : opt.recommended
                  ? "rgba(99,102,241,0.07)"
                  : "rgba(255,255,255,0.03)",
                textAlign: "left", transition: "all 0.12s ease",
                boxShadow: isSel ? "0 0 0 1px rgba(99,102,241,0.3)" : "none",
              }}
            >
              {/* Multi-select checkbox */}
              {question.type === "multi" && (
                <div style={{
                  width: "15px", height: "15px", borderRadius: "4px", flexShrink: 0,
                  border: `1px solid ${isSel ? "var(--nx-accent)" : "var(--nx-border)"}`,
                  background: isSel ? "var(--nx-accent)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isSel && <span style={{ fontSize: "9px", color: "#fff", lineHeight: 1 }}>✓</span>}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: isSel ? "var(--nx-accent-text)" : "var(--nx-text)" }}>
                    {opt.label}
                  </span>
                  {opt.recommended && (
                    <span style={{
                      fontSize: "9px", fontWeight: 700, padding: "1px 6px", borderRadius: "999px",
                      background: "rgba(251,191,36,0.18)", color: "#FBBF24",
                      border: "1px solid rgba(251,191,36,0.3)", letterSpacing: "0.05em",
                    }}>
                      RECOMMENDED
                    </span>
                  )}
                </div>
                {opt.description && (
                  <div style={{ fontSize: "11px", color: "var(--nx-text3)", marginTop: "2px", lineHeight: 1.4 }}>
                    {opt.description}
                  </div>
                )}
              </div>
              {/* Single: arrow indicator */}
              {question.type === "single" && (
                <span style={{ fontSize: "12px", color: "var(--nx-text3)", flexShrink: 0 }}>→</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Multi-select submit */}
      {question.type === "multi" && (
        <div style={{ marginTop: "10px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleMultiSubmit}
            disabled={selected.size === 0}
            style={{
              padding: "7px 18px", borderRadius: "7px", border: "none",
              background: selected.size > 0 ? "var(--nx-accent)" : "var(--nx-bg-subtle)",
              color: selected.size > 0 ? "var(--nx-text-inv)" : "var(--nx-text3)",
              fontSize: "12px", fontWeight: 700,
              cursor: selected.size > 0 ? "pointer" : "default",
              transition: "all 0.12s ease",
            }}
          >
            Continue ({selected.size} selected)
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // ── Planner phase state ───────────────────────────────────────────────────
  const [phase,        setPhase]        = useState<SessionPhase>("planning");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput,    setChatInput]    = useState("");
  const [chatLoading,  setChatLoading]  = useState(false);
  const [streamingMsg, setStreamingMsg] = useState("");
  const [buildPlan,    setBuildPlan]    = useState<BuildPlan | null>(null);

  // ── Build phase state ─────────────────────────────────────────────────────
  const [status,          setStatus]          = useState<BuildStatus>("waiting");
  const [stage,           setStage]           = useState("spec");
  const [stageMessage,    setStageMessage]    = useState("Initializing...");
  const [result,          setResult]          = useState<ProjectResult | null>(null);
  const [tree,            setTree]            = useState<TreeNode[]>([]);
  const [selFile,         setSelFile]         = useState<TreeNode | null>(null);
  const [fileContent,     setFileContent]     = useState<string | null>(null);
  const [fileLoading,     setFileLoading]     = useState(false);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([
    { kind: "log", text: "🚀 Build started.\nConnecting to workspace log stream...\n" },
  ]);
  const [buildPlanModal, setBuildPlanModal] = useState<BuildPlan | null>(null);
  const [proposedPlan,      setProposedPlan]      = useState<ProposedPlan | null>(null);
  const [elicitationQuestion, setElicitationQuestion] = useState<ElicitationQuestion | null>(null);
  const [reviseInput,    setReviseInput]    = useState("");
  const [revising,       setRevising]       = useState(false);
  const [changeRequest,  setChangeRequest]  = useState("");
  const [submitting,     setSubmitting]     = useState(false);
  const [previewKey,     setPreviewKey]     = useState(0);

  const chatEndRef     = useRef<HTMLDivElement | null>(null);
  const termEndRef     = useRef<HTMLDivElement | null>(null);
  const esRef          = useRef<EventSource | null>(null);
  const wsRef          = useRef<WebSocket | null>(null);
  const wsRetryRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRetryCount   = useRef(0);
  const firstMsgSent   = useRef(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  // Ref mirrors chatLoading so sendChatMessage's guard is always current
  // even when captured in a stale closure (React strict-mode double-mount).
  const chatLoadingRef = useRef(false);
  // Stable ref so the ?q= auto-send always calls the latest sendChatMessage.
  const sendChatMessageRef = useRef<(msg: string) => Promise<void>>(async () => {});

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, streamingMsg]);
  useEffect(() => { termEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [terminalEntries]);

  // ── Load existing session on mount ────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/chat/${id}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.messages?.length) {
          setChatMessages(data.messages);
          // Prevent re-sending the ?q= URL param when session already has messages
          firstMsgSent.current = true;
        }
        if (data.phase)     setPhase(data.phase);
        if (data.buildPlan) setBuildPlan(data.buildPlan);
      })
      .catch(() => {});
  }, [id]);

  // ── Send initial message from URL param (?q=...) on first load ───────────
  useEffect(() => {
    if (firstMsgSent.current) return;
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;
    firstMsgSent.current = true;
    // Use the ref so we always call the currently-mounted sendChatMessage,
    // not the one captured at first-mount (which strict mode discards).
    setTimeout(() => sendChatMessageRef.current(q), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Chat: send a message ──────────────────────────────────────────────────
  const sendChatMessage = useCallback(async (msg: string) => {
    // Use ref for the guard so stale closures (strict-mode first mount) see
    // the real current value, not the one captured when the callback was made.
    if (!msg.trim() || chatLoadingRef.current) return;
    chatLoadingRef.current = true;
    setChatLoading(true);
    setChatMessages(prev => [...prev, { role: "user", content: msg.trim(), ts: Date.now() }]);
    setChatInput("");
    setStreamingMsg("");

    try {
      const res = await fetch(`${API}/api/chat`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ message: msg.trim(), sessionId: id }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          try {
            const chunk = JSON.parse(data) as StreamChunk;

            if (chunk.type === "token" && chunk.content) {
              assistantText += chunk.content;
              setStreamingMsg(assistantText);
            }

            if (chunk.type === "error" && chunk.content) {
              setChatMessages(prev => [
                ...prev,
                { role: "assistant", content: `⚠️ ${chunk.content}`, ts: Date.now() },
              ]);
              setStreamingMsg("");
            }

            if (chunk.type === "elicitation_question" && chunk.elicitationQuestion) {
              // Show the question as a chat bubble AND as the interactive widget
              const q = chunk.elicitationQuestion;
              setChatMessages(prev => [...prev, { role: "assistant", content: q.text, ts: Date.now() }]);
              assistantText = ""; // prevent done handler from re-pushing this text
              setStreamingMsg("");
              setElicitationQuestion(q);
            }

            if (chunk.type === "plan_proposed" && chunk.proposedPlan) {
              setProposedPlan(chunk.proposedPlan);
              setElicitationQuestion(null); // close any open widget
              setReviseInput("");
            }

            if (chunk.type === "build_triggered" && chunk.projectId) {
              if (chunk.buildPlan) setBuildPlan(chunk.buildPlan);
              setRevising(false);
              setProposedPlan(null);
              setElicitationQuestion(null);
              setPhase("building");
              setStatus("building");
              setStageMessage("Build started. Writing your code...");
              // Bug 5 fix: always tear down existing SSE before opening a fresh one
              if (esRef.current) { esRef.current.close(); esRef.current = null; }
              startBuildWatching();
            }

            if (chunk.type === "done") {
              if (assistantText.trim()) {
                setChatMessages(prev => [
                  ...prev,
                  { role: "assistant", content: assistantText.trim(), ts: Date.now() },
                ]);
                assistantText = ""; // Bug 1 fix: clear so the post-loop fallback doesn't double-push
              }
              setStreamingMsg("");
            }
          } catch { /* skip malformed */ }
        }
      }
      // Commit any text that arrived before the `done` event
      // (race: stream closes at same moment as done event → done never processed)
      if (assistantText.trim()) {
        setChatMessages(prev => [...prev, { role: "assistant", content: assistantText.trim(), ts: Date.now() }]);
        setStreamingMsg("");
      }
    } catch (err) {
      console.error("[chat] send error", err);
    }

    chatLoadingRef.current = false;
    setChatLoading(false);
  // chatLoading intentionally omitted — guard uses chatLoadingRef instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the stable ref pointing at the latest sendChatMessage.
  useEffect(() => { sendChatMessageRef.current = sendChatMessage; }, [sendChatMessage]);

  const handleChatKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage(chatInput);
    }
  };

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sessionId", id);
    try {
      const res = await fetch(`${API}/api/chat/attachment`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (res.ok) {
        const { summary } = await res.json() as { summary: string };
        sendChatMessage(`[Attachment: ${file.name}]\n${summary}`);
      }
    } catch (err) {
      console.error("[attach] upload error", err);
    }
    // Reset so the same file can be re-attached
    if (attachInputRef.current) attachInputRef.current.value = "";
  };

  // ── Build watching (SSE + WebSocket) ─────────────────────────────────────

  const startBuildWatching = useCallback(() => {
    // Bug 5 fix: don't guard with esRef.current — the build_triggered handler
    // already closes+nulls esRef before calling us. The phase-change useEffect
    // below still needs the guard for the "already in build mode on load" case,
    // but that guard is separate. Here we always open fresh.
    const es = new EventSource(`${API}/api/pipeline/${id}/status`);
    esRef.current = es;
    es.onmessage = (e) => {
      let ev: StageEvent;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === "waiting") { setStatus("waiting"); return; }
      if (ev.type === "complete") { setStatus("done"); fetchResult(); fetchTree(); return; }
      if (ev.stage) {
        setStage(ev.stage);
        setStatus("building");
        if (ev.message) setStageMessage(ev.message);
        if (ev.stage === "await_spec_approval") fetchBuildPlanForModal();
        if (ev.stage === "done" || ev.stage === "deliver") { fetchResult(); fetchTree(); }
      }
    };
    es.onerror = () => { fetchResult(); fetchTree(); };
    connectWs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // For projects already in building/done phase on page load (not from chat stream)
  // 2026-08-18: real bug found live (RateGate, navigated here straight from
  // Gatherly's build page) — this was keyed on [phase] only. Navigating
  // client-side between two DIFFERENT projects' build pages that happen to
  // be in the SAME phase (e.g. both "building") never re-ran this effect at
  // all, so the OLD project's EventSource/WebSocket were never torn down and
  // a fresh connection for the NEW project's id was never opened either —
  // the `!esRef.current` guard saw the old (still-truthy, merely closed)
  // ref and skipped startBuildWatching() entirely. Confirmed live: the Live
  // Output panel stayed stuck on "Reconnecting..." for the new project
  // using stale retry state from the previous one, and only a full page
  // reload (a fresh component mount) recovered it. Adding `id` to the
  // dependency array, and explicitly nulling the refs (not just calling
  // .close(), which doesn't clear them) plus resetting wsRetryCount, makes
  // every project switch tear down the old connections and start the new
  // one with a genuinely clean slate.
  useEffect(() => {
    if (phase !== "planning") {
      if (!esRef.current) startBuildWatching(); // guard here — only on load, not on stream event
      fetchResult();
      fetchTree();
    }
    return () => {
      esRef.current?.close();
      esRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      if (wsRetryRef.current) clearTimeout(wsRetryRef.current);
      wsRetryCount.current = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, id]);

  function connectWs() {
    if (wsRetryRef.current) clearTimeout(wsRetryRef.current);
    const wsUrl = `${API.replace(/^http/, "ws")}/ws/pipeline/${id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "log" && data.content) {
          setTerminalEntries(prev => [...prev, { kind: "log", text: data.content }]);
        } else if (data.type === "event" && data.event) {
          setTerminalEntries(prev => [...prev, { kind: "event", event: data.event as ToolEvent }]);
        }
      } catch {}
    };

    ws.onopen = () => { wsRetryCount.current = 0; };
    // 2026-08-17: real bug found live (gatherly1) — after 8 failed attempts
    // (e.g. spanning a brief api restart) this gave up PERMANENTLY, leaving
    // the last "Reconnecting in Ns..." message frozen on screen forever with
    // no further attempts and no way to recover short of a full page reload
    // — even though the underlying WS server was healthy again seconds
    // later. A live log stream for a pipeline that can run for a long time
    // should never permanently give up; the existing exponential backoff
    // already caps the retry interval at 30s, so retrying indefinitely
    // costs at most one attempt every 30s, not a tight loop.
    ws.onclose = () => {
      const delay = Math.min(1000 * 2 ** wsRetryCount.current, 30000);
      wsRetryCount.current++;
      setTerminalEntries(prev => [...prev, { kind: "log", text: `\n⏳ Reconnecting in ${Math.round(delay/1000)}s...\n` }]);
      wsRetryRef.current = setTimeout(connectWs, delay);
    };
  }

  async function fetchResult() {
    try {
      const r = await fetch(`${API}/api/pipeline/${id}`);
      if (!r.ok) return;
      const data: ProjectResult = await r.json();
      setResult(data);
      if (data.appUrl) { setStatus("done"); setStageMessage("Your app is ready!"); }
      else setStatus(data.status);
    } catch {}
  }

  async function fetchTree() {
    try {
      const r = await fetch(`${API}/api/artifacts/${id}/tree`);
      if (!r.ok) return;
      const data = await r.json() as { tree: any[] };
      if (data.tree?.length) {
        const flatten = (nodes: any[]): FileNode[] =>
          nodes.flatMap(n =>
            n.type === "directory"
              ? flatten(n.children ?? [])
              : [{ path: n.path, type: "file" as const, ext: n.path.split(".").pop() }]
          );
        setTree(buildTree(flatten(data.tree)));
      }
    } catch {}
  }

  async function fetchFileContent(path: string) {
    setFileLoading(true);
    setFileContent(null);
    try {
      const r = await fetch(`${API}/api/artifacts/${id}/file?path=${encodeURIComponent(path)}`);
      if (!r.ok) { setFileContent("// Could not load file"); return; }
      const data = await r.json() as { content: string };
      setFileContent(data.content);
    } catch { setFileContent("// Error loading file"); }
    finally { setFileLoading(false); }
  }

  async function fetchBuildPlanForModal(attempts = 6) {
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fetch(`${API}/api/artifacts/${id}/build-plan.json`);
        if (r.ok) {
          const plan: BuildPlan = await r.json();
          setBuildPlanModal(plan);
          return;
        }
      } catch {}
      await new Promise(res => setTimeout(res, 2000));
    }
  }

  async function approveSpec() {
    setSubmitting(true);
    try {
      const body = changeRequest.trim() ? JSON.stringify({ changes: changeRequest.trim() }) : undefined;
      const res = await fetch(`${API}/api/pipeline/${id}/approve-spec`, {
        method: "POST", credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined, body,
      });
      if (res.ok) {
        setStage("generate");
        setStageMessage("Plan approved. Building codebase...");
        setTerminalEntries(prev => [...prev, { kind: "log", text: "\n🟢 Spec approved. Building...\n" }]);
        setChangeRequest("");
        setBuildPlanModal(null);
      }
    } catch {}
    setSubmitting(false);
  }

  async function approveDeploy() {
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/pipeline/${id}/approve-deploy`, { method: "POST", credentials: "include" });
      if (res.ok) {
        setStage("deliver");
        setStageMessage("Deployment approved. Launching containers...");
        setTerminalEntries(prev => [...prev, { kind: "log", text: "\n🟢 Deployment approved.\n" }]);
      }
    } catch {}
    setSubmitting(false);
  }

  const isDone = status === "done" || (status === "failed" && !!result?.appUrl);

  // ── Render: Planning Mode ─────────────────────────────────────────────────

  if (phase === "planning") {
    return (
      <div className={s.root} style={{ height: "100vh", overflow: "hidden" }}>
        <nav className={s.nav} style={{ height: "50px", borderBottom: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", padding: "0 20px" }}>
          <Link href="/dashboard" className={s.navBrand}>
            <div className={s.navLogo}>N</div>
            NexSidi
          </Link>
          <span className={s.navSep}>/</span>
          <span className={s.navProject}>New Project</span>
          <div className={s.navSpacer} />
          <span style={{ fontSize: "11px", color: "var(--nx-text3)", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--nx-accent)", display: "inline-block" }} />
            Planning
          </span>
        </nav>

        <div style={{ display: "flex", height: "calc(100vh - 50px)", background: "var(--nx-bg-base)" }}>
          {/* LEFT: Chat */}
          <div style={{ width: "50%", borderRight: "1px solid var(--nx-border)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--nx-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "var(--nx-text-inv)", fontWeight: 700 }}>N</div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--nx-text)" }}>NexSidi Assistant</div>
                <div style={{ fontSize: "11px", color: "var(--nx-text3)" }}>Describe your app — I'll plan and build it</div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
              {chatMessages.length === 0 && !streamingMsg && !chatLoading && (
                <div style={{ textAlign: "center", color: "var(--nx-text3)", fontSize: "13px", marginTop: "60px" }}>
                  <div style={{ fontSize: "32px", marginBottom: "12px" }}>💬</div>
                  <p>Tell me what you want to build.<br />I'll ask if I need details, then start immediately.</p>
                </div>
              )}
              {chatMessages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
              {(streamingMsg || chatLoading) && (
                <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "12px" }}>
                  <div style={{ maxWidth: "80%", background: "var(--nx-bg-elevated)", color: "var(--nx-text)", borderRadius: "12px 12px 12px 2px", padding: "10px 14px", fontSize: "13px", lineHeight: 1.6, border: "1px solid var(--nx-border)", whiteSpace: "pre-wrap" }}>
                    {streamingMsg || <span style={{ color: "var(--nx-text3)" }}>Thinking...</span>}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div style={{ borderTop: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)" }}>
              {/* Elicitation widget — slides in above the input when a question is pending */}
              {elicitationQuestion && (
                <div style={{ padding: "12px 16px 0" }}>
                  <ElicitationWidget
                    question={elicitationQuestion}
                    onAnswer={(answer) => {
                      setElicitationQuestion(null);
                      sendChatMessage(answer);
                    }}
                  />
                </div>
              )}

              <div style={{ padding: "16px 20px" }}>
                <input
                  ref={attachInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.json,.csv"
                  style={{ display: "none" }}
                  onChange={handleAttachFile}
                />
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <button
                    onClick={() => attachInputRef.current?.click()}
                    disabled={chatLoading || !!elicitationQuestion}
                    title="Attach file"
                    style={{ height: "56px", width: "40px", background: "transparent", border: "1px solid var(--nx-border)", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--nx-text3)", opacity: (chatLoading || !!elicitationQuestion) ? 0.4 : 1 }}
                  >
                    📎
                  </button>
                  <textarea
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={handleChatKey}
                    placeholder={elicitationQuestion ? "Answer the question above by clicking an option…" : "Describe your app... (Enter to send, Shift+Enter for new line)"}
                    disabled={chatLoading || !!elicitationQuestion}
                    rows={2}
                    style={{ flex: 1, background: "var(--nx-bg-base)", border: "1px solid var(--nx-border)", borderRadius: "8px", color: "var(--nx-text)", fontSize: "13px", padding: "8px 12px", fontFamily: "var(--nx-ff-sans)", resize: "none", outline: "none", opacity: elicitationQuestion ? 0.5 : 1 }}
                  />
                  <button
                    onClick={() => sendChatMessage(chatInput)}
                    disabled={chatLoading || !chatInput.trim() || !!elicitationQuestion}
                    style={{ height: "56px", width: "56px", background: "var(--nx-accent)", border: "none", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: (chatLoading || !chatInput.trim() || !!elicitationQuestion) ? 0.5 : 1 }}
                  >
                    <i className="nxi nxi-arrow-r" style={{ fontSize: 16, color: "var(--nx-text-inv)" }} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Plan Panel — ProposedPlanPanel when plan is ready, PlanPreview otherwise */}
          <div style={{ width: "50%", display: "flex", flexDirection: "column", background: "var(--nx-bg-elevated)" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--nx-border)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--nx-text3)", display: "flex", alignItems: "center", gap: "8px" }}>
              {proposedPlan ? (
                <>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--nx-accent)", display: "inline-block" }} />
                  Plan Proposed
                </>
              ) : "Build Specification Preview"}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              {proposedPlan ? (
                <ProposedPlanPanel
                  plan={proposedPlan}
                  reviseInput={reviseInput}
                  onReviseInput={setReviseInput}
                  revising={revising}
                  onAccept={() => {
                    setRevising(true);
                    sendChatMessage("build it");
                    setProposedPlan(null);
                  }}
                  onRevise={(msg) => {
                    setRevising(false);
                    setReviseInput("");
                    sendChatMessage(msg);
                    setProposedPlan(null);
                  }}
                  onReject={() => {
                    setProposedPlan(null);
                    sendChatMessage("Please start over with a different approach.");
                  }}
                />
              ) : (
                <PlanPreview plan={buildPlan} />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Build / IDE Mode ──────────────────────────────────────────────

  return (
    <div className={s.root} style={{ height: "100vh", overflow: "hidden" }}>
      <nav className={s.nav} style={{ height: "50px", borderBottom: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", padding: "0 20px" }}>
        <Link href="/dashboard" className={s.navBrand}>
          <div className={s.navLogo}>N</div>
          NexSidi Workspace
        </Link>
        <span className={s.navSep}>/</span>
        <span className={s.navProject}>{result?.name || buildPlan?.appName || `Project ${id.slice(0, 8)}`}</span>
        <div className={s.navSpacer} />
        <div style={{ marginRight: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={`${s.statusDot} ${s[status === "building" ? "building" : isDone ? "done" : "waiting"]}`} />
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--nx-accent-text)" }}>{stageMessage}</span>
        </div>
        {isDone && result?.appUrl && (
          <a href={result.appUrl} target="_blank" rel="noreferrer" className={`${s.navBtn} ${s.primary}`}>
            <i className="nxi nxi-link" style={{ fontSize: 12 }} />
            Open App
          </a>
        )}
      </nav>

      <div style={{ display: "flex", height: "calc(100vh - 50px)", width: "100vw", background: "var(--nx-bg-base)" }}>
        {/* PANEL 1: File Explorer (20%) */}
        <div style={{ width: "20%", minWidth: "220px", borderRight: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--nx-border)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--nx-text3)", display: "flex", justifyContent: "space-between" }}>
            <span>Explorer</span>
            {tree.length > 0 && <span style={{ fontSize: "10px", color: "var(--nx-green)" }}>{tree.length} items</span>}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {!isDone && tree.length === 0 ? (
              <div style={{ padding: "16px", color: "var(--nx-text3)", fontSize: "12px" }}>
                <div style={{ marginBottom: "12px" }}>Files appear here during generation...</div>
                {[60, 80, 45, 70].map((w, i) => (
                  <div key={i} className={s.skeletonLine} style={{ width: `${w}%`, margin: "6px 0", height: "10px" }} />
                ))}
              </div>
            ) : tree.map(node => (
              <FileTreeNode key={node.path} node={node} depth={0} selected={selFile?.path ?? null}
                onSelect={(n) => { setSelFile(n); if (n.type === "file") fetchFileContent(n.path); }} />
            ))}
          </div>
        </div>

        {/* PANEL 2: Code Editor + Terminal (45%) */}
        <div style={{ width: "45%", borderRight: "1px solid var(--nx-border)", display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ height: "60%", borderBottom: "1px solid var(--nx-border)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", display: "flex", alignItems: "center", gap: "8px" }}>
              <i className="nxi nxi-code" style={{ color: "var(--nx-accent)" }} />
              <span style={{ fontFamily: "var(--nx-ff-mono)", fontSize: "12px", color: "var(--nx-text)" }}>
                {selFile ? selFile.path : "Workspace Editor"}
              </span>
              {fileContent && (
                <button onClick={() => navigator.clipboard.writeText(fileContent)}
                  style={{ marginLeft: "auto", background: "none", border: "1px solid var(--nx-border)", color: "var(--nx-text2)", fontSize: "11px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer" }}>
                  Copy
                </button>
              )}
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
              {fileLoading ? (
                <div style={{ color: "var(--nx-text3)", fontSize: "12px", fontFamily: "var(--nx-ff-mono)" }}>Loading...</div>
              ) : selFile ? (
                <pre style={{ margin: 0, fontFamily: "var(--nx-ff-mono)", fontSize: "12px", color: "var(--nx-text)", lineHeight: 1.5, tabSize: 2, whiteSpace: "pre-wrap" }}>
                  {fileContent ?? "// Empty file"}
                </pre>
              ) : (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "var(--nx-text3)", gap: "8px" }}>
                  <i className="nxi nxi-file" style={{ fontSize: "28px" }} />
                  <span style={{ fontSize: "13px" }}>Select a file from Explorer</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ height: "40%", display: "flex", flexDirection: "column", background: "#0D1117" }}>
            <div style={{ padding: "6px 14px", borderBottom: "1px solid #21262D", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#8B949E" }}>💻 Live Output</span>
              <button onClick={() => setTerminalEntries([])} style={{ background: "none", border: "none", color: "#8B949E", cursor: "pointer", fontSize: "11px" }}>Clear</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", fontFamily: "var(--nx-ff-mono)", fontSize: "11px", color: "#C9D1D9", lineHeight: 1.5 }}>
              {terminalEntries.map((entry, i) =>
                entry.kind === "log"
                  ? <pre key={i} style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "inherit" }}>{entry.text}</pre>
                  : <ActionCard key={i} ev={entry.event} />
              )}
              <div ref={termEndRef} />
            </div>
            <BuildAnalyticsPanel entries={terminalEntries} />
          </div>
        </div>

        {/* PANEL 3: Activity Feed during build → Live Preview when done (35%) */}
        <div style={{ width: "35%", display: "flex", flexDirection: "column", height: "100%", background: "var(--nx-bg-elevated)" }}>
          {/* Browser chrome — shown only when done (preview is live) */}
          {isDone && (
            <div style={{ height: "38px", borderBottom: "1px solid var(--nx-border)", display: "flex", alignItems: "center", padding: "0 12px", gap: "8px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: "4px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#FF5F56" }} />
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#FFBD2E" }} />
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#27C93F" }} />
              </div>
              <button onClick={() => setPreviewKey(k => k + 1)} style={{ background: "none", border: "none", color: "var(--nx-text2)", cursor: "pointer" }} title="Refresh">🔄</button>
              <div style={{ flex: 1, height: "24px", background: "var(--nx-bg-base)", border: "1px solid var(--nx-border)", borderRadius: "12px", display: "flex", alignItems: "center", padding: "0 10px", fontSize: "11px", color: "var(--nx-text3)", fontFamily: "var(--nx-ff-mono)" }}>
                {result?.appUrl ?? "Waiting for deployment..."}
              </div>
            </div>
          )}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {isDone && result?.appUrl ? (
              <iframe key={previewKey} src={result.appUrl} style={{ width: "100%", height: "100%", border: "none" }} sandbox="allow-same-origin allow-scripts allow-forms" />
            ) : (
              <LiveActivityFeed
                entries={terminalEntries}
                stage={stage}
                stageMessage={stageMessage}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modal: Spec Approval (legacy Saanvi flow) */}
      {stage === "await_spec_approval" && buildPlanModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
          <div style={{ background: "var(--nx-bg-elevated)", border: "1px solid var(--nx-border)", borderRadius: "8px", maxWidth: "600px", width: "100%", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "1.5rem", color: "var(--nx-accent)", fontWeight: "bold" }}>
              📋 Review Build Plan: {buildPlanModal.appName}
            </h3>
            <p style={{ color: "var(--nx-text2)", fontSize: "13px" }}>{buildPlanModal.appDescription}</p>
            <div style={{ border: "1px solid var(--nx-border)", borderRadius: "6px", padding: "12px", background: "var(--nx-bg-base)" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "var(--nx-text3)" }}>Frontend Pages:</span>
              <ul style={{ paddingLeft: "16px", margin: "8px 0 0", fontSize: "12px", color: "var(--nx-text)" }}>
                {(buildPlanModal.frontendTasks ?? buildPlanModal.aanyaTasks ?? []).map((t, idx) => (
                  <li key={idx} style={{ margin: "4px 0" }}>
                    <strong>{t.description}</strong>
                    <div style={{ fontSize: "11px", color: "var(--nx-text2)" }}>{t.outputFiles.join(", ")}</div>
                  </li>
                ))}
              </ul>
            </div>
            {buildPlanModal.apiContract?.endpoints?.length && (
              <div style={{ border: "1px solid var(--nx-border)", borderRadius: "6px", padding: "12px", background: "var(--nx-bg-base)" }}>
                <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "var(--nx-text3)" }}>Backend Endpoints:</span>
                <div style={{ fontSize: "12px", color: "var(--nx-text)", marginTop: "8px" }}>
                  {buildPlanModal.apiContract.endpoints.map((e, idx) => (
                    <div key={idx} style={{ margin: "4px 0", fontFamily: "var(--nx-ff-mono)" }}>
                      <span style={{ color: "var(--nx-accent-text)" }}>{e.method}</span> {e.route}
                      <span style={{ fontFamily: "var(--nx-ff-sans)", color: "var(--nx-text2)", marginLeft: "8px" }}>{e.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "var(--nx-text3)" }}>Request changes (optional)</label>
              <textarea value={changeRequest} onChange={e => setChangeRequest(e.target.value)}
                placeholder="e.g. Add dark mode, change primary color..."
                rows={3} style={{ background: "var(--nx-bg-base)", border: "1px solid var(--nx-border)", borderRadius: "6px", color: "var(--nx-text)", fontSize: "12px", padding: "8px 10px", resize: "vertical", outline: "none" }} />
            </div>
            <button onClick={approveSpec} disabled={submitting}
              style={{ height: "40px", background: "var(--nx-accent)", border: "none", color: "var(--nx-text-inv)", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" }}>
              {submitting ? "Approving..." : changeRequest.trim() ? "Approve with Changes" : "Approve and Build"}
            </button>
          </div>
        </div>
      )}

      {/* Modal: Deploy Approval */}
      {stage === "await_deploy_approval" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ background: "var(--nx-bg-elevated)", border: "1px solid var(--nx-border)", borderRadius: "8px", maxWidth: "480px", width: "100%", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", textAlign: "center" }}>
            <h3 style={{ fontSize: "1.5rem", color: "var(--nx-green)", fontWeight: "bold" }}>✅ Quality Checks Passed</h3>
            <p style={{ color: "var(--nx-text2)", fontSize: "13px" }}>
              The codebase compiled and passed quality checks. Approve to launch your local containers.
            </p>
            <button onClick={approveDeploy} disabled={submitting}
              style={{ height: "44px", background: "var(--nx-green)", border: "none", color: "var(--nx-text-inv)", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px", marginTop: "8px" }}>
              {submitting ? "Deploying..." : "Approve and Launch"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
