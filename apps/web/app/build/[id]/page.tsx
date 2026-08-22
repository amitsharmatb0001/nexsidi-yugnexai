"use client";

import { useEffect, useRef, useState, use, useCallback } from "react";
import Link from "next/link";
import s from "./build.module.css";
import IDE from "../../../components/ide/IdeWorkspace";
import { ws as ideStyles } from "../../../components/ide/IdeWorkspace.styles";
import PlanPreview, { type BuildPlan } from "../../../components/ide/PlanPreview";
import { useReviewState } from "@/components/nexui/review-gate";
import { Button } from "@/components/nexui/button";
import type { ApiNode } from "../../../lib/tree";

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

// ── Proposed Plan Panel (Claude Code-style) ───────────────────────────────────

/**
 * Renders a proposed plan. Presentation only — accepting, rejecting, or asking
 * for changes is the ReviewGate's job (rendered in IdeWorkspace's Plan drawer),
 * so this panel no longer carries a second, competing set of controls.
 */
function ProposedPlanPanel({ plan }: { plan: ProposedPlan }) {

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

    </div>
  );
}

// ── Elicitation Widget — clarifying-question card ───────────────────────────
// Rebuilt on the same token system as IdeWorkspace (IdeWorkspace.styles.ts)
// instead of its own hard-coded indigo/glow palette — a decision gate is
// already an established shape there (gateCard, for spec/deploy approval),
// so this reuses that family rather than inventing a second visual language
// for what is functionally the same kind of moment: the pipeline waiting on
// a choice only the user can make.

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
    <div className={ideStyles.elicit}>
      <div className={ideStyles.elicitLabel}>
        <span className={ideStyles.elicitLabelDot} />
        Clarifying question
      </div>
      <div className={ideStyles.elicitQuestion}>{question.text}</div>

      <div className={ideStyles.elicitOptions}>
        {question.options.map(opt => {
          const isSel = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleOption(opt.value)}
              className={`${ideStyles.elicitOption} ${isSel ? ideStyles.elicitOptionSelected : opt.recommended ? ideStyles.elicitOptionRecommended : ""}`}
            >
              {question.type === "multi" && (
                <span className={`${ideStyles.elicitCheckbox} ${isSel ? ideStyles.elicitCheckboxChecked : ""}`}>
                  {isSel ? "✓" : null}
                </span>
              )}
              <div className={ideStyles.elicitOptionBody}>
                <div className={ideStyles.elicitOptionTop}>
                  <span className={ideStyles.elicitOptionLabel}>{opt.label}</span>
                  {opt.recommended && <span className={ideStyles.elicitOptionRecTag}>Recommended</span>}
                </div>
                {opt.description && <div className={ideStyles.elicitOptionDesc}>{opt.description}</div>}
              </div>
              {question.type === "single" && <span className={ideStyles.elicitArrow}>→</span>}
            </button>
          );
        })}
      </div>

      {question.type === "multi" && (
        <div className={ideStyles.elicitSubmitRow}>
          <Button size="sm" onClick={handleMultiSubmit} disabled={selected.size === 0}>
            Continue ({selected.size} selected)
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // ── Planner phase state ───────────────────────────────────────────────────
  // `phase` defaults to "planning" because that's the correct state for a
  // genuinely new session — but for a REFRESH of an existing one, the real
  // phase is only known once the mount-restore fetch below resolves. Without
  // this gate, every refresh flashed the empty planning chat first, then
  // snapped to the real screen (IDE, or a resumed conversation) a moment
  // later — the exact "message starts over, then the plan reappears"
  // inconsistency reported live. Nothing renders on the phase/messages axis
  // until session restore has had its one chance to run.
  const [sessionResolved, setSessionResolved] = useState(false);
  const [phase,        setPhase]        = useState<SessionPhase>("planning");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput,    setChatInput]    = useState("");
  const [chatLoading,  setChatLoading]  = useState(false);
  const [streamingMsg, setStreamingMsg] = useState("");
  const [buildPlan,    setBuildPlan]    = useState<BuildPlan | null>(null);
  // The name given at creation (POST /api/projects) — real from the first
  // moment, unlike buildPlan.appName which the planner only infers once the
  // conversation produces a spec. Nothing before this fetched the project's
  // own row at all during planning, so the title bar had no real name to
  // show until a plan existed.
  const [realProjectName, setRealProjectName] = useState<string | null>(null);

  // ── Build phase state ─────────────────────────────────────────────────────
  const [status,          setStatus]          = useState<BuildStatus>("waiting");
  const [stage,           setStage]           = useState("spec");
  const [stageMessage,    setStageMessage]    = useState("Initializing...");
  const [result,          setResult]          = useState<ProjectResult | null>(null);
  const [tree,            setTree]            = useState<ApiNode[]>([]);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([
    { kind: "log", text: "🚀 Build started.\nConnecting to workspace log stream...\n" },
  ]);
  const [buildPlanModal, setBuildPlanModal] = useState<BuildPlan | null>(null);
  const [proposedPlan,      setProposedPlan]      = useState<ProposedPlan | null>(null);
  const [elicitationQuestion, setElicitationQuestion] = useState<ElicitationQuestion | null>(null);
  const planReview = useReviewState();
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

  // ── Load the project's own name on mount ──────────────────────────────────
  // 404s harmlessly for a project id that was only ever generated client-side
  // and never created through POST /api/projects — the appName-inferred
  // fallbacks below still cover that case.
  useEffect(() => {
    fetch(`${API}/api/projects/${id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.name) setRealProjectName(data.name); })
      .catch(() => {});
  }, [id]);

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
      .catch(() => {})
      // Resolved either way — a session that genuinely doesn't exist yet
      // (brand-new id, 404) is just as "known" as one that does; the gate
      // is about not rendering on a guess, not about the fetch succeeding.
      .finally(() => setSessionResolved(true));
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

  // Real bug found live (Brightline Consulting test build): fetchTree() was
  // only ever called once on load and again at completion — never while
  // status stayed "building" in between. The generators write dozens of
  // real files to disk during that window (confirmed via the worker's own
  // logs: 10 backend files, several frontend files, a docker-compose.yml —
  // none of it ever reached the explorer), so the IDE's whole "watch files
  // stream in live" experience was unreachable: the tree just sat frozen on
  // whatever existed at page load until the build finished and everything
  // "snapped" in at once. Polling here, at the same 4s cadence the
  // dashboard already uses for its own "hasBuilding" list refresh, is what
  // actually lets the explorer (and the write-in-progress pulse built on
  // top of it) show anything real during a build.
  useEffect(() => {
    if (status !== "building") return;
    const t = setInterval(() => void fetchTree(), 4000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, id]);

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
      const data = await r.json() as { tree: ApiNode[] };
      // 2026-08-19: this used to flatten the API's already-nested tree down to
      // a file list and then rebuild the hierarchy client-side by splitting
      // each path on "/". On Windows the API emitted backslash paths, so the
      // split never matched and every file landed at the root as a single row
      // labelled with its full raw path ("backend\src\controllers\admin.ts").
      // The separator is now normalised server-side (see toPosixPath in
      // apps/api/src/routes/artifacts.ts), and the nesting the API already
      // provides is used directly rather than being discarded and guessed at.
      if (data.tree?.length) setTree(data.tree);
    } catch {}
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

  // ── Render: Resolving session ─────────────────────────────────────────────
  // See the sessionResolved comment at its declaration — this is the actual
  // gate. One neutral screen on every load, never the wrong one first.

  if (!sessionResolved) {
    return (
      <div className={s.root} style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--nx-bg-base)" }}>
        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--nx-accent)", animation: "nx-session-pulse 1.1s ease-in-out infinite" }} />
        <style>{"@keyframes nx-session-pulse { 0%, 100% { opacity: 0.3; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }"}</style>
      </div>
    );
  }

  // ── Render: Planning Mode ─────────────────────────────────────────────────

  // ── Render ─────────────────────────────────────────────────────────────
  // Always the same workspace shell (rail, sidebar, title bar, drawer) —
  // 2026-08-22: a project used to land on a completely separate planning
  // screen, then jump to this one once a build started. Landing in one
  // continuous IDE from the moment a project is created (with the plan
  // conversation as this shell's own "planning" content, see IdeWorkspace's
  // own header comment) is what "create a project → go straight to the IDE"
  // actually means; two different screens for one project's lifecycle was
  // the "old page" a fresh project used to open into.
  //
  // 2026-08-19 (still true): the build-phase stream renders per-workstream
  // activity, live model telemetry and the file tree as it is written,
  // replacing the earlier fixed three-panel view that could only show a flat
  // file list, a raw terminal and a five-dot progress bar.

  return (
    <IDE
      projectId={id}
      projectName={
        realProjectName
          ?? (phase === "planning"
            ? (proposedPlan?.appName ?? buildPlan?.appName ?? "New project")
            : (result?.name || buildPlan?.appName || `Project ${id.slice(0, 8)}`))
      }
      appUrl={result?.appUrl ?? null}
      isDone={isDone}
      stageMessage={stageMessage}
      tree={tree}
      awaitingSpecApproval={Boolean(buildPlanModal)}
      buildPlan={buildPlanModal}
      awaitingDeployApproval={stage === "await_deploy_approval"}
      submitting={submitting}
      changeRequest={changeRequest}
      onChangeRequest={setChangeRequest}
      onApproveSpec={approveSpec}
      onApproveDeploy={approveDeploy}
      planning={
        phase === "planning"
          ? {
              messages: chatMessages,
              streamingMessage: streamingMsg,
              loading: chatLoading,
              input: chatInput,
              onInputChange: setChatInput,
              onSend: (value) => { if (value.trim()) sendChatMessage(value); },
              composerDisabled: Boolean(elicitationQuestion),
              elicitation: elicitationQuestion ? (
                <ElicitationWidget
                  question={elicitationQuestion}
                  onAnswer={(answer) => {
                    setElicitationQuestion(null);
                    sendChatMessage(answer);
                  }}
                />
              ) : undefined,
              // The planner streams prose first and only emits a structured
              // plan at the end, so "writing" is keyed off the chat stream
              // rather than off partial plan data that does not exist yet.
              planStreaming: chatLoading || Boolean(streamingMsg),
              plan: proposedPlan ? (
                <ProposedPlanPanel plan={proposedPlan} />
              ) : buildPlan ? (
                <PlanPreview plan={buildPlan} />
              ) : undefined,
              review: proposedPlan
                ? {
                    state: planReview.state,
                    onDecide: (decision) => {
                      planReview.decide(decision.scope, decision.id, decision.verdict, decision.note);
                      // The gate is the only place a plan decision is made, so
                      // each verdict maps straight onto the message the
                      // planner expects.
                      if (decision.verdict === "accepted") {
                        setProposedPlan(null);
                        sendChatMessage("build it");
                      } else if (decision.verdict === "changes-requested") {
                        setProposedPlan(null);
                        sendChatMessage(decision.note ?? "Please revise the plan.");
                      } else if (decision.verdict === "rejected") {
                        setProposedPlan(null);
                        sendChatMessage("Please start over with a different approach.");
                      }
                    },
                    onClear: planReview.clear,
                  }
                : undefined,
            }
          : undefined
      }
    />
  );
}
