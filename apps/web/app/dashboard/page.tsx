"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import YugnexLogo from "../../components/ide/YugnexLogo";
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
  "Company website for my IT services startup with services, about, and contact pages",
  "SaaS dashboard for a project management tool with team roles and task tracking",
  "E-commerce storefront with product catalog, cart, and checkout",
  "Client portal for a consulting firm — clients log in to view deliverables",
  "Internal tool for tracking sales leads with pipeline stages and notes",
  "Restaurant website with menu, reservations, and location pages",
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
      // Generate a session ID that will also serve as the project ID
      const sessionId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      // Navigate to the build page — it will send the first message on load
      router.push(`/build/${sessionId}?q=${encodeURIComponent(req)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
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
          <span className={s.navLogo}><YugnexLogo size={19} /></span>
          YugNex
        </div>
        <div className={s.navRight}>
          <div className={s.navAvatar}>
            <i className="nxi nxi-user" style={{ fontSize: 13 }} />
          </div>
        </div>
      </nav>

      <main className={s.main}>
        <div className={s.newProjectCard}>
          <h1 className={s.newProjectTitle}>What are you building?</h1>
          <p className={s.newProjectSub}>
            Describe it in plain English. Design, code, database and deployment are all handled.
          </p>

          {error && <div className={s.errorBanner}>{error}</div>}

          <div className={s.inputRow}>
            <textarea
              ref={taRef}
              className={s.textarea}
              value={request}
              onChange={e => setRequest(e.target.value)}
              onKeyDown={handleKey}
              placeholder="A client portal for a consulting firm — clients log in to view deliverables, leave comments, and download invoices."
              rows={3}
              disabled={loading}
            />
            <div className={s.inputActions}>
              <span className={s.inputHint}>
                <span className={s.kbd}>⌘ Enter</span> to start
              </span>
              <button
                type="button"
                className={s.buildBtn}
                onClick={startBuild}
                disabled={!request.trim() || loading}
              >
                {loading ? "Starting…" : "Build"}
              </button>
            </div>
          </div>

          <div className={s.examples}>
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                type="button"
                className={s.exampleChip}
                onClick={() => { setRequest(ex); taRef.current?.focus(); }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <section>
          <div className={s.sectionTitle}>Your projects</div>
          <div className={s.projectGrid}>
            {fetching ? (
              [0, 1, 2].map(i => (
                <div key={i} className={s.projectCard} style={{ cursor: "default", opacity: 0.35 }}>
                  <div className={s.projectMeta}>
                    <div className={s.skeleton} style={{ width: "34%" }} />
                  </div>
                </div>
              ))
            ) : projects.length === 0 ? (
              <div className={s.empty}>No projects yet — describe your first one above.</div>
            ) : (
              projects.map((p, i) => (
                <Link
                  key={p.id}
                  href={`/build/${p.id}`}
                  className={s.projectCard}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className={s.projectMeta}>
                    <div className={s.projectName}>{p.name || "Untitled project"}</div>
                    {p.description && <div className={s.projectDesc}>{p.description}</div>}
                  </div>
                  <div className={`${s.projectStatus} ${s[p.status as keyof typeof s] ?? ""}`}>
                    <span className={s.statusDot} />
                    {p.status === "building" ? "Building" : p.status === "done" ? "Ready" : "Failed"}
                  </div>
                  <div className={s.projectTime}>{relativeTime(p.createdAt)}</div>
                </Link>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
