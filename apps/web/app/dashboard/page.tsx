"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import YugnexLogo from "../../components/ide/YugnexLogo";
import AmbientField from "../../components/effects/AmbientField";
import AccountMenu from "../../components/AccountMenu";
import { dashboard as s } from "./dashboard.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Project {
  id: string;
  name: string;
  description: string;
  status: "building" | "done" | "failed";
  createdAt: string;
  appUrl?: string;
}

function statusDotClass(status: Project["status"]): string {
  if (status === "done") return s.statusDotDone;
  if (status === "building") return s.statusDotBuilding;
  return s.statusDotFailed;
}

function statusLabel(status: Project["status"]): string {
  return status === "building" ? "Building" : status === "done" ? "Ready" : "Failed";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/projects`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setProjects(data.projects ?? []);
    } catch {
      // A refresh failing keeps the last-known list rather than clearing it.
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  // Live-ish tracking: while anything is building, refresh the list every
  // few seconds so status/progress across multiple in-flight projects is
  // visible without a manual reload. Idle otherwise — no point polling a
  // dashboard where nothing is changing.
  const hasBuilding = projects.some((p) => p.status === "building");
  useEffect(() => {
    if (!hasBuilding) return;
    const t = setInterval(() => void loadProjects(), 4000);
    return () => clearInterval(t);
  }, [hasBuilding, loadProjects]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const newProject = useCallback(() => {
    if (creating) return;
    setCreating(true);
    // Describing the app happens in the project's own planning chat, not on
    // the dashboard — this just opens a fresh one.
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    router.push(`/build/${id}`);
  }, [creating, router]);

  const startRename = (p: Project) => {
    setConfirmingId(null);
    setRenamingId(p.id);
    setRenameValue(p.name || "");
  };

  const commitRename = useCallback(async (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    const prev = projects;
    setProjects((cur) => cur.map((p) => (p.id === id ? { ...p, name } : p)));
    try {
      const r = await fetch(`${API}/api/projects/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setProjects(prev); // roll back an optimistic update the server rejected
      setError("Couldn't rename that project.");
    }
  }, [renameValue, projects]);

  const confirmDelete = useCallback(async (id: string) => {
    setConfirmingId(null);
    const prev = projects;
    setProjects((cur) => cur.filter((p) => p.id !== id));
    try {
      const r = await fetch(`${API}/api/projects/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error();
    } catch {
      setProjects(prev);
      setError("Couldn't delete that project.");
    }
  }, [projects]);

  return (
    <div className={s.root}>
      <AmbientField />
      <nav className={s.nav}>
        <div className={s.navBrand}>
          <span className={s.navLogo}><YugnexLogo size={19} /></span>
          YugNex
        </div>
        <div className={s.navRight}>
          <AccountMenu />
        </div>
      </nav>

      <main className={s.main}>
        {error && <div className={s.errorBanner}>{error}</div>}

        <section>
          <div className={s.sectionHead}>
            <div className={s.sectionTitleGroup}>
              <span className={s.sectionTitle}>Projects</span>
              <span className={s.sectionCount}>{projects.length}</span>
              {hasBuilding && (
                <span className={s.liveTicker}>
                  <span className={s.liveDot} />
                  {projects.filter((p) => p.status === "building").length} building
                </span>
              )}
            </div>
            <button type="button" className={s.newBtn} onClick={newProject} disabled={creating}>
              + New project
            </button>
          </div>

          <div className={s.projectGrid}>
            {fetching ? (
              [0, 1, 2].map((i) => (
                <div key={i} className={s.projectRow} style={{ opacity: 0.35 }}>
                  <div className={s.projectMeta}>
                    <div className={s.skeleton} style={{ width: "34%" }} />
                  </div>
                </div>
              ))
            ) : projects.length === 0 ? (
              <div className={s.empty}>No projects yet — start one above.</div>
            ) : (
              projects.map((p) =>
                confirmingId === p.id ? (
                  <div key={p.id} className={s.confirmRow}>
                    <span className={s.confirmText}>Delete &ldquo;{p.name || "Untitled project"}&rdquo;? This can&apos;t be undone.</span>
                    <button type="button" className={s.cancelBtn} onClick={() => setConfirmingId(null)}>Cancel</button>
                    <button type="button" className={s.confirmBtn} onClick={() => confirmDelete(p.id)}>Delete</button>
                  </div>
                ) : (
                  <div key={p.id} className={s.projectRow}>
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
                      <Link href={`/build/${p.id}`} className={s.projectLink}>
                        <div className={s.projectMeta}>
                          <div className={s.projectName}>{p.name || "Untitled project"}</div>
                          {p.description && <div className={s.projectDesc}>{p.description}</div>}
                        </div>
                        <div className={s.projectStatus}>
                          <span className={statusDotClass(p.status)} />
                          {statusLabel(p.status)}
                        </div>
                        <div className={s.projectTime}>{relativeTime(p.createdAt)}</div>
                      </Link>
                    )}

                    {renamingId !== p.id && (
                      <div className={s.rowActions}>
                        <button type="button" className={s.iconBtn} title="Rename" onClick={() => startRename(p)}>
                          <PencilIcon />
                        </button>
                        <button type="button" className={`${s.iconBtn} ${s.iconBtnDanger}`} title="Delete" onClick={() => setConfirmingId(p.id)}>
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </div>
                ),
              )
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 2.5 13.5 5 5 13.5 2 14l.5-3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5" />
    </svg>
  );
}
