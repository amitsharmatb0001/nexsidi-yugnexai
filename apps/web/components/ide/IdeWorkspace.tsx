"use client";

// The build-phase workspace. Structural base: apps/prototype-ui/app/
// components/IdeWorkspace.tsx (icon rail, collapsible sidebar, center
// stream with a floating capsule footer, right drawer with Plan/Grid
// modes) — see IdeWorkspace.styles.ts's header comment for what changed in
// the port. Every panel below reads real project data; nothing here is
// placeholder content carried over from the prototype.
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AccountMenu from "../AccountMenu";
import ProjectSwitcher from "./ProjectSwitcher";
import { PromptInput } from "@/components/nexui/prompt-input";
import { StreamingText } from "@/components/nexui/streaming-text";
import { ThinkingIndicator } from "@/components/nexui/thinking-indicator";
import { ReviewGate, type ReviewDecision, type ReviewState } from "@/components/nexui/review-gate";
import type { PlanningChatMessage } from "../planning/PlanningView";
import {
  API,
  useBuildStream,
  deriveTouchedFiles,
  deriveActiveWrites,
  type ToolEvent,
} from "../../lib/live";
import { type ApiNode, sortNodes, defaultExpanded } from "../../lib/tree";
import { narrate, type Thought } from "./narrate";
import PlanPreview, { type BuildPlan } from "./PlanPreview";
import YugnexLogo from "./YugnexLogo";
import AgenticField from "./AgenticField";
import DockPanel from "./DockPanel";
import ContextPanel from "./ContextPanel";
import {
  IconExplorer,
  IconSearch,
  IconChanges,
  IconPreview,
  IconGrid,
  IconSettings,
  IconContext,
  IconPlan,
  IconCost,
  IconMinimize,
} from "./IdeIcons";
import { ws as s } from "./IdeWorkspace.styles";
import { Syntax } from "@/components/nexui/syntax";
import { DiffView } from "@/components/nexui/diff-view";
import { FileTabs, type OpenFile } from "@/components/nexui/file-tabs";
import { FileIcon } from "@/components/nexui/file-icon";
import { ToolCall } from "@/components/nexui/tool-call";
import { TerminalSurface, type TerminalRun } from "@/components/nexui/terminal-surface";
import { AgentDiffstat, type DiffStatEntry } from "@/components/nexui/agent-diffstat";
import { CostMeter, type UsageEntry } from "@/components/nexui/cost-meter";
import { PreviewFrame } from "@/components/nexui/preview-frame";
import { Button } from "@/components/nexui/button";
import { patchToBeforeAfter } from "@/lib/patch";

const FRESH_WINDOW_MS = 45_000;

type LeftView = "explorer" | "changes";
type PanelKey = "plan" | "context" | "preview" | "tasks" | "changes" | "cost";
type DiffFileStatus = "added" | "modified" | "deleted";

interface DiffFile {
  path: string;
  added: number | null;
  removed: number | null;
  binary: boolean;
  status: DiffFileStatus;
  reviewed: boolean;
}

interface OpenTab {
  path: string;
  content: string | null;
  loading: boolean;
}

export interface IdeWorkspaceProps {
  projectId: string;
  projectName: string;
  appUrl?: string | null;
  isDone: boolean;
  stageMessage: string;
  tree: ApiNode[];
  awaitingSpecApproval: boolean;
  buildPlan: BuildPlan | null;
  awaitingDeployApproval: boolean;
  submitting: boolean;
  changeRequest: string;
  onChangeRequest: (v: string) => void;
  onApproveSpec: () => void;
  onApproveDeploy: () => void;

  /**
   * Present only while the project has no pipeline yet — the conversation
   * that produces the spec. When set, it replaces the tool-call stream in
   * the center pane and the drawer's Plan mode with the live planning
   * experience, in the same rail/sidebar/drawer shell rather than a
   * separate screen: a project lands here immediately on creation, and this
   * same view carries it through into the build once the plan is approved.
   */
  planning?: {
    messages: PlanningChatMessage[];
    streamingMessage: string;
    loading: boolean;
    input: string;
    onInputChange: (v: string) => void;
    onSend: (v: string) => void;
    elicitation?: ReactNode;
    composerDisabled?: boolean;
    plan?: ReactNode;
    planStreaming?: boolean;
    review?: {
      state: ReviewState;
      onDecide: (decision: ReviewDecision) => void;
      onClear: (scope: "document" | "section" | "file" | "hunk", id: string) => void;
    };
  };
}

/** Real cost figures for this project, fetched once mounted and refreshed
 * with the rest of the poll cycle — same enriched fields /api/projects
 * already returns for the dashboard, read here per-project instead. */
interface CostSnapshot {
  costUsd: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Pairs each run_command tool_call with its result to build a real terminal
 * run. Pairing is same-agent, in stream order — sound because a single
 * agent's tool loop (packages/agent-runtime/src/claude-loop.ts) processes
 * one call at a time; it never has two run_command calls in flight for the
 * same agent simultaneously, only across different agents, which don't
 * share a run identity anyway.
 */
function deriveTerminalRuns(items: ReturnType<typeof useBuildStream>["items"]): TerminalRun[] {
  const runs: TerminalRun[] = [];
  const open = new Map<string, TerminalRun>();
  let seq = 0;

  for (const item of items) {
    if (item.kind !== "event") continue;
    const ev = item.event as ToolEvent;

    if (ev.type === "tool_call" && ev.tool === "run_command") {
      const input = (ev.input ?? {}) as Record<string, unknown>;
      const command = typeof input.command === "string" ? input.command : "run_command";
      const run: TerminalRun = { id: `run-${seq++}`, command, output: "", status: "running" };
      runs.push(run);
      open.set(ev.agent, run);
      continue;
    }

    if (ev.type === "tool_result" && ev.tool === "run_command") {
      const output =
        typeof ev.output === "string" ? ev.output : typeof ev.summary === "string" ? ev.summary : "";
      const pending = open.get(ev.agent);
      if (pending) {
        pending.output = output;
        pending.status = ev.status === "error" ? "failed" : "success";
        open.delete(ev.agent);
      } else {
        // A result with no call in the current window (stream reconnected
        // mid-run) — still real, just without a known command string.
        runs.push({
          id: `run-${seq++}`,
          command: "(command)",
          output,
          status: ev.status === "error" ? "failed" : "success",
        });
      }
    }
  }

  // Ambient panel, not a full log — the newest handful is what "what's
  // running right now" actually needs.
  return runs.slice(-20);
}

function diffStatusToFileStatus(status: DiffFileStatus): "new" | "modified" | "deleted" {
  return status === "added" ? "new" : status;
}

const PANEL_LABEL: Record<PanelKey, string> = {
  plan: "Plan",
  context: "Context",
  preview: "Preview",
  tasks: "Background tasks",
  changes: "Files changed",
  cost: "Cost & tokens",
};

export default function IdeWorkspace(props: IdeWorkspaceProps) {
  const {
    projectId, projectName, appUrl, isDone, stageMessage,
    tree, awaitingSpecApproval, buildPlan, awaitingDeployApproval, submitting,
    changeRequest, onChangeRequest, onApproveSpec, onApproveDeploy, planning,
  } = props;

  // No pipeline exists yet during planning, so there is nothing for the
  // build stream to connect to — matches useBuildStream's own `enabled` gate.
  const { items, conn } = useBuildStream(projectId, !planning);
  const planningEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (planning) planningEndRef.current?.scrollIntoView({ block: "end" });
  }, [planning, planning?.messages.length, planning?.streamingMessage, planning?.loading]);

  const [leftOpen, setLeftOpen] = useState(true);
  const [leftView, setLeftView] = useState<LeftView>("explorer");
  const [filter, setFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(true);
  // Several independent mini-panels rather than one drawer switching between
  // two fixed modes — Plan open by default (it's what a new project needs
  // first), everything else opened deliberately as it becomes relevant.
  const [panelOpen, setPanelOpen] = useState<Record<PanelKey, boolean>>({
    plan: true, context: false, preview: false, tasks: false, changes: false, cost: false,
  });
  const [maximized, setMaximized] = useState<PanelKey | null>(null);
  const togglePanel = useCallback((key: PanelKey) => {
    setPanelOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const toggleMaximize = useCallback((key: PanelKey) => {
    setMaximized((prev) => (prev === key ? null : key));
  }, []);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState<DiffFile[]>([]);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [patchPath, setPatchPath] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cost, setCost] = useState<CostSnapshot | null>(null);

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && tree.length > 0) {
      seededRef.current = true;
      setExpanded(new Set(defaultExpanded(tree)));
    }
  }, [tree]);

  const fetchFile = useCallback(async (path: string) => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, loading: true } : t)));
    try {
      const r = await fetch(`${API}/api/artifacts/${projectId}/file?path=${encodeURIComponent(path)}`, {
        credentials: "include",
      });
      const content = r.ok ? ((await r.json()) as { content: string }).content : "// Could not load file";
      setTabs((prev) => prev.map((t) => (t.path === path ? { path, content, loading: false } : t)));
    } catch {
      setTabs((prev) => prev.map((t) => (t.path === path ? { path, content: "// Error loading file", loading: false } : t)));
    }
  }, [projectId]);

  const openFile = useCallback((node: ApiNode) => {
    if (node.type !== "file") return;
    setLeftView("explorer");
    setPatchPath(null); // file view and diff view are mutually exclusive in the center pane
    setActivePath(node.path);
    setTabs((prev) => (prev.some((t) => t.path === node.path) ? prev : [...prev, { path: node.path, content: null, loading: true }]));
    void fetchFile(node.path);
  }, [fetchFile]);

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      const next = prev.filter((t) => t.path !== path);
      if (activePath === path) {
        const neighbor = prev[idx + 1] ?? prev[idx - 1] ?? null;
        setActivePath(neighbor ? neighbor.path : null);
      }
      return next;
    });
  }, [activePath]);

  const touched = useMemo(() => deriveTouchedFiles(items), [items]);
  const freshPaths = useMemo(
    () => new Set(touched.filter((f) => now - f.at < FRESH_WINDOW_MS).map((f) => f.path)),
    [touched, now],
  );
  const activeWrites = useMemo(() => deriveActiveWrites(items, now), [items, now]);
  const activeDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const path of activeWrites) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return dirs;
  }, [activeWrites]);

  const prevWritingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const prevWriting = prevWritingRef.current;
    for (const tab of tabs) {
      if (prevWriting.has(tab.path) && !activeWrites.has(tab.path)) void fetchFile(tab.path);
    }
    prevWritingRef.current = new Set(activeWrites);
  }, [activeWrites, tabs, fetchFile]);

  const loadDiff = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/artifacts/${projectId}/diff`, { credentials: "include" });
      if (!r.ok) {
        // 404 covers two genuinely different cases the status code alone
        // can't tell apart: a real ownership failure (`not_found`) and a
        // project that legitimately has no build directory yet because
        // code generation hasn't started (`build_not_ready` — true for
        // every project still in planning, including this one's own
        // creator). Collapsing both into "not available on your account"
        // told the owner of a brand-new project their own project wasn't
        // theirs. Read the body to tell them apart.
        const body = await r.json().catch(() => null);
        setDiffError(
          body?.error === "build_not_ready"
            ? "No files yet — changes appear here once the build starts."
            : r.status === 404 || r.status === 403
              ? "This project isn't available on your account."
              : "Couldn't load changes.",
        );
        return;
      }
      const j = await r.json();
      setDiffError(null);
      setDiff(Array.isArray(j.files) ? j.files : []);
    } catch {
      setDiffError("Couldn't load changes.");
    }
  }, [projectId]);

  useEffect(() => {
    if (leftView === "changes" || panelOpen.changes) void loadDiff();
  }, [leftView, panelOpen.changes, loadDiff]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/projects/${projectId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setCost({ costUsd: j.costUsd ?? "0", tokensIn: j.tokensIn ?? 0, tokensOut: j.tokensOut ?? 0 });
      })
      .catch(() => {});
    const t = setInterval(() => {
      fetch(`${API}/api/projects/${projectId}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && j) setCost({ costUsd: j.costUsd ?? "0", tokensIn: j.tokensIn ?? 0, tokensOut: j.tokensOut ?? 0 }); })
        .catch(() => {});
    }, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  const acceptFile = useCallback(async (path: string) => {
    setDiff((prev) => prev.map((f) => (f.path === path ? { ...f, reviewed: true } : f)));
    try {
      await fetch(`${API}/api/artifacts/${projectId}/diff/accept`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
      });
    } catch { /* accept is a review mark, not a write — nothing to roll back */ }
  }, [projectId]);

  const acceptAll = useCallback(async () => {
    setDiff((prev) => prev.map((f) => ({ ...f, reviewed: true })));
    try {
      await fetch(`${API}/api/artifacts/${projectId}/diff/accept-all`, { method: "POST", credentials: "include" });
    } catch { /* same as acceptFile */ }
  }, [projectId]);

  const rejectFile = useCallback(async (path: string) => {
    setConfirmReject(null);
    const prevDiff = diff;
    setDiff((prev) => prev.filter((f) => f.path !== path));
    if (patchPath === path) { setPatchPath(null); setPatch(null); }
    closeTab(path);
    try {
      const r = await fetch(`${API}/api/artifacts/${projectId}/diff/reject`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setDiff(prevDiff);
    }
  }, [projectId, diff, patchPath, closeTab]);

  const rejectAll = useCallback(async () => {
    setConfirmReject(null);
    const prevDiff = diff;
    const paths = diff.map((f) => f.path);
    setDiff([]);
    setPatchPath(null);
    setPatch(null);
    paths.forEach(closeTab);
    try {
      const r = await fetch(`${API}/api/artifacts/${projectId}/diff/reject-all`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error();
    } catch {
      setDiff(prevDiff);
    }
  }, [projectId, diff, closeTab]);

  const openPatch = useCallback(async (path: string) => {
    setActivePath(null); // file view and diff view are mutually exclusive in the center pane
    setPatchPath(path);
    setPatch(null);
    try {
      const r = await fetch(`${API}/api/artifacts/${projectId}/diff/file?path=${encodeURIComponent(path)}`, { credentials: "include" });
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

  const thoughts = useMemo(() => narrate(items), [items]);
  const terminalRuns = useMemo(() => deriveTerminalRuns(items), [items]);
  const filteredTree = useMemo(() => (filter.trim() ? filterTree(tree, filter.trim().toLowerCase()) : tree), [tree, filter]);

  const gate = awaitingSpecApproval
    ? { title: "Specification ready", hint: "Review the plan, add changes if you want, then approve.", cta: submitting ? "Approving…" : changeRequest.trim() ? "Approve with changes" : "Approve & build", onGo: onApproveSpec, input: true }
    : awaitingDeployApproval
      ? { title: "Build verified", hint: "Quality checks passed. Approve to launch it locally.", cta: submitting ? "Deploying…" : "Approve & launch", onGo: onApproveDeploy, input: false }
      : null;

  const diffEntries: DiffStatEntry[] = useMemo(
    () => diff.map((f) => ({ path: f.path, additions: f.added ?? 0, deletions: f.removed ?? 0, status: diffStatusToFileStatus(f.status), binary: f.binary })),
    [diff],
  );
  const costEntries: UsageEntry[] = useMemo(
    () => (cost ? [{ model: "combined", inputTokens: cost.tokensIn, outputTokens: cost.tokensOut, cost: Number(cost.costUsd) }] : []),
    [cost],
  );

  const isLive = conn === "live";

  // Each dock panel's body, defined once and reused in both its normal
  // stacked slot and the maximize overlay — a maximized panel is the same
  // content at a different size, never a second copy that could drift.
  const planContent = planning ? (
    <>
      {planning.plan ?? (
        <div className={s.empty}>The spec fills in here as we talk — pages, data model, API surface, and the design direction.</div>
      )}
      {planning.review && planning.plan && (
        <div style={{ padding: 12 }}>
          <ReviewGate
            scope="document"
            id="plan"
            label="Build plan"
            value={planning.review.state}
            onDecide={planning.review.onDecide}
            onClear={planning.review.onClear}
          />
        </div>
      )}
    </>
  ) : buildPlan ? (
    <PlanPreview plan={buildPlan} />
  ) : (
    <div className={s.empty}>The specification appears here once the plan is written.</div>
  );

  const previewContent = appUrl ? (
    <PreviewFrame
      src={appUrl}
      height="100%"
      viewports={[{ id: "fill", label: "Fill", width: null }]}
      className={s.previewFrame}
    />
  ) : (
    <div className={s.tileEmpty}>Not deployed yet — the preview appears once the app is live.</div>
  );

  const tasksContent = terminalRuns.length === 0 ? (
    <div className={s.tileEmpty}>Commands run by the agents will appear here.</div>
  ) : (
    <TerminalSurface runs={terminalRuns} maxOutputHeight={maximized === "tasks" ? 400 : 120} />
  );

  const changesContent = diffEntries.length === 0 ? (
    <div className={s.tileEmpty}>{diffError ?? "No file changes recorded for this build."}</div>
  ) : (
    <AgentDiffstat entries={diffEntries} sortable={false} />
  );

  const costContent = costEntries.length === 0 ? (
    <div className={s.tileEmpty}>Loading…</div>
  ) : (
    <CostMeter entries={costEntries} showTokens />
  );

  return (
    <div className={s.root}>
      <header className={s.titlebar}>
        <Link href="/dashboard" className={s.brand}>
          <YugnexLogo size={17} />
          YugNex
        </Link>
        <span className={s.projectSep}>/</span>
        <ProjectSwitcher projectId={projectId} projectName={projectName} />
        <div className={s.titleSpacer} />
        {appUrl && <a href={appUrl} target="_blank" rel="noreferrer" className={s.openBtn}>Open app</a>}
        <AccountMenu />
      </header>

      <div className={s.workbench}>
        {/* ── Icon rail ─────────────────────────────────────────────── */}
        <nav className={s.rail}>
          {/* No separate collapse toggle — clicking a panel's own icon opens
             it, and clicking it again while it's the one showing closes it.
             One control per action instead of two that overlap. */}
          <button
            type="button"
            className={`${s.railBtn} ${leftOpen && leftView === "explorer" ? s.railBtnActive : ""}`}
            title="Explorer"
            onClick={() => {
              if (leftOpen && leftView === "explorer") setLeftOpen(false);
              else { setLeftView("explorer"); setLeftOpen(true); }
            }}
          >
            <IconExplorer />
            {freshPaths.size > 0 && <span className={s.railDot} />}
          </button>
          <button
            type="button"
            className={s.railBtn}
            title="Filter files"
            onClick={() => { setLeftView("explorer"); setLeftOpen(true); }}
          >
            <IconSearch />
          </button>
          <button
            type="button"
            className={`${s.railBtn} ${leftOpen && leftView === "changes" ? s.railBtnActive : ""}`}
            title="Changes"
            onClick={() => {
              if (leftOpen && leftView === "changes") setLeftOpen(false);
              else { setLeftView("changes"); setLeftOpen(true); }
            }}
          >
            <IconChanges />
            {diff.some((f) => !f.reviewed) && <span className={s.railDot} />}
          </button>
          <button
            type="button"
            className={s.railBtn}
            title="Preview"
            disabled={!appUrl}
            onClick={() => { setDrawerOpen(true); setPanelOpen((p) => ({ ...p, preview: true })); }}
          >
            <IconPreview />
          </button>
          <button
            type="button"
            className={`${s.railBtn} ${drawerOpen ? s.railBtnActive : ""}`}
            title="Panels"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <IconGrid />
          </button>
          <div className={s.railSpacer} />
          <Link href="/settings" className={s.railBtn} title="Settings">
            <IconSettings />
          </Link>
        </nav>

        {/* ── Left sidebar ──────────────────────────────────────────── */}
        {/* Always mounted — open/closed is a width transition (see
           IdeWorkspace.styles.ts), so the center pane reflows smoothly
           instead of jumping when this column disappears. */}
        <aside className={`${s.sidebar} ${leftOpen ? s.sidebarExpanded : s.sidebarCollapsed}`}>
            <div className={s.sidebarHead}>
              <span className={s.sidebarLabel}>{leftView === "changes" ? "Changes" : "Explorer"}</span>
              <span className={s.sidebarCount}>{leftView === "changes" ? diff.length : tree.length}</span>
            </div>

            {leftView === "explorer" && (
              <input
                className={s.filterBox}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter files…"
              />
            )}

            {leftView === "changes" && diff.length > 0 && (
              confirmReject === "__all__" ? (
                <div className={s.diffToolbar}>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmReject(null)} style={{ flex: 1 }}>Cancel</Button>
                  <Button size="sm" tone="destructive" onClick={rejectAll} style={{ flex: 1 }}>Revert all</Button>
                </div>
              ) : (
                <div className={s.diffToolbar}>
                  <button type="button" className={s.diffToolbarBtn} onClick={acceptAll}>Accept all</button>
                  <button type="button" className={s.diffToolbarBtn} onClick={() => setConfirmReject("__all__")}>Reject all</button>
                </div>
              )
            )}

            <div className={s.sidebarBody}>
              {leftView === "changes" ? (
                diff.length === 0 ? (
                  <div className={s.empty}>{diffError ?? "No file changes recorded for this build."}</div>
                ) : (
                  diff.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      title={f.path}
                      onClick={() => openPatch(f.path)}
                      className={`${s.diffRow} ${patchPath === f.path ? s.diffRowSelected : ""}`}
                    >
                      <span className={`${s.diffBadge} ${f.status === "added" ? s.diffBadgeAdd : f.status === "deleted" ? s.diffBadgeDel : s.diffBadgeMod}`}>
                        {f.status === "added" ? "N" : f.status === "deleted" ? "D" : "M"}
                      </span>
                      <FileIcon filename={baseName(f.path)} size={13} />
                      <span className={s.diffName}>{baseName(f.path)}</span>
                      <span className={s.diffStat}>
                        {f.binary ? <span className={s.diffDel}>bin</span> : (
                          <>
                            {f.added ? <span className={s.diffAdd}>+{f.added}</span> : null}
                            {f.removed ? <span className={s.diffDel}>−{f.removed}</span> : null}
                          </>
                        )}
                      </span>
                    </button>
                  ))
                )
              ) : filteredTree.length === 0 ? (
                <div className={s.empty}>
                  {filter.trim() ? "No files match." : "Generated files appear here as they are written."}
                </div>
              ) : (
                <SidebarTree
                  nodes={filteredTree}
                  depth={0}
                  expanded={expanded}
                  selected={activePath}
                  fresh={freshPaths}
                  writing={activeWrites}
                  activeDirs={activeDirs}
                  onToggle={toggle}
                  onSelect={openFile}
                />
              )}
            </div>
        </aside>

        {/* ── Center stream ─────────────────────────────────────────── */}
        <section className={s.center}>
          <header className={s.centerHead}>
            <span className={s.centerHeadTitle}>{planning ? "Planning" : isDone ? "Delivered" : "Building"}</span>
            <div className={s.centerHeadSpacer} />
            {!planning && (
              <span className={s.liveTag}>
                <span className={`${s.liveDot} ${isLive ? s.liveDotOn : ""}`} />
                {conn === "live" ? "Live" : conn === "retrying" ? "Reconnecting" : "Connecting"}
              </span>
            )}
            <button
              type="button"
              className={`${s.drawerToggle} ${drawerOpen ? s.drawerToggleActive : ""}`}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <IconGrid size={12} /> Panels
            </button>
          </header>

          {tabs.length > 0 && (
            <div className={s.tabStrip}>
              <FileTabs
                files={tabs.map<OpenFile>((t) => ({ path: t.path, dirty: activeWrites.has(t.path) }))}
                active={activePath ?? undefined}
                onActivate={(path) => { setPatchPath(null); setActivePath(path); }}
                onClose={closeTab}
              />
              <button type="button" className={s.streamBackBtn} onClick={() => setActivePath(null)}>
                Stream
              </button>
            </div>
          )}

          {patchPath && (
            <div className={s.tabStrip}>
              <span className={s.patchPathLabel} title={patchPath}>{baseName(patchPath)}</span>
              <button type="button" className={s.streamBackBtn} onClick={() => setPatchPath(null)}>
                Stream
              </button>
            </div>
          )}

          {patchPath ? (
            <div className={s.fileBody}>
              {patch === null ? (
                <div className={s.empty}>Loading…</div>
              ) : (
                (() => {
                  const { before, after } = patchToBeforeAfter(patch);
                  return <DiffView before={before} after={after} filename={patchPath} showLineNumbers />;
                })()
              )}
            </div>
          ) : activePath ? (
            <div className={s.fileBody}>
              {(() => {
                const active = tabs.find((t) => t.path === activePath);
                if (!active) return null;
                if (active.loading) return <div className={s.empty}>Loading…</div>;
                return <Syntax code={active.content ?? ""} filename={active.path} showLineNumbers />;
              })()}
            </div>
          ) : planning ? (
            <>
              <div className={s.fieldLayer}>
                <AgenticField />
              </div>

              <div className={s.stream}>
                {planning.messages.length === 0 && !planning.streamingMessage && !planning.loading ? (
                  <div className={s.streamEmpty}>
                    <div className={s.streamEmptyTitle}>What are we building?</div>
                    <div className={s.streamEmptyBody}>
                      Describe it in your own words. I&apos;ll ask only what I actually need, then write
                      the spec in the Plan panel as we go.
                    </div>
                  </div>
                ) : (
                  planning.messages.map((m, i) => (
                    <PlanRow key={i} role={m.role}>{m.content}</PlanRow>
                  ))
                )}
                {(planning.streamingMessage || planning.loading) && (
                  <PlanRow role="assistant">
                    {planning.streamingMessage ? (
                      <StreamingText text={planning.streamingMessage} charsPerSecond={220} />
                    ) : (
                      <ThinkingIndicator label="Thinking" />
                    )}
                  </PlanRow>
                )}
                <div ref={planningEndRef} />
              </div>

              <div className={s.capsuleWrap}>
                {planning.elicitation && <div style={{ marginBottom: 8 }}>{planning.elicitation}</div>}
                <PromptInput
                  value={planning.input}
                  onValueChange={planning.onInputChange}
                  onSubmit={planning.onSend}
                  isLoading={planning.loading}
                  disabled={planning.composerDisabled}
                  minRows={2}
                  placeholder={planning.composerDisabled ? "Pick an option above to continue…" : "Describe your app…"}
                  actions={
                    <Button
                      size="sm"
                      onClick={() => planning.onSend(planning.input)}
                      disabled={planning.loading || planning.composerDisabled || !planning.input.trim()}
                    >
                      Send
                    </Button>
                  }
                />
              </div>
            </>
          ) : (
            <>
              <div className={s.fieldLayer}>
                <AgenticField />
              </div>

              <div className={s.stream}>
                {thoughts.length === 0 ? (
                  <div className={s.streamEmpty}>
                    <div className={s.streamEmptyTitle}>Nothing yet</div>
                    <div className={s.streamEmptyBody}>
                      As agents work, what they&apos;re doing streams here in plain language — file writes,
                      commands, and anything that needs your attention.
                    </div>
                  </div>
                ) : (
                  thoughts.map((t, i) => {
                    const isLast = i === thoughts.length - 1;
                    return <StreamRow key={t.id} thought={t} isLast={isLast} isLive={isLive} />;
                  })
                )}
              </div>

              <div className={s.capsuleWrap}>
                {gate ? (
                  <div className={s.gateCard}>
                    <div className={s.gateTitle}>{gate.title}</div>
                    <div className={s.gateHint}>{gate.hint}</div>
                    {gate.input && (
                      <input
                        className={s.gateInput}
                        value={changeRequest}
                        onChange={(e) => onChangeRequest(e.target.value)}
                        placeholder="Any changes first…"
                      />
                    )}
                    <div className={s.gateActions}>
                      <Button size="sm" onClick={gate.onGo} disabled={submitting}>{gate.cta}</Button>
                    </div>
                  </div>
                ) : (
                  <div className={s.statusLine}>
                    <span className={`${s.liveDot} ${isLive ? s.liveDotOn : ""}`} />
                    {isDone ? "Your app is ready." : stageMessage}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* ── Right drawer ──────────────────────────────────────────── */}
        {/* Always mounted — same width-transition pattern as the sidebar. */}
        <aside className={`${s.drawer} ${drawerOpen ? s.drawerExpanded : s.drawerCollapsed}`}>
            <div className={s.drawerHead}>
              <span className={s.drawerLabel}>Panels</span>
              <button type="button" className={s.drawerClose} onClick={() => setDrawerOpen(false)}>×</button>
            </div>
            <div className={s.drawerBody}>
              <DockPanel
                icon={<IconPlan size={12} />}
                label="Plan"
                open={panelOpen.plan && maximized !== "plan"}
                onToggleOpen={() => togglePanel("plan")}
                maximized={maximized === "plan"}
                onToggleMaximize={() => toggleMaximize("plan")}
              >
                {planContent}
              </DockPanel>

              <DockPanel
                icon={<IconContext size={12} />}
                label="Context"
                open={panelOpen.context && maximized !== "context"}
                onToggleOpen={() => togglePanel("context")}
                maximized={maximized === "context"}
                onToggleMaximize={() => toggleMaximize("context")}
              >
                <ContextPanel projectId={projectId} />
              </DockPanel>

              <DockPanel
                icon={<IconPreview size={12} />}
                label="Preview"
                open={panelOpen.preview && maximized !== "preview"}
                onToggleOpen={() => togglePanel("preview")}
                maximized={maximized === "preview"}
                onToggleMaximize={() => toggleMaximize("preview")}
              >
                {previewContent}
              </DockPanel>

              <DockPanel
                icon={<IconGrid size={12} />}
                label="Background tasks"
                open={panelOpen.tasks && maximized !== "tasks"}
                onToggleOpen={() => togglePanel("tasks")}
                maximized={maximized === "tasks"}
                onToggleMaximize={() => toggleMaximize("tasks")}
              >
                {tasksContent}
              </DockPanel>

              <DockPanel
                icon={<IconChanges size={12} />}
                label="Files changed"
                badge={diffEntries.length > 0 ? <span className={s.dockPanelBadge} /> : undefined}
                open={panelOpen.changes && maximized !== "changes"}
                onToggleOpen={() => togglePanel("changes")}
                maximized={maximized === "changes"}
                onToggleMaximize={() => toggleMaximize("changes")}
              >
                {changesContent}
              </DockPanel>

              <DockPanel
                icon={<IconCost size={12} />}
                label="Cost & tokens"
                open={panelOpen.cost && maximized !== "cost"}
                onToggleOpen={() => togglePanel("cost")}
                maximized={false}
                onToggleMaximize={() => {}}
                maximizable={false}
              >
                {costContent}
              </DockPanel>
            </div>
        </aside>

        {maximized && (
          <div className={s.maximizeOverlay}>
            <div className={s.maximizeOverlayHead}>
              <span className={s.drawerLabel}>{PANEL_LABEL[maximized]}</span>
              <div className={s.centerHeadSpacer} />
              <button type="button" className={s.dockPanelMaxBtn} style={{ position: "static" }} onClick={() => setMaximized(null)}>
                <IconMinimize size={13} />
              </button>
            </div>
            <div className={s.maximizeOverlayBody}>
              {maximized === "plan" && planContent}
              {maximized === "context" && <ContextPanel projectId={projectId} />}
              {maximized === "preview" && previewContent}
              {maximized === "tasks" && tasksContent}
              {maximized === "changes" && changesContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Plan row ─────────────────────────────────────────────────────────── */

/**
 * Planning-phase messages, in the same row shape as the build-phase stream
 * below (streamRow/streamWho/streamBody) — no per-side bubble, no reversed
 * alignment, no fixed max-width. A bubble doesn't reflow when its container
 * changes width, which is also why the sidebar/drawer collapse used to look
 * broken: the message just sat there, off-center, while the freed space
 * showed as dead space beside it. Full-width plain text has no such state.
 */
function PlanRow({ role, children }: { role: "user" | "assistant" | "system"; children: ReactNode }) {
  return (
    <div className={s.streamRow}>
      <span className={s.streamWho}>{role === "user" ? "You" : ""}</span>
      <div className={s.streamBody}>
        <div className={role === "user" ? s.planUserText : s.planText}>{children}</div>
      </div>
    </div>
  );
}

/* ── Stream row ───────────────────────────────────────────────────────── */

function StreamRow({ thought, isLast, isLive }: { thought: Thought; isLast: boolean; isLive: boolean }) {
  const isRunning = isLast && isLive && thought.kind === "doing" && Date.now() - thought.ts < 4000;

  if (thought.kind === "doing" && thought.meta) {
    return (
      <div className={s.streamRow}>
        <span className={`${s.streamWho} ${isRunning ? s.streamWhoLive : ""}`}>{thought.who}</span>
        <div className={s.streamBody}>
          <ToolCall
            name={thought.text}
            args={thought.meta}
            status={isRunning ? "running" : "success"}
            defaultOpen={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={s.streamRow}>
      <span className={`${s.streamWho} ${isRunning ? s.streamWhoLive : ""}`}>{thought.who}</span>
      <div className={s.streamBody}>
        <div className={`${s.streamText} ${thought.kind === "problem" ? s.streamTextProblem : ""}`}>
          {thought.text}
        </div>
        {thought.meta && <div className={s.streamMeta}>{thought.meta}</div>}
      </div>
    </div>
  );
}

/* ── Sidebar tree ─────────────────────────────────────────────────────── */

function filterTree(nodes: ApiNode[], needle: string): ApiNode[] {
  const out: ApiNode[] = [];
  for (const n of nodes) {
    if (n.type === "directory") {
      const children = filterTree(n.children ?? [], needle);
      if (children.length > 0 || n.name.toLowerCase().includes(needle)) {
        out.push({ ...n, children });
      }
    } else if (n.name.toLowerCase().includes(needle) || n.path.toLowerCase().includes(needle)) {
      out.push(n);
    }
  }
  return out;
}

function SidebarTree({
  nodes, depth, expanded, selected, fresh, writing, activeDirs, onToggle, onSelect,
}: {
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
        return (
          <div key={n.path}>
            <button
              type="button"
              title={n.path}
              onClick={() => (isDir ? onToggle(n.path) : onSelect(n))}
              className={`${s.treeRow} ${selected === n.path ? s.treeRowSelected : ""}`}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <span className={`${s.treeCaret} ${isDir && open ? s.treeCaretOpen : ""}`}>{isDir ? "▸" : ""}</span>
              <span className={s.treeMark}>
                <FileIcon filename={n.name} size={13} variant={isDir ? (open ? "folder-open" : "folder") : "file"} muted={isDir} />
              </span>
              <span className={`${s.treeName} ${isDir ? s.treeNameDir : ""} ${isWriting && !isDir ? s.treeNameWriting : isFresh && !isDir ? s.treeNameFresh : ""}`}>
                {n.name}
              </span>
              {!isDir && (isWriting ? <span className={`${s.treePip} ${s.treePipWriting}`} /> : isFresh ? <span className={`${s.treePip} ${s.treePipFresh}`} /> : null)}
            </button>
            {isDir && open && (
              <SidebarTree nodes={n.children ?? []} depth={depth + 1} expanded={expanded} selected={selected} fresh={fresh} writing={writing} activeDirs={activeDirs} onToggle={onToggle} onSelect={onSelect} />
            )}
          </div>
        );
      })}
    </>
  );
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
