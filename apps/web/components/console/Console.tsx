"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useBuildStream,
  useSystemVitals,
  deriveWorkstreams,
  deriveTouchedFiles,
} from "../../lib/live";
import ActivityStream from "./ActivityStream";
import FileExplorer, { type ApiNode } from "./FileExplorer";
import PipelineRibbon from "./PipelineRibbon";
import SystemVitals from "./SystemVitals";
import WorkstreamRoster from "./WorkstreamRoster";
import s from "./console.module.css";

/** How long a freshly written file stays highlighted in the explorer. */
const FRESH_WINDOW_MS = 45_000;

type Tab = "activity" | "files" | "preview";

export interface ConsoleProps {
  projectId: string;
  projectName: string;
  appUrl?: string | null;
  isDone: boolean;
  failed?: boolean;
  stage: string;
  stageMessage: string;

  tree: ApiNode[];
  selectedPath: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  onSelectFile: (node: ApiNode) => void;

  /** Gate state — rendered inline rather than as a modal to hunt for. */
  awaitingSpecApproval: boolean;
  awaitingDeployApproval: boolean;
  submitting: boolean;
  changeRequest: string;
  onChangeRequest: (v: string) => void;
  onApproveSpec: () => void;
  onApproveDeploy: () => void;
}

export default function Console(props: ConsoleProps) {
  const {
    projectId,
    projectName,
    appUrl,
    isDone,
    failed,
    stage,
    stageMessage,
    tree,
    selectedPath,
    fileContent,
    fileLoading,
    onSelectFile,
    awaitingSpecApproval,
    awaitingDeployApproval,
    submitting,
    changeRequest,
    onChangeRequest,
    onApproveSpec,
    onApproveDeploy,
  } = props;

  const { items, conn } = useBuildStream(projectId);
  const { vitals } = useSystemVitals();

  const [tab, setTab] = useState<Tab>("activity");
  const [filterAgent, setFilterAgent] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);

  // A 1s tick drives the elapsed counters and the activity recency window.
  // Deriving "active" from a timestamp comparison means it decays on its own
  // rather than needing an explicit stop signal the runtime never sends.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Track when the current stage began, for the ribbon's live timer.
  const stageStartRef = useRef<{ stage: string; at: number }>({ stage, at: Date.now() });
  if (stageStartRef.current.stage !== stage) {
    stageStartRef.current = { stage, at: Date.now() };
  }

  const workstreams = useMemo(() => deriveWorkstreams(items, now), [items, now]);
  const touched = useMemo(() => deriveTouchedFiles(items), [items]);

  const freshPaths = useMemo(
    () => new Set(touched.filter((f) => now - f.at < FRESH_WINDOW_MS).map((f) => f.path)),
    [touched, now],
  );

  const eventCount = useMemo(() => items.filter((i) => i.kind === "event").length, [items]);
  const errorCount = useMemo(
    () => items.filter((i) => i.kind === "event" && i.event.status === "error").length,
    [items],
  );

  // When the app goes live, the preview is the interesting thing — but never
  // yank the tab out from under someone who chose another one.
  const autoSwitchedRef = useRef(false);
  useEffect(() => {
    if (isDone && appUrl && !autoSwitchedRef.current) {
      autoSwitchedRef.current = true;
      setTab("preview");
    }
  }, [isDone, appUrl]);

  const gate = awaitingSpecApproval
    ? ({
        title: "Specification ready for approval",
        hint: "Review the plan, add any changes, then approve to start the build.",
        cta: submitting ? "Approving…" : changeRequest.trim() ? "Approve with changes" : "Approve & build",
        onApprove: onApproveSpec,
        withInput: true,
      } as const)
    : awaitingDeployApproval
      ? ({
          title: "Build verified — ready to deploy",
          hint: "Quality checks passed. Approve to launch the app locally.",
          cta: submitting ? "Deploying…" : "Approve & launch",
          onApprove: onApproveDeploy,
          withInput: false,
        } as const)
      : null;

  return (
    <div className={s.shell}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className={s.header}>
        <Link href="/dashboard" className={s.brand}>
          <span className={s.brandMark}>Y</span>
          YugNex
        </Link>
        <span className={s.crumb}>
          <span className={s.crumbSep}>/</span>
          <span className={s.crumbName}>{projectName}</span>
        </span>

        <div className={s.headerRight}>
          <span
            className={`${s.conn} ${conn === "live" ? s.connLive : conn === "retrying" ? s.connRetry : ""}`}
          >
            <span className={s.connDot} />
            {conn === "live" ? "live" : conn === "retrying" ? "reconnecting" : "connecting"}
          </span>
          {appUrl && (
            <a href={appUrl} target="_blank" rel="noreferrer" className={`${s.btn} ${s.btnPrimary}`}>
              Open app
            </a>
          )}
        </div>
      </header>

      {/* ── Pipeline ribbon ────────────────────────────────────────────── */}
      <div>
        <PipelineRibbon
          stage={isDone ? "done" : stage}
          failed={failed}
          startedAt={stageStartRef.current.at}
          now={now}
        />
        {gate && (
          <div className={s.gate}>
            <div className={s.gateText}>
              <div className={s.gateTitle}>{gate.title}</div>
              <div className={s.gateHint}>{gate.hint}</div>
            </div>
            {gate.withInput && (
              <input
                className={s.steer}
                style={{ maxWidth: 380 }}
                value={changeRequest}
                onChange={(e) => onChangeRequest(e.target.value)}
                placeholder="Optional: describe any changes first…"
              />
            )}
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={gate.onApprove}
              disabled={submitting}
            >
              {gate.cta}
            </button>
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className={s.body}>
        <aside className={s.rail}>
          <WorkstreamRoster
            workstreams={workstreams}
            selected={filterAgent}
            onSelect={setFilterAgent}
          />
        </aside>

        <main className={s.center}>
          <div className={s.tabs}>
            <button
              type="button"
              className={`${s.tab} ${tab === "activity" ? s.tabActive : ""}`}
              onClick={() => setTab("activity")}
            >
              Activity
              <span className={`${s.tabBadge} ${errorCount > 0 ? s.tabBadgeAlert : conn === "live" ? s.tabBadgeLive : ""}`}>
                {errorCount > 0 ? `${errorCount} err` : eventCount}
              </span>
            </button>

            <button
              type="button"
              className={`${s.tab} ${tab === "files" ? s.tabActive : ""}`}
              onClick={() => setTab("files")}
            >
              Files
              {freshPaths.size > 0 ? (
                <span className={`${s.tabBadge} ${s.tabBadgeLive}`}>+{freshPaths.size}</span>
              ) : (
                tree.length > 0 && <span className={s.tabBadge}>{tree.length}</span>
              )}
            </button>

            <button
              type="button"
              className={`${s.tab} ${tab === "preview" ? s.tabActive : ""}`}
              onClick={() => setTab("preview")}
              disabled={!appUrl}
              title={appUrl ? undefined : "Available once the app is deployed"}
            >
              Preview
            </button>

            {/* Right-aligned stream controls */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {filterAgent && (
                <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setFilterAgent(null)}>
                  Clear filter: {filterAgent}
                </button>
              )}
              {tab === "activity" && (
                <button
                  type="button"
                  className={`${s.btn} ${s.btnGhost}`}
                  onClick={() => setShowLogs((v) => !v)}
                >
                  {showLogs ? "Hide raw log" : "Show raw log"}
                </button>
              )}
            </div>
          </div>

          {tab === "activity" && (
            <ActivityStream items={items} filterAgent={filterAgent} showLogs={showLogs} />
          )}

          {tab === "files" && (
            <div className={s.pane} style={{ display: "grid", gridTemplateColumns: "minmax(200px, 280px) minmax(0, 1fr)" }}>
              <div style={{ borderRight: "1px solid var(--nx-border-muted)", overflowY: "auto" }}>
                <FileExplorer
                  tree={tree}
                  selected={selectedPath}
                  freshPaths={freshPaths}
                  onSelect={onSelectFile}
                />
              </div>
              <div style={{ overflow: "auto", minWidth: 0 }}>
                {fileLoading && <div className={s.logLine}>Loading…</div>}
                {!fileLoading && fileContent !== null && <pre className={s.code}>{fileContent}</pre>}
                {!fileLoading && fileContent === null && (
                  <div className={s.empty}>
                    <div className={s.emptyTitle}>Select a file</div>
                    <div className={s.emptyHint}>
                      Files the agents just wrote are highlighted as they land.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "preview" && (
            <div className={s.pane} style={{ display: "grid", gridTemplateRows: "auto 1fr" }}>
              <div className={s.previewBar}>
                <span className={s.previewUrl}>{appUrl}</span>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnGhost}`}
                  onClick={() => setPreviewKey((k) => k + 1)}
                >
                  Reload
                </button>
              </div>
              {appUrl ? (
                <iframe
                  key={previewKey}
                  src={appUrl}
                  className={s.previewFrame}
                  sandbox="allow-same-origin allow-scripts allow-forms"
                />
              ) : (
                <div className={s.empty}>
                  <div className={s.emptyTitle}>Not deployed yet</div>
                </div>
              )}
            </div>
          )}
        </main>

        <aside className={`${s.rail} ${s.railRight}`}>
          <SystemVitals vitals={vitals} />
        </aside>
      </div>

      {/* Status line doubles as the footer — always says what is happening. */}
      <footer className={s.footer}>
        <span className={s.previewUrl} style={{ fontFamily: "var(--nx-ff-sans)" }}>
          {isDone ? "Delivered" : stageMessage}
        </span>
      </footer>
    </div>
  );
}
