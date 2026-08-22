"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import NewProjectModal from "@/components/NewProjectModal";
import { EmptyState } from "@/components/nexui/empty-state";
import { Button } from "@/components/nexui/button";
import { projects as s } from "./projects.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** Mirrors GET /api/projects's enriched response — real pipeline stage,
 * approval state and cost, not just the coarse building/done/failed status. */
interface Project {
  id: string;
  name: string;
  status: "planning" | "building" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
  appUrl?: string;
  stage: string | null;
  stageMessage: string;
  needsApproval: boolean;
  costUsd: string;
  tokensIn: number;
  tokensOut: number;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatCost(costUsd: string): string {
  const n = Number(costUsd);
  if (!n) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

export default function ProjectsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/projects`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setProjectsList(data.projects ?? []);
    } catch {
      // A refresh failing keeps the last-known list rather than clearing it.
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasBuilding = projectsList.some((p) => p.status === "building");
  useEffect(() => {
    if (!hasBuilding) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [hasBuilding, load]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const startRename = (p: Project) => {
    setConfirmingId(null);
    setRenamingId(p.id);
    setRenameValue(p.name || "");
  };

  const commitRename = useCallback(
    async (id: string) => {
      const name = renameValue.trim();
      setRenamingId(null);
      if (!name) return;
      const prev = projectsList;
      setProjectsList((cur) => cur.map((p) => (p.id === id ? { ...p, name } : p)));
      try {
        const r = await fetch(`${API}/api/projects/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!r.ok) throw new Error();
      } catch {
        setProjectsList(prev);
        setError("Couldn't rename that project.");
      }
    },
    [renameValue, projectsList],
  );

  const confirmDelete = useCallback(
    async (id: string) => {
      setConfirmingId(null);
      const prev = projectsList;
      setProjectsList((cur) => cur.filter((p) => p.id !== id));
      try {
        const r = await fetch(`${API}/api/projects/${id}`, { method: "DELETE", credentials: "include" });
        if (!r.ok) throw new Error();
      } catch {
        setProjectsList(prev);
        setError("Couldn't delete that project.");
      }
    },
    [projectsList],
  );

  const approvalsCount = projectsList.filter((p) => p.needsApproval).length;

  return (
    <Sidebar approvalsCount={approvalsCount}>
      <main className={s.main}>
        <header className={s.masthead}>
          <div>
            <span className={s.eyebrow}>All Projects</span>
            <h1 className={s.mastheadTitle}>Projects</h1>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            New project
          </Button>
        </header>

        {error && <div className={s.errorBanner}>{error}</div>}

        {fetching ? (
          <div className={s.list}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={s.row}>
                <div className={s.skeletonBar} style={{ width: `${34 - i * 6}%` }} />
              </div>
            ))}
          </div>
        ) : projectsList.length === 0 ? (
          <div className={`${s.list} ${s.emptyWrap}`}>
            <EmptyState
              title="No projects yet"
              description="Click New project above and watch it get planned, built, and reviewed end to end."
              actions={<Button onClick={() => setShowCreate(true)}>New project</Button>}
            />
          </div>
        ) : (
          <div className={s.list}>
            {projectsList.map((p) =>
              confirmingId === p.id ? (
                <div key={p.id} className={s.confirmRow}>
                  <span className={s.confirmText}>
                    Delete &ldquo;{p.name || "Untitled project"}&rdquo;? This can&apos;t be undone.
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </Button>
                  <Button variant="solid" tone="destructive" size="sm" onClick={() => confirmDelete(p.id)}>
                    Delete
                  </Button>
                </div>
              ) : (
                <div key={p.id} className={s.row}>
                  <span
                    className={`${s.rowEdge} ${
                      p.needsApproval
                        ? s.rowEdgeWait
                        : p.status === "building" || p.status === "planning"
                          ? s.rowEdgeLive
                          : p.status === "failed"
                            ? s.rowEdgeFail
                            : ""
                    }`}
                  />

                  {renamingId === p.id ? (
                    <input
                      ref={renameInputRef}
                      className={s.renameInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(p.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => commitRename(p.id)}
                    />
                  ) : (
                    <Link href={`/build/${p.id}`} className={s.link}>
                      <span
                        className={`${s.node} ${
                          p.needsApproval
                            ? s.nodeWaiting
                            : p.status === "building" || p.status === "planning"
                              ? s.nodeBuilding
                              : p.status === "done"
                                ? s.nodeReady
                                : s.nodeFailed
                        }`}
                      />
                      <span className={s.rowText}>
                        <span className={s.rowNameLine}>
                          <span className={s.rowName}>{p.name || "Untitled project"}</span>
                          <span className={s.rowId}>{p.id}</span>
                          {p.needsApproval && (
                            <span className={s.needsApprovalBadge}>Needs approval</span>
                          )}
                        </span>
                        <span className={s.rowStageMessage}>{p.stageMessage}</span>
                      </span>
                    </Link>
                  )}

                  {renamingId !== p.id && (
                    <div className={s.rowMeta}>
                      <div className={s.metaCol}>
                        <span className={s.metaColLabel}>Cost</span>
                        <span>{formatCost(p.costUsd)}</span>
                      </div>
                      <div className={s.metaCol}>
                        <span className={s.metaColLabel}>Tokens</span>
                        <span>{formatTokens(p.tokensIn + p.tokensOut)}</span>
                      </div>
                      <div className={s.metaCol}>
                        <span className={s.metaColLabel}>Started</span>
                        <span>{relativeTime(p.createdAt)}</span>
                      </div>
                      <div className={s.metaCol}>
                        <span className={s.metaColLabel}>
                          {p.status === "done" ? "Finished" : "Updated"}
                        </span>
                        <span>{relativeTime(p.updatedAt)}</span>
                      </div>
                      <div className={s.actions}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          title="Rename"
                          onClick={() => startRename(p)}
                        >
                          <PencilIcon />
                        </button>
                        <button
                          type="button"
                          className={`${s.iconBtn} ${s.iconBtnDanger}`}
                          title="Delete"
                          onClick={() => setConfirmingId(p.id)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </main>
      <NewProjectModal open={showCreate} onOpenChange={setShowCreate} />
    </Sidebar>
  );
}

function PencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 2.5 13.5 5 5 13.5 2 14l.5-3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5" />
    </svg>
  );
}
