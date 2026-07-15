"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import s from "./build.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

type BuildStatus = "waiting" | "building" | "done" | "failed";

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
  files?:      FileNode[];
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
  aanyaTasks: Array<{ description: string; outputFiles: string[] }>;
  apiContract: { endpoints: Array<{ route: string; method: string; description: string }> };
  dbSchema: { tables: Array<{ name: string; fields: Array<{ name: string; type: string }> }> };
}

// Structured event emitted by the agent runtime (events.jsonl)
interface ToolEvent {
  ts: number;
  agent: string;
  type: "tool_call" | "tool_result";
  tool: string;
  input?: Record<string, unknown>;
  status?: "ok" | "error";
  [key: string]: unknown;
}

// Terminal entries: raw text OR structured event card
type TerminalEntry =
  | { kind: "log"; text: string }
  | { kind: "event"; event: ToolEvent };

// Per-tool display config
const TOOL_META: Record<string, { icon: string; color: string; label: string }> = {
  write_file:   { icon: "📝", color: "#3FB950", label: "Write File" },
  edit_file:    { icon: "✏️",  color: "#79C0FF", label: "Edit File"  },
  read_file:    { icon: "📖", color: "#8B949E", label: "Read File"  },
  run_command:  { icon: "▶️",  color: "#D2A8FF", label: "Run Command"},
  web_search:   { icon: "🔍", color: "#FFA657", label: "Web Search" },
  screenshot:   { icon: "📸", color: "#FF7B72", label: "Screenshot" },
  http_request: { icon: "🌐", color: "#79C0FF", label: "HTTP"       },
  docker_compose:{ icon:"🐳", color: "#1F6FEB", label: "Docker"     },
  db_query:     { icon: "🗄️",  color: "#FFBD2E", label: "DB Query"  },
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
  const meta = TOOL_META[ev.tool] ?? { icon: "⚙️", color: "#8B949E", label: ev.tool };
  const isCall   = ev.type === "tool_call";
  const isResult = ev.type === "tool_result";
  const failed   = isResult && ev.status === "error";

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "8px", padding: "4px 0",
      opacity: isResult ? 0.75 : 1,
    }}>
      <span style={{ fontSize: "13px", flexShrink: 0, lineHeight: 1.4 }}>{meta.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: "10px", fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {ev.agent} · {meta.label}
        </span>
        {isCall && (
          <div style={{ fontSize: "11px", color: "#C9D1D9", fontFamily: "monospace", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {eventSummary(ev)}
          </div>
        )}
        {isResult && (
          <div style={{ fontSize: "11px", color: failed ? "#F85149" : "#3FB950", marginTop: "1px" }}>
            {failed ? "✗ error" : "✓ completed"}
            {(ev.output as string) && (
              <span style={{ color: "#8B949E", marginLeft: "6px" }}>{String(ev.output).slice(0, 80)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extOf(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function iconForExt(ext: string): string {
  return "nxi-file";
}

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

// ── File tree builder ─────────────────────────────────────────────────────────

interface TreeNode {
  name:     string;
  path:     string;
  type:     "file" | "dir";
  ext?:     string;
  content?: string;
  children: TreeNode[];
}

function buildTree(files: FileNode[]): TreeNode[] {
  const root: TreeNode = { name:"", path:"", type:"dir", children:[] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let child = cur.children.find(c => c.name === part);
      if (!child) {
        const isLast = i === parts.length - 1;
        const newChild: TreeNode = {
          name: part,
          path: parts.slice(0, i+1).join("/"),
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

// ── File Tree Node Component ─────────────────────────────────────────────────

function FileTreeNode({
  node, depth, selected, onSelect,
}: {
  node: TreeNode; depth: number; selected: string | null;
  onSelect: (n: TreeNode) => void;
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
      style={{
        paddingLeft: 12 + indent,
        height: "26px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: selected === node.path ? "var(--nx-bg-subtle)" : "transparent",
      }}
      onClick={() => onSelect(node)}
    >
      <i className={`nxi ${iconForExt(ext)} ${s.fileItemIcon}`}
         style={{ color: colorForExt(ext), fontSize: 13 }} />
      <span className={s.fileItemName} style={{ fontSize: "12px", color: selected === node.path ? "var(--nx-text)" : "var(--nx-text2)" }}>{node.name}</span>
      {ext && (
        <span className={`${s.fileItemBadge} ${badgeClass(ext)}`} style={{ fontSize: "9px" }}>{ext}</span>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [status,       setStatus]       = useState<BuildStatus>("waiting");
  const [stage,        setStage]        = useState("spec");
  const [stageMessage, setStageMessage] = useState("Initializing build...");
  const [result,       setResult]       = useState<ProjectResult | null>(null);
  const [tree,         setTree]         = useState<TreeNode[]>([]);
  const [selFile,      setSelFile]      = useState<TreeNode | null>(null);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([
    { kind: "log", text: "🚀 Pipeline started.\nConnecting to workspace log stream...\n" },
  ]);
  const [buildPlan,    setBuildPlan]    = useState<BuildPlan | null>(null);
  const [changeRequest,setChangeRequest]= useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [previewKey,   setPreviewKey]   = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termEndRef = useRef<HTMLDivElement | null>(null);

  // SSE pipeline status stream
  useEffect(() => {
    const es = new EventSource(`${API}/api/pipeline/${id}/status`);
    esRef.current = es;

    es.onmessage = (e) => {
      let ev: StageEvent;
      try { ev = JSON.parse(e.data); } catch { return; }

      if (ev.type === "waiting") {
        setStatus("waiting");
        return;
      }
      if (ev.type === "complete") {
        setStatus("done");
        fetchResult();
        return;
      }
      if (ev.stage) {
        setStage(ev.stage);
        setStatus("building");
        if (ev.message) setStageMessage(ev.message);

        // Fetch plan if workflow stops at plan approval gate
        if (ev.stage === "await_spec_approval") {
          fetchBuildPlan();
        }
      }
    };

    es.onerror = () => {
      fetchResult();
    };

    return () => { es.close(); };
  }, [id]);

  // WebSocket Live Log stream
  useEffect(() => {
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

    ws.onclose = () => {
      setTerminalEntries(prev => [...prev, { kind: "log", text: "\n📴 Disconnected from log stream.\n" }]);
    };

    return () => { ws.close(); };
  }, [id]);

  // Auto scroll terminal to bottom
  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalEntries]);

  async function fetchResult() {
    try {
      const r = await fetch(`${API}/api/pipeline/${id}`);
      if (!r.ok) return;
      const data: ProjectResult = await r.json();
      setResult(data);
      setStatus(data.status);
      if (data.files) setTree(buildTree(data.files));
    } catch {}
  }

  async function fetchBuildPlan() {
    try {
      const r = await fetch(`${API}/api/artifacts/${id}/build-plan.json`);
      if (!r.ok) return;
      const plan: BuildPlan = await r.json();
      setBuildPlan(plan);
    } catch {}
  }

  async function approveSpec() {
    setSubmitting(true);
    try {
      const body = changeRequest.trim() ? JSON.stringify({ changes: changeRequest.trim() }) : undefined;
      const res = await fetch(`${API}/api/pipeline/${id}/approve-spec`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      if (res.ok) {
        setStage("generate");
        setStageMessage("Plan approved. Building codebase...");
        const note = changeRequest.trim()
          ? `\n🟢 Spec approved with requested changes:\n  "${changeRequest.trim()}"\nDispatching developers...\n`
          : "\n🟢 Spec plan approved. Dispatching parallel developers...\n";
        setTerminalEntries(prev => [...prev, { kind: "log", text: note }]);
        setChangeRequest("");
      }
    } catch {}
    setSubmitting(false);
  }

  async function approveDeploy() {
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/pipeline/${id}/approve-deploy`, { method: "POST" });
      if (res.ok) {
        setStage("deliver");
        setStageMessage("Deployment approved. Launching local containers...");
        setTerminalEntries(prev => [...prev, { kind: "log", text: "\n🟢 Deployment approved. Triggering Riya DevOps target...\n" }]);
      }
    } catch {}
    setSubmitting(false);
  }

  const isDone = status === "done";

  return (
    <div className={s.root} style={{ height: "100vh", overflow: "hidden" }}>
      {/* Top Navbar */}
      <nav className={s.nav} style={{ height: "50px", borderBottom: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", padding: "0 20px" }}>
        <Link href="/dashboard" className={s.navBrand}>
          <div className={s.navLogo}>N</div>
          Next Siddhi Workspace
        </Link>
        <span className={s.navSep}>/</span>
        <span className={s.navProject}>{result?.name || `Project ${id.slice(0, 8)}`}</span>
        <div className={s.navSpacer} />
        
        {/* Live Stage Status Message */}
        <div style={{ marginRight: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={`${s.statusDot} ${s[status === "building" ? "building" : isDone ? "done" : "waiting"]}`} />
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--nx-accent-text)" }}>
            {stageMessage}
          </span>
        </div>

        {isDone && result?.appUrl && (
          <a href={result.appUrl} target="_blank" rel="noreferrer" className={`${s.navBtn} ${s.primary}`}>
            <i className="nxi nxi-link" style={{ fontSize:12 }} />
            Open Site
          </a>
        )}
      </nav>

      {/* Three-Panel Workspace IDE */}
      <div style={{ display: "flex", height: "calc(100vh - 50px)", width: "100vw", background: "var(--nx-bg-base)" }}>
        
        {/* PANEL 1: File Tree Explorer (20% width) */}
        <div style={{ width: "20%", minWidth: "220px", borderRight: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--nx-border)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--nx-text3)", display: "flex", justifyContent: "space-between" }}>
            <span>Workspace Explorer</span>
            {isDone && <span style={{ fontSize: "10px", color: "var(--nx-green)" }}>{result?.files?.length || 0} files</span>}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {!isDone && tree.length === 0 ? (
              <div style={{ padding: "16px", color: "var(--nx-text3)", fontSize: "12px" }}>
                <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <i className="nxi nxi-info" style={{ fontSize: 12 }} />
                  Files will appear here during generation...
                </div>
                {[60, 80, 45, 70, 50].map((w, i) => (
                  <div key={i} className={s.skeletonLine} style={{ width: `${w}%`, margin: "6px 0", height: "10px" }} />
                ))}
              </div>
            ) : (
              tree.map(node => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selFile?.path ?? null}
                  onSelect={setSelFile}
                />
              ))
            )}
          </div>
        </div>

        {/* PANEL 2: Code Editor + Terminal Console (45% width) */}
        <div style={{ width: "45%", borderRight: "1px solid var(--nx-border)", display: "flex", flexDirection: "column", height: "100%" }}>
          
          {/* Top Half: Code Editor */}
          <div style={{ height: "60%", borderBottom: "1px solid var(--nx-border)", display: "flex", flexDirection: "column", background: "var(--nx-bg-base)" }}>
            <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--nx-border)", background: "var(--nx-bg-elevated)", display: "flex", alignItems: "center", gap: "8px" }}>
              <i className="nxi nxi-code" style={{ color: "var(--nx-accent)" }} />
              <span style={{ fontFamily: "var(--nx-ff-mono)", fontSize: "12px", color: "var(--nx-text)" }}>
                {selFile ? selFile.path : "Workspace Editor"}
              </span>
              {selFile?.content && (
                <button
                  onClick={() => navigator.clipboard.writeText(selFile.content || "")}
                  style={{ marginLeft: "auto", background: "none", border: "1px solid var(--nx-border)", color: "var(--nx-text2)", fontSize: "11px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer" }}
                >
                  Copy Code
                </button>
              )}
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
              {selFile ? (
                <pre style={{ margin: 0, fontFamily: "var(--nx-ff-mono)", fontSize: "12px", color: "var(--nx-text)", lineHeight: 1.5, tabSize: 2, whiteSpace: "pre-wrap" }}>
                  {selFile.content || "// Empty file"}
                </pre>
              ) : (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "var(--nx-text3)", gap: "8px" }}>
                  <i className="nxi nxi-file" style={{ fontSize: "28px" }} />
                  <span style={{ fontSize: "13px" }}>Select a file from Explorer to view source code</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Half: Live Terminal — rich event cards + raw logs */}
          <div style={{ height: "40%", display: "flex", flexDirection: "column", background: "#0D1117", borderTop: "1px solid var(--nx-border)" }}>
            <div style={{ padding: "6px 14px", borderBottom: "1px solid #21262D", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#8B949E" }}>
                💻 Live Output Logs
              </span>
              <button
                onClick={() => setTerminalEntries([])}
                style={{ background: "none", border: "none", color: "#8B949E", cursor: "pointer", fontSize: "11px" }}
              >
                Clear
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", fontFamily: "var(--nx-ff-mono)", fontSize: "11px", color: "#C9D1D9", lineHeight: 1.5 }}>
              {terminalEntries.map((entry, i) =>
                entry.kind === "log" ? (
                  <pre key={i} style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "inherit" }}>
                    {entry.text}
                  </pre>
                ) : (
                  <ActionCard key={i} ev={entry.event} />
                )
              )}
              <div ref={termEndRef} />
            </div>
          </div>
        </div>

        {/* PANEL 3: Live Preview Browser (35% width) */}
        <div style={{ width: "35%", display: "flex", flexDirection: "column", height: "100%", background: "var(--nx-bg-elevated)" }}>
          
          {/* Browser Header address bar */}
          <div style={{ height: "38px", borderBottom: "1px solid var(--nx-border)", display: "flex", alignItems: "center", padding: "0 12px", gap: "8px", background: "var(--nx-bg-elevated)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: "4px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#FF5F56" }} />
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#FFBD2E" }} />
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#27C93F" }} />
            </div>
            <button
              onClick={() => setPreviewKey(k => k + 1)}
              style={{ background: "none", border: "none", color: "var(--nx-text2)", cursor: "pointer", display: "flex", alignItems: "center" }}
              title="Refresh Preview"
            >
              🔄
            </button>
            <div style={{ flex: 1, height: "24px", background: "var(--nx-bg-base)", border: "1px solid var(--nx-border)", borderRadius: "12px", display: "flex", alignItems: "center", padding: "0 10px", fontSize: "11px", color: "var(--nx-text3)", fontFamily: "var(--nx-ff-mono)" }}>
              {isDone && result?.appUrl ? result.appUrl : "http://localhost:3200 (Waiting for deployment...)"}
            </div>
          </div>

          {/* Browser Preview IFrame */}
          <div style={{ flex: 1, background: "#FFFFFF", position: "relative" }}>
            {isDone && result?.appUrl ? (
              <iframe
                key={previewKey}
                src={result.appUrl}
                style={{ width: "100%", height: "100%", border: "none", background: "#FFFFFF" }}
                sandbox="allow-same-origin allow-scripts allow-forms"
              />
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "var(--nx-text3)", gap: "12px", padding: "40px", textAlign: "center", background: "var(--nx-bg-base)" }}>
                <i className="nxi nxi-link" style={{ fontSize: "36px" }} />
                <span style={{ fontSize: "14px", fontWeight: "600" }}>Live Browser Preview</span>
                <p style={{ fontSize: "12px", color: "var(--nx-text2)", maxWidth: "260px" }}>
                  Once requirements and plans are approved and Riya deploys the containers locally, the live app will render here in real-time.
                </p>
                <div className={s.skeletonLine} style={{ width: "60%", height: "8px", marginTop: "12px" }} />
              </div>
            )}
          </div>
        </div>

      </div>

      {/* MODAL 1: Awaiting Spec Plan Approval Overlay */}
      {stage === "await_spec_approval" && buildPlan && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
          <div style={{ background: "var(--nx-bg-elevated)", border: "1px solid var(--nx-border)", borderRadius: "8px", maxWidth: "600px", width: "100%", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "1.5rem", color: "var(--nx-accent)", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
              📋 Review Build Plan: {buildPlan.appName}
            </h3>
            <p style={{ color: "var(--nx-text2)", fontSize: "13px" }}>{buildPlan.appDescription}</p>
            
            <div style={{ border: "1px solid var(--nx-border)", borderRadius: "6px", padding: "12px", background: "var(--nx-bg-base)", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "var(--nx-text3)" }}>Planned Frontend Pages:</span>
              <ul style={{ paddingLeft: "16px", margin: 0, fontSize: "12px", color: "var(--nx-text)" }}>
                {buildPlan.aanyaTasks.map((t, idx) => (
                  <li key={idx} style={{ margin: "4px 0" }}>
                    <strong>{t.description}</strong>
                    <div style={{ fontSize: "11px", color: "var(--nx-text2)" }}>Files: {t.outputFiles.join(", ")}</div>
                  </li>
                ))}
              </ul>
            </div>

            {buildPlan.apiContract?.endpoints?.length > 0 && (
              <div style={{ border: "1px solid var(--nx-border)", borderRadius: "6px", padding: "12px", background: "var(--nx-bg-base)", display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "var(--nx-text3)" }}>Backend endpoints:</span>
                <div style={{ fontSize: "12px", color: "var(--nx-text)" }}>
                  {buildPlan.apiContract.endpoints.map((e, idx) => (
                    <div key={idx} style={{ margin: "4px 0", fontFamily: "var(--nx-ff-mono)" }}>
                      <span style={{ color: "var(--nx-accent-text)" }}>{e.method}</span> {e.route} - <span style={{ fontFamily: "var(--nx-ff-sans)", color: "var(--nx-text2)" }}>{e.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
              <label style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "var(--nx-text3)", letterSpacing: "0.05em" }}>
                Request changes (optional)
              </label>
              <textarea
                value={changeRequest}
                onChange={e => setChangeRequest(e.target.value)}
                placeholder="e.g. Add a dark mode toggle, change primary color to blue, add user roles..."
                rows={3}
                style={{ background: "var(--nx-bg-base)", border: "1px solid var(--nx-border)", borderRadius: "6px", color: "var(--nx-text)", fontSize: "12px", fontFamily: "var(--nx-ff-sans)", padding: "8px 10px", resize: "vertical", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={approveSpec}
                disabled={submitting}
                style={{ flex: 1, height: "40px", background: "var(--nx-accent)", border: "none", color: "var(--nx-text-inv)", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" }}
              >
                {submitting ? "Approving..." : changeRequest.trim() ? "Approve with Changes" : "Approve and Generate Code"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Awaiting Final Deployment/Rollout Approval */}
      {stage === "await_deploy_approval" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ background: "var(--nx-bg-elevated)", border: "1px solid var(--nx-border)", borderRadius: "8px", maxWidth: "480px", width: "100%", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", textAlign: "center" }}>
            <h3 style={{ fontSize: "1.5rem", color: "var(--nx-green)", fontWeight: "bold" }}>
              ✅ Verification Successful
            </h3>
            <p style={{ color: "var(--nx-text2)", fontSize: "13px" }}>
              The generated codebase has compiled cleanly and passed the quality checks. Click below to approve final docker deployment and spin up the live environment.
            </p>
            <button
              onClick={approveDeploy}
              disabled={submitting}
              style={{ height: "44px", background: "var(--nx-green)", border: "none", color: "var(--nx-text-inv)", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px", marginTop: "8px" }}
            >
              {submitting ? "Deploying..." : "Approve and Launch Live Site"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
