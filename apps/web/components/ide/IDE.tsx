"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { API, useBuildStream, useSystemVitals, deriveWorkstreams, deriveTouchedFiles, deriveActiveWrites } from "../../lib/live";
import { type ApiNode, sortNodes, defaultExpanded, findNode } from "../../lib/tree";
import Floor from "./Floor";
import { fileMark } from "./fileIcons";
import { narrate } from "./narrate";
import YugnexLogo from "./YugnexLogo";
import { ide as s } from "./IDE.styles";

const FRESH_WINDOW_MS = 45_000;

type View = "files" | "changes" | "floor" | "preview";

interface DiffFile {
  path: string;
  added: number | null;
  removed: number | null;
  binary: boolean;
}

export interface IDEProps {
  projectId: string;
  projectName: string;
  appUrl?: string | null;
  isDone: boolean;
  stageMessage: string;
  tree: ApiNode[];
  selectedPath: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  onSelectFile: (node: ApiNode) => void;
  awaitingSpecApproval: boolean;
  awaitingDeployApproval: boolean;
  submitting: boolean;
  changeRequest: string;
  onChangeRequest: (v: string) => void;
  onApproveSpec: () => void;
  onApproveDeploy: () => void;
}

export default function IDE(props: IDEProps) {
  const {
    projectId, projectName, appUrl, isDone, stageMessage,
    tree, selectedPath, fileContent, fileLoading, onSelectFile,
    awaitingSpecApproval, awaitingDeployApproval, submitting,
    changeRequest, onChangeRequest, onApproveSpec, onApproveDeploy,
  } = props;

  const { items, conn } = useBuildStream(projectId);
  const { vitals } = useSystemVitals();

  const [view, setView] = useState<View>("files");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState<DiffFile[]>([]);
  const [patch, setPatch] = useState<string | null>(null);
  const [patchPath, setPatchPath] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Open the spine down to real source once the tree first arrives, without
  // clobbering folders the reader has since opened or closed themselves.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && tree.length > 0) {
      seededRef.current = true;
      setExpanded(new Set(defaultExpanded(tree)));
    }
  }, [tree]);

  const workstreams = useMemo(() => deriveWorkstreams(items, now), [items, now]);
  const thoughts = useMemo(() => narrate(items), [items]);
  const touched = useMemo(() => deriveTouchedFiles(items), [items]);
  const freshPaths = useMemo(
    () => new Set(touched.filter((f) => now - f.at < FRESH_WINDOW_MS).map((f) => f.path)),
    [touched, now],
  );
  const activeWrites = useMemo(() => deriveActiveWrites(items, now), [items, now]);
  // Ancestor directories of a file being written right now, so a closed
  // folder still hints that something inside it is live.
  const activeDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const path of activeWrites) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return dirs;
  }, [activeWrites]);

  // Once the open file's write completes, silently re-fetch its content so
  // the reader sees the result without manually re-clicking it.
  const wasWritingRef = useRef(false);
  useEffect(() => {
    const stillWriting = selectedPath ? activeWrites.has(selectedPath) : false;
    if (wasWritingRef.current && !stillWriting && selectedPath) {
      const node = findNode(tree, selectedPath);
      if (node) onSelectFile(node);
    }
    wasWritingRef.current = stillWriting;
  }, [activeWrites, selectedPath, tree, onSelectFile]);

  const activeNames = useMemo(
    () => new Set(workstreams.filter((w) => w.active).map((w) => w.agent)),
    [workstreams],
  );

  const loadDiff = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/artifacts/${projectId}/diff`, { credentials: "include" });
      if (!r.ok) return;
      const j = await r.json();
      setDiff(Array.isArray(j.files) ? j.files : []);
    } catch {
      // The Changes view degrades to empty rather than taking the IDE down.
    }
  }, [projectId]);

  useEffect(() => { if (view === "changes") void loadDiff(); }, [view, loadDiff]);

  const openPatch = useCallback(async (path: string) => {
    setPatchPath(path);
    setPatch(null);
    try {
      const r = await fetch(
        `${API}/api/artifacts/${projectId}/diff/file?path=${encodeURIComponent(path)}`,
        { credentials: "include" },
      );
      const j = await r.json();
      setPatch(typeof j.patch === "string" ? j.patch : "");
    } catch {
      setPatch("");
    }
  }, [projectId]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });

  const gate = awaitingSpecApproval
    ? { title: "Specification ready", hint: "Review the plan, add changes if you want, then approve.", cta: submitting ? "Approving…" : changeRequest.trim() ? "Approve with changes" : "Approve & build", onGo: onApproveSpec, input: true }
    : awaitingDeployApproval
      ? { title: "Build verified", hint: "Quality checks passed. Approve to launch it locally.", cta: submitting ? "Deploying…" : "Approve & launch", onGo: onApproveDeploy, input: false }
      : null;

  const openCircuits = vitals
    ? Object.values(vitals.circuits).filter((c) => c === "OPEN").length
    : 0;

  return (
    <div className={s.root}>
      {/* ── Title bar ─────────────────────────────────────────────────── */}
      <header className={s.titlebar}>
        <Link href="/dashboard" className={s.brand}>
          <span className={s.brandMark}><YugnexLogo size={19} /></span>
          YugNex
        </Link>
        <span className={s.project}>
          <span className={s.projectSep}>/</span>
          <span className={s.projectName}>{projectName}</span>
        </span>

        <div className={s.titleRight}>
          {appUrl && (
            <a href={appUrl} target="_blank" rel="noreferrer" className={s.openBtn}>Open app</a>
          )}
        </div>
      </header>

      {/* ── Workbench ─────────────────────────────────────────────────── */}
      <div className={s.workbench}>
        <nav className={s.activity}>
          <button type="button" onClick={() => setView("files")} title="Files"
            className={`${s.actBtn} ${view === "files" ? s.actBtnActive : ""}`}>
            <Glyph d="M3 4.2h5l1.4 1.8H17v9.8H3z" />
            {freshPaths.size > 0 && <span className={s.actDot} />}
          </button>
          <button type="button" onClick={() => setView("changes")} title="Changes"
            className={`${s.actBtn} ${view === "changes" ? s.actBtnActive : ""}`}>
            <Glyph d="M6 3v9m0 0a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm8-9v6m0 0a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z" stroke />
          </button>
          <button type="button" onClick={() => setView("floor")} title="Floor — who is working"
            className={`${s.actBtn} ${view === "floor" ? s.actBtnActive : ""}`}>
            <Glyph d="M4 10h3m6 0h3M10 4v3m0 6v3M10 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" stroke />
            {activeNames.size > 0 && <span className={s.actDot} />}
          </button>
          <button type="button" onClick={() => setView("preview")} title="Preview" disabled={!appUrl}
            className={`${s.actBtn} ${view === "preview" ? s.actBtnActive : ""}`}>
            <Glyph d="M3 4.5h14v11H3zM3 8h14" stroke />
          </button>
        </nav>

        {/* Side panel */}
        <aside className={s.side}>
          <div className={s.sideHead}>
            <span>{view === "changes" ? "Changes" : "Explorer"}</span>
            <span className={s.sideCount}>
              {view === "changes" ? diff.length : tree.length}
            </span>
          </div>
          <div className={s.sideBody}>
            {view === "changes" ? (
              diff.length === 0 ? (
                <div className={s.empty}>
                  <div className={s.emptyHint}>No file changes recorded for this build.</div>
                </div>
              ) : (
                diff.map((f) => (
                  <button key={f.path} type="button" onClick={() => openPatch(f.path)}
                    className={`${s.row} ${patchPath === f.path ? s.rowSelected : ""}`} title={f.path}>
                    <span className={s.mark} style={{ color: fileMark(baseName(f.path)).color }}>
                      {fileMark(baseName(f.path)).tag}
                    </span>
                    <span className={s.name}>{baseName(f.path)}</span>
                    <span className={s.diffStat}>
                      {f.binary ? <span className={s.del}>bin</span> : (
                        <>
                          {f.added ? <span className={s.add}>+{f.added}</span> : null}
                          {f.removed ? <span className={s.del}>−{f.removed}</span> : null}
                        </>
                      )}
                    </span>
                  </button>
                ))
              )
            ) : tree.length === 0 ? (
              <div className={s.empty}>
                <div className={s.emptyHint}>Generated files appear here as they are written.</div>
              </div>
            ) : (
              <Tree nodes={tree} depth={0} expanded={expanded} selected={selectedPath}
                fresh={freshPaths} writing={activeWrites} activeDirs={activeDirs}
                onToggle={toggle} onSelect={onSelectFile} />
            )}
          </div>
        </aside>

        {/* Editor */}
        <main className={s.editor}>
          {gate && (
            <div className={s.gate}>
              <div className={s.gateText}>
                <div className={s.gateTitle}>{gate.title}</div>
                <div className={s.gateHint}>{gate.hint}</div>
              </div>
              {gate.input && (
                <input className={s.gateInput} value={changeRequest}
                  onChange={(e) => onChangeRequest(e.target.value)}
                  placeholder="Any changes first…" />
              )}
              <button type="button" className={s.btn} onClick={gate.onGo} disabled={submitting}>
                {gate.cta}
              </button>
            </div>
          )}

          <div className={s.tabbar}>
            {view === "preview" && appUrl && <span className={`${s.tab} ${s.tabActive}`}>{appUrl}</span>}
            {view === "changes" && (
              <span className={`${s.tab} ${s.tabActive}`}>{patchPath ?? "Select a change"}</span>
            )}
            {view === "floor" && <span className={`${s.tab} ${s.tabActive}`}>Workstreams</span>}
            {view === "files" && (
              <span className={`${s.tab} ${s.tabActive}`}>
                {selectedPath ?? "No file open"}
                {selectedPath && activeWrites.has(selectedPath) && (
                  <span className={s.tabWriting}><span className={s.tabWritingDot} />writing…</span>
                )}
              </span>
            )}
          </div>

          <div className={s.pane}>
            {view === "floor" && (
              <Floor workstreams={workstreams} items={items} now={now}
                stage={isDone ? "delivered" : stageMessage}
                selected={null} onSelect={() => {}} />
            )}

            {view === "preview" && appUrl && <iframe src={appUrl} className={s.frame}
              sandbox="allow-same-origin allow-scripts allow-forms" />}

            {view === "changes" && (
              patch === null && patchPath ? <div className={s.code}>Loading…</div>
              : patch ? <Patch text={patch} />
              : <Blank title="Nothing selected" hint="Pick a changed file to see exactly what the agents altered." />
            )}

            {view === "files" && (
              fileLoading ? <div className={s.code}>Loading…</div>
              : fileContent !== null ? <pre className={s.code}>{fileContent}</pre>
              : <Blank title="No file open" hint="Files the agents just wrote are marked in the explorer." />
            )}
          </div>
        </main>

        {/* Narration — plain language, never the raw log. */}
        <aside className={s.narration}>
          <div className={s.narrHead}>
            <span>What&apos;s happening</span>
            <span>{activeNames.size > 0 ? `${activeNames.size} active` : "idle"}</span>
          </div>
          <NarrationBody thoughts={thoughts} activeNames={activeNames} />
        </aside>
      </div>

      {/* ── Status bar ────────────────────────────────────────────────── */}
      <footer className={s.status}>
        <span className={`${s.statusItem} ${conn === "live" ? s.statusLive : ""}`}>
          <span className={conn === "live" ? s.statusDotLive : s.statusDot} />
          {conn === "live" ? "Connected" : conn === "retrying" ? "Reconnecting" : "Connecting"}
        </span>
        <span className={s.statusItem}>{isDone ? "Delivered" : stageMessage}</span>
        {openCircuits > 0 && (
          <span className={s.statusItem} title="Model circuits currently open">
            {openCircuits} model{openCircuits === 1 ? "" : "s"} rate-limited
          </span>
        )}
        <span className={`${s.statusItem} ${s.statusPush}`}>{projectId}</span>
      </footer>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Glyph({ d, stroke }: { d: string; stroke?: boolean }) {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true"
      fill={stroke ? "none" : "currentColor"}
      stroke={stroke ? "currentColor" : "none"}
      strokeWidth={stroke ? 1.5 : undefined}
      strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function Tree({ nodes, depth, expanded, selected, fresh, writing, activeDirs, onToggle, onSelect }: {
  nodes: ApiNode[]; depth: number; expanded: Set<string>; selected: string | null;
  fresh: Set<string>; writing: Set<string>; activeDirs: Set<string>;
  onToggle: (p: string) => void; onSelect: (n: ApiNode) => void;
}) {
  return (
    <>
      {sortNodes(nodes).map((n) => {
        const isDir = n.type === "directory";
        const open = expanded.has(n.path);
        const isFresh = fresh.has(n.path);
        const isWriting = writing.has(n.path);
        const isActiveDir = isDir && activeDirs.has(n.path);
        const mark = fileMark(n.name);

        return (
          <div key={n.path}>
            <button type="button" title={n.path}
              onClick={() => (isDir ? onToggle(n.path) : onSelect(n))}
              className={[s.row, selected === n.path ? s.rowSelected : ""].filter(Boolean).join(" ")}
              style={{ paddingLeft: 10 + depth * 13 }}>
              <span className={`${s.caret} ${isDir && open ? s.caretOpen : ""}`}>{isDir ? "▸" : ""}</span>
              {isDir
                ? <span className={s.folderMark}>{open ? "▾" : "▪"}</span>
                : <span className={s.mark} style={{ color: mark.color }}>{mark.tag}</span>}
              <span className={[
                s.name,
                isDir ? s.dirName : "",
                isActiveDir ? s.dirNameActive : "",
                isWriting && !isDir ? s.nameWriting : (isFresh && !isDir ? s.nameFresh : ""),
              ].filter(Boolean).join(" ")}>
                {n.name}
              </span>
              {!isDir && (isWriting ? <span className={s.writingPip} /> : isFresh ? <span className={s.freshPip} /> : null)}
            </button>
            {isDir && open && (
              <Tree nodes={n.children ?? []} depth={depth + 1} expanded={expanded}
                selected={selected} fresh={fresh} writing={writing} activeDirs={activeDirs}
                onToggle={onToggle} onSelect={onSelect} />
            )}
          </div>
        );
      })}
    </>
  );
}

function Patch({ text }: { text: string }) {
  return (
    <pre className={s.patch}>
      {text.split("\n").map((line, i) => {
        const cls =
          line.startsWith("+++") || line.startsWith("---") ? s.patchMeta
          : line.startsWith("@@") ? s.patchHunk
          : line.startsWith("+") ? s.patchAdd
          : line.startsWith("-") ? s.patchDel
          : s.patchLine;
        return <div key={i} className={`${s.patchLine} ${cls}`}>{line || " "}</div>;
      })}
    </pre>
  );
}

function Blank({ title, hint }: { title: string; hint: string }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyTitle}>{title}</div>
      <div className={s.emptyHint}>{hint}</div>
    </div>
  );
}

function NarrationBody({ thoughts, activeNames }: {
  thoughts: ReturnType<typeof narrate>; activeNames: Set<string>;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [thoughts.length]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  if (thoughts.length === 0) {
    return (
      <div className={s.narrBody}>
        <div className={s.emptyHint} style={{ padding: "10px 0" }}>
          Nothing yet. As agents work, what they&apos;re doing is described here in plain language.
        </div>
      </div>
    );
  }

  return (
    <div className={s.narrBody} ref={bodyRef} onScroll={onScroll}>
      {thoughts.map((t) => (
        <div key={t.id} className={s.thought}>
          <div className={s.thoughtWho}>
            <span className={`${s.whoDot} ${activeNames.has(t.who) ? s.whoDotLive : ""}`} />
            {t.who}
          </div>
          <div className={`${s.thoughtText} ${t.kind === "doing" ? s.thoughtDoing : ""} ${t.kind === "problem" ? s.thoughtErr : ""}`}>
            {t.text}
          </div>
          {t.meta && <div className={s.thoughtMeta}>{t.meta}</div>}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
