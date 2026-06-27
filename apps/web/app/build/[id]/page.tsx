"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import s from "./build.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ── Types ──────────────────────────────────────────────────────────────────────

type BuildStatus = "waiting" | "building" | "done" | "failed";

type Tab = "status" | "files" | "ide" | "git";

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
  commits?:    CommitRecord[];
}

interface FileNode {
  path:     string;
  type:     "file" | "dir";
  content?: string;
  ext?:     string;
}

interface CommitRecord {
  hash:    string;
  message: string;
  time:    string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_ORDER = ["spec","decompose","generate","qa","live_test","deliver","done"] as const;

const STAGE_LABELS: Record<string, string> = {
  spec:       "Locking requirements",
  decompose:  "Planning the build",
  generate:   "Writing code",
  qa:         "Running quality checks",
  live_test:  "Testing the live app",
  deliver:    "Packaging delivery",
  done:       "Complete",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extOf(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function iconForExt(ext: string): string {
  if (["ts","tsx"].includes(ext)) return "nxi-file";
  if (ext === "css")  return "nxi-file";
  if (ext === "json") return "nxi-file";
  if (ext === "md")   return "nxi-file";
  if (ext === "sql")  return "nxi-file";
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
  const map: Record<string,string> = { ts:s.ts, tsx:s.tsx, css:s.css, sql:s.sql, md:s.md, json:s.json };
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
        child = {
          name: part,
          path: parts.slice(0, i+1).join("/"),
          type: isLast ? "file" : "dir",
          ext:  isLast ? extOf(f.path) : undefined,
          content: isLast ? f.content : undefined,
          children: [],
        };
        cur.children.push(child);
      }
      cur = child;
    }
  }
  return root.children;
}

// ── File Tree component ───────────────────────────────────────────────────────

function FileTreeNode({
  node, depth, selected, onSelect,
}: {
  node: TreeNode; depth: number; selected: string | null;
  onSelect: (n: TreeNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const indent = depth * 14;

  if (node.type === "dir") {
    return (
      <>
        <div
          className={`${s.fileItem} ${s.folderItem} ${open ? s.open : ""}`}
          style={{ paddingLeft: 12 + indent }}
          onClick={() => setOpen(o => !o)}
        >
          <i className={`nxi ${open ? "nxi-folder-open" : "nxi-folder"} ${s.fileItemIcon}`}
             style={{ color: open ? "var(--nx-accent-text)" : "var(--nx-text2)", fontSize:13 }} />
          <span className={s.fileItemName}>{node.name}</span>
          <i className={`nxi ${open ? "nxi-chevron-d" : "nxi-chevron-r"}`}
             style={{ fontSize:10, color:"var(--nx-text3)" }} />
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
      style={{ paddingLeft: 12 + indent }}
      onClick={() => onSelect(node)}
    >
      <i className={`nxi ${iconForExt(ext)} ${s.fileItemIcon}`}
         style={{ color: colorForExt(ext), fontSize:13 }} />
      <span className={s.fileItemName}>{node.name}</span>
      {ext && (
        <span className={`${s.fileItemBadge} ${badgeClass(ext)}`}>{ext}</span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [tab,      setTab]      = useState<Tab>("status");
  const [status,   setStatus]   = useState<BuildStatus>("waiting");
  const [stage,    setStage]    = useState("spec");
  const [messages, setMessages] = useState<{stage:string;msg:string;t:string}[]>([]);
  const [result,   setResult]   = useState<ProjectResult | null>(null);
  const [tree,     setTree]     = useState<TreeNode[]>([]);
  const [selFile,  setSelFile]  = useState<TreeNode | null>(null);
  const [mockCommits, setMockCommits] = useState<CommitRecord[]>([]);

  const esRef = useRef<EventSource | null>(null);

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
        setMessages(m => [...m, {
          stage: ev.stage!,
          msg:   ev.message ?? STAGE_LABELS[ev.stage!] ?? ev.stage!,
          t:     new Date().toLocaleTimeString("en-US", { hour12:false }),
        }]);
      }
    };

    es.onerror = () => {
      fetchResult();
    };

    return () => { es.close(); };
  }, [id]);

  async function fetchResult() {
    try {
      const r = await fetch(`${API}/api/pipeline/${id}`);
      if (!r.ok) return;
      const data: ProjectResult = await r.json();
      setResult(data);
      setStatus(data.status);
      if (data.files) setTree(buildTree(data.files));
      if (data.commits) setMockCommits(data.commits);
    } catch {}
  }

  const isDone    = status === "done";
  const isFailed  = status === "failed";

  // Build stage states
  const curIdx = STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]);

  return (
    <div className={s.root}>
      {/* Nav */}
      <nav className={s.nav}>
        <Link href="/dashboard" className={s.navBrand}>
          <div className={s.navLogo}>N</div>
          NexSidi
        </Link>
        <span className={s.navSep}>/</span>
        <span className={s.navProject}>{result?.name || id}</span>
        <div className={s.navSpacer} />
        <div className={s.navStatus}>
          <span className={`${s.statusDot} ${s[status]}`} />
          {status === "building" ? "Building" : status === "done" ? "Complete" : status === "failed" ? "Failed" : "Waiting"}
        </div>
        {isDone && result?.appUrl && (
          <a href={result.appUrl} target="_blank" rel="noreferrer" className={`${s.navBtn} ${s.primary}`}>
            <i className="nxi nxi-link" style={{ fontSize:12 }} />
            Open App
          </a>
        )}
        {isDone && result?.repoUrl && (
          <a href={result.repoUrl} target="_blank" rel="noreferrer" className={s.navBtn}>
            <i className="nxi nxi-git-branch" style={{ fontSize:12 }} />
            GitHub
          </a>
        )}
      </nav>

      {/* Tab bar */}
      <div className={s.tabBar}>
        {(["status","files","ide","git"] as Tab[]).map(t => (
          <button
            key={t}
            className={`${s.tab} ${tab === t ? s.active : ""}`}
            onClick={() => setTab(t)}
          >
            <i className={`nxi nxi-${t === "status" ? "info" : t === "files" ? "folder" : t === "ide" ? "code" : "git-branch"}`}
               style={{ fontSize:13 }} />
            {t === "status" ? "Status" : t === "files" ? "File Manager" : t === "ide" ? "Code IDE" : "Git Remote"}
            {t === "files" && tree.length > 0 && (
              <span className={s.tabBadge}>{result?.files?.length ?? "—"}</span>
            )}
            {t === "git" && mockCommits.length > 0 && (
              <span className={s.tabBadge}>{mockCommits.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className={s.body}>

        {/* ── STATUS ── */}
        {tab === "status" && (
          <div className={s.statusPanel}>
            <div className={s.statusHeader}>
              <div className={s.statusTitle}>
                {result?.name ?? "Building your app…"}
              </div>
              <div className={s.statusMeta}>
                Project #{id.slice(0,8)} &nbsp;·&nbsp; {new Date().toLocaleDateString()}
              </div>
            </div>

            <div className={s.stageList}>
              {STAGE_ORDER.filter(st => st !== "done").map((st, i) => {
                const isDoneStage  = i < curIdx;
                const isActiveStage= st === stage && !isDone;
                const state = isDone ? "done" : isDoneStage ? "done" : isActiveStage ? "active" : "pending";
                const msg = messages.findLast(m => m.stage === st);
                return (
                  <div key={st} className={`${s.stageRow} ${s[state]}`}>
                    <div className={`${s.stageDot} ${s[state]}`}>
                      {state === "done" && <i className="nxi nxi-check" style={{ fontSize:10, color:"white" }} />}
                    </div>
                    <div className={s.stageInfo}>
                      <div className={s.stageName}>{STAGE_LABELS[st]}</div>
                      {msg && <div className={s.stageMsg}>{msg.msg}</div>}
                    </div>
                    {msg && <div className={s.stageTime}>{msg.t}</div>}
                  </div>
                );
              })}
            </div>

            {isDone && result?.appUrl && (
              <div className={s.doneBanner}>
                <div className={s.doneText}>
                  <div className={s.doneTitle}>
                    <i className="nxi nxi-check" style={{ fontSize:14, marginRight:6 }} />
                    Your app is ready
                  </div>
                  <div className={s.doneUrl}>{result.appUrl}</div>
                </div>
                <a href={result.appUrl} target="_blank" rel="noreferrer" className={s.openBtn}>
                  Open App
                  <i className="nxi nxi-link" style={{ fontSize:12 }} />
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── FILE MANAGER ── */}
        {tab === "files" && (
          <div className={s.filePanel}>
            <div className={s.fileTree}>
              <div className={s.fileTreeHeader}>
                <span>Project Files</span>
                {isDone && tree.length > 0 && (
                  <i className="nxi nxi-download" style={{ fontSize:12, cursor:"pointer", color:"var(--nx-text2)" }} />
                )}
              </div>
              <div className={s.fileTreeBody}>
                {!isDone ? (
                  <div className={s.buildingTree}>
                    <div style={{ fontSize: "var(--nx-fs-xs)", color:"var(--nx-text3)", marginBottom:"var(--nx-sp-3)", display:"flex", alignItems:"center", gap:6 }}>
                      <i className="nxi nxi-info" style={{ fontSize:12 }} />
                      Files appear when the build completes
                    </div>
                    {[80,55,70,40,65,50,60,35].map((w,i) => (
                      <div key={i} className={s.skeletonLine} style={{ width:`${w}%`, animationDelay:`${i*100}ms` }} />
                    ))}
                  </div>
                ) : tree.length === 0 ? (
                  <div style={{ padding:"var(--nx-sp-4)", fontSize:"var(--nx-fs-xs)", color:"var(--nx-text3)" }}>
                    No files available
                  </div>
                ) : (
                  tree.map(node => (
                    <FileTreeNode
                      key={node.path}
                      node={node}
                      depth={0}
                      selected={selFile?.path ?? null}
                      onSelect={n => { setSelFile(n); setTab("ide"); }}
                    />
                  ))
                )}
              </div>
            </div>

            <div className={s.fileContent}>
              {selFile ? (
                <>
                  <div className={s.fileContentHeader}>
                    <i className="nxi nxi-file" style={{ fontSize:13, color: colorForExt(selFile.ext ?? "") }} />
                    <span className={s.fileContentPath}>{selFile.path}</span>
                    <button
                      className={s.navBtn}
                      onClick={() => { setSelFile(null); }}
                      style={{ padding:"2px 8px", fontSize:11 }}
                    >
                      <i className="nxi nxi-x" style={{ fontSize:10 }} />
                    </button>
                  </div>
                  <div className={s.fileContentBody}>
                    <pre className={s.fileContentPre}>{selFile.content ?? "// No content available"}</pre>
                  </div>
                </>
              ) : (
                <div className={s.filePlaceholder}>
                  <i className="nxi nxi-file" style={{ fontSize:32, color:"var(--nx-text3)" }} />
                  <span>Select a file to view its contents</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CODE IDE ── */}
        {tab === "ide" && (
          <div className={s.filePanel}>
            <div className={s.fileTree}>
              <div className={s.fileTreeHeader}>
                <span>Explorer</span>
              </div>
              <div className={s.fileTreeBody}>
                {!isDone ? (
                  <div className={s.buildingTree}>
                    {[80,55,70,40,65].map((w,i) => (
                      <div key={i} className={s.skeletonLine} style={{ width:`${w}%`, animationDelay:`${i*100}ms` }} />
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

            <div className={s.fileContent}>
              {selFile ? (
                <>
                  <div className={s.fileContentHeader}>
                    <i className="nxi nxi-file" style={{ fontSize:13, color: colorForExt(selFile.ext ?? "") }} />
                    <span className={s.fileContentPath}>{selFile.path}</span>
                    <button
                      className={s.navBtn}
                      onClick={() => navigator.clipboard?.writeText(selFile.content ?? "")}
                      style={{ padding:"2px 8px", fontSize:11 }}
                      title="Copy"
                    >
                      <i className="nxi nxi-copy" style={{ fontSize:12 }} />
                      Copy
                    </button>
                  </div>
                  <div className={s.fileContentBody}>
                    <pre className={s.fileContentPre}>{selFile.content ?? "// No content"}</pre>
                  </div>
                </>
              ) : (
                <div className={s.filePlaceholder}>
                  <i className="nxi nxi-code" style={{ fontSize:36, color:"var(--nx-text3)" }} />
                  <span>Select a file from the explorer</span>
                  <span style={{ fontSize:"var(--nx-fs-xs)", color:"var(--nx-text3)" }}>
                    {isDone ? `${result?.files?.length ?? 0} files in this project` : "Build in progress…"}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── GIT REMOTE ── */}
        {tab === "git" && (
          <div className={s.gitPanel}>
            <div className={s.gitHeader}>
              <div className={s.gitTitle}>
                <i className="nxi nxi-git-branch" style={{ fontSize:16, marginRight:8, verticalAlign:"middle" }} />
                Version Control
              </div>
            </div>

            {!isDone ? (
              <div className={s.gitPlaceholder}>
                <i className="nxi nxi-git-branch" style={{ fontSize:36 }} />
                <span>Git repository will be created when the build completes</span>
              </div>
            ) : (
              <>
                {/* Repo card */}
                <div className={s.gitRepoCard}>
                  <div className={s.gitRepoIcon}>
                    <i className="nxi nxi-git-branch" style={{ fontSize:20 }} />
                  </div>
                  <div className={s.gitRepoMeta}>
                    <div className={s.gitRepoName}>{result?.name ?? "project"}</div>
                    <div className={s.gitRepoUrl}>{result?.repoUrl ?? "github.com/nexsidi/" + id.slice(0,8)}</div>
                  </div>
                  <div className={s.gitRepoActions}>
                    {result?.repoUrl && (
                      <a href={result.repoUrl} target="_blank" rel="noreferrer" className={s.gitBtn}>
                        <i className="nxi nxi-link" style={{ fontSize:12 }} />
                        Open
                      </a>
                    )}
                    <button
                      className={s.gitBtn}
                      onClick={() => navigator.clipboard?.writeText(
                        `git clone ${result?.repoUrl ?? "https://github.com/nexsidi/" + id.slice(0,8)}`
                      )}
                    >
                      <i className="nxi nxi-copy" style={{ fontSize:12 }} />
                      Clone
                    </button>
                  </div>
                </div>

                {/* Branch */}
                <div className={s.gitSectionLabel}>
                  <i className="nxi nxi-git-branch" style={{ fontSize:11 }} />
                  Branches
                </div>
                <div className={s.branchRow}>
                  <i className="nxi nxi-git-branch" style={{ fontSize:13, color:"var(--nx-text2)" }} />
                  <span className={s.branchName}>main</span>
                  <span className={s.branchDefault}>default</span>
                </div>

                {/* Commits */}
                <div className={s.gitSectionLabel} style={{ marginTop:"var(--nx-sp-5)" }}>
                  <i className="nxi nxi-git-commit" style={{ fontSize:11 }} />
                  Recent Commits
                </div>
                <div className={s.commitList}>
                  {(mockCommits.length > 0 ? mockCommits : [
                    { hash:"a4f2b9c", message:"feat: initial project delivery from NexSidi", time:"just now" },
                    { hash:"3d1e8f0", message:"chore: add docker-compose and .env.example", time:"just now" },
                    { hash:"c9a2d7b", message:"feat: database schema and migrations", time:"just now" },
                  ]).map(c => (
                    <div key={c.hash} className={s.commitRow}>
                      <div className={s.commitDot} />
                      <span className={s.commitHash}>{c.hash.slice(0,7)}</span>
                      <span className={s.commitMsg}>{c.message}</span>
                      <span className={s.commitTime}>{c.time}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
