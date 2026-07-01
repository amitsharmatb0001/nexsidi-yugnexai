"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import s from "./dashboard.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Project {
  id: string;
  name: string;
  description: string;
  status: "building" | "done" | "failed";
  createdAt: string;
  appUrl?: string;
}

const EXAMPLES = [
  "Task manager with due dates and labels",
  "Invoice generator with PDF export",
  "Team standup tracker",
  "Personal budget app",
  "Customer feedback board",
  "Habit tracker with streaks",
];

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
  const router    = useRouter();
  const taRef     = useRef<HTMLTextAreaElement>(null);
  const [request, setRequest]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/projects`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setProjects(data.projects ?? []))
      .catch(() => {})
      .finally(() => setFetching(false));
  }, []);

  const startBuild = useCallback(async () => {
    const req = request.trim();
    if (!req || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/pipeline/start`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ userRequest: req }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const { projectId } = (await res.json()) as { projectId: string };
      router.push(`/build/${projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start build");
      setLoading(false);
    }
  }, [request, loading, router]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) startBuild();
  };

  return (
    <div className={s.root}>
      <nav className={s.nav}>
        <div className={s.navBrand}>
          <div className={s.navLogo}>N</div>
          NexSidi
        </div>
        <div className={s.navRight}>
          <a href="/compare" className={s.navBtn}>
            <i className="nxi nxi-code" style={{ fontSize: 14 }} />
            Compare UI
          </a>
          <div className={s.navAvatar}>
            <i className="nxi nxi-user" style={{ fontSize: 14 }} />
          </div>
        </div>
      </nav>

      <main className={s.main}>
        <div className={s.newProjectCard}>
          <div className={s.newProjectTitle}>What are you building?</div>
          <div className={s.newProjectSub}>
            Describe your app in plain English — design, code, database, deployment are all handled.
            <span style={{ color: "var(--nx-text3)", marginLeft: 8 }}>⌘+Enter to start</span>
          </div>

          {error && (
            <div className={s.errorBanner}>
              <i className="nxi nxi-warning" style={{ fontSize: 14 }} />
              {error}
            </div>
          )}

          <div className={s.inputRow}>
            <textarea
              ref={taRef}
              className={s.textarea}
              value={request}
              onChange={e => setRequest(e.target.value)}
              onKeyDown={handleKey}
              placeholder="e.g. Build me a task manager with sign-up, due dates, and the ability to check tasks off"
              rows={3}
              disabled={loading}
            />
            <button
              className={s.buildBtn}
              onClick={startBuild}
              disabled={!request.trim() || loading}
            >
              {loading ? (
                <>
                  <span className={s.buildBtnSpin}>
                    <i className="nxi nxi-refresh" style={{ fontSize: 14 }} />
                  </span>
                  Building…
                </>
              ) : (
                <>
                  Build
                  <i className="nxi nxi-arrow-r" style={{ fontSize: 14 }} />
                </>
              )}
            </button>
          </div>

          <div className={s.examples}>
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                className={s.exampleChip}
                onClick={() => { setRequest(ex); taRef.current?.focus(); }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className={s.sectionTitle}>Your Projects</div>
        <div className={s.projectGrid}>
          {fetching ? (
            [0,1,2].map(i => (
              <div key={i} className={s.projectCard} style={{ cursor:"default", opacity:0.4 }}>
                <div className={s.projectIcon}>
                  <i className="nxi nxi-folder" style={{ fontSize:16 }} />
                </div>
                <div className={s.projectMeta}>
                  <div className={s.projectName} style={{ background:"var(--nx-bg-muted)", width:"40%", height:14, borderRadius:"var(--nx-r-sm)", marginBottom:6 }} />
                  <div style={{ background:"var(--nx-bg-muted)", width:"70%", height:10, borderRadius:"var(--nx-r-sm)" }} />
                </div>
              </div>
            ))
          ) : projects.length === 0 ? (
            <div className={s.empty}>
              No projects yet — describe your first app above.
            </div>
          ) : (
            projects.map((p, i) => (
              <Link
                key={p.id}
                href={`/build/${p.id}`}
                className={s.projectCard}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className={s.projectIcon}>
                  <i className="nxi nxi-folder" style={{ fontSize:16 }} />
                </div>
                <div className={s.projectMeta}>
                  <div className={s.projectName}>{p.name || "Untitled Project"}</div>
                  <div className={s.projectDesc}>{p.description}</div>
                </div>
                <div className={s.projectStatus}>
                  <span className={`${s.statusDot} ${s[p.status as keyof typeof s]}`} />
                  <span className={s.statusLabel}>
                    {p.status === "building" ? "Building" : p.status === "done" ? "Complete" : "Failed"}
                  </span>
                </div>
                <div className={s.projectTime}>{relativeTime(p.createdAt)}</div>
              </Link>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
