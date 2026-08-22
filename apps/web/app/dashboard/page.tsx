"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { dashboard as s } from "./dashboard.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Project {
  id: string;
  name: string;
  status: "building" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
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

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

/**
 * The overview. Everything on it is a real aggregate over the same rows
 * /projects lists — no separate "system" data source, no numbers invented to
 * fill a card shape.
 */
export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/projects`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setProjects(data.projects ?? []);
    } catch {
      // Keep the last-known state rather than clearing it on a blip.
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasBuilding = projects.some((p) => p.status === "building");
  useEffect(() => {
    if (!hasBuilding) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [hasBuilding, load]);

  const buildingCount = useMemo(() => projects.filter((p) => p.status === "building").length, [projects]);
  const totalCost = useMemo(
    () => projects.reduce((sum, p) => sum + Number(p.costUsd || 0), 0),
    [projects],
  );
  const totalTokens = useMemo(
    () => projects.reduce((sum, p) => sum + p.tokensIn + p.tokensOut, 0),
    [projects],
  );
  const needsApproval = useMemo(() => projects.filter((p) => p.needsApproval), [projects]);
  const recent = useMemo(() => projects.slice(0, 6), [projects]);

  return (
    <Sidebar approvalsCount={needsApproval.length}>
      <main className={s.main}>
        <header className={s.masthead}>
          <span className={s.eyebrow}>Overview</span>
          <h1 className={s.mastheadTitle}>Command center</h1>
          <p className={s.mastheadSub}>What&apos;s happening across your projects right now.</p>
        </header>

        <section className={s.stats} aria-label="Fleet totals">
          <div className={s.stat}>
            <div className={s.statValue}>{String(projects.length).padStart(2, "0")}</div>
            <div className={s.statLabel}>Total projects</div>
          </div>
          <div className={s.stat}>
            <div className={`${s.statValue} ${buildingCount > 0 ? s.statValueLive : ""}`}>
              {String(buildingCount).padStart(2, "0")}
            </div>
            <div className={s.statLabel}>Building</div>
          </div>
          <div className={s.stat}>
            <div className={`${s.statValue} ${needsApproval.length > 0 ? s.statValueWait : ""}`}>
              {String(needsApproval.length).padStart(2, "0")}
            </div>
            <div className={s.statLabel}>Needs approval</div>
          </div>
          <div className={s.stat}>
            <div className={s.statValue}>{formatTokens(totalTokens)}</div>
            <div className={s.statLabel}>Tokens used</div>
          </div>
          <div className={s.stat}>
            <div className={s.statValue}>{formatCost(totalCost)}</div>
            <div className={s.statLabel}>Total spend</div>
          </div>
        </section>

        <div className={s.columns}>
          <div className={s.panel}>
            <div className={s.panelHead}>
              <span className={s.panelHeadLabel}>Recent projects</span>
              <Link href="/projects" className={s.panelLink}>
                View all →
              </Link>
            </div>
            {fetching ? (
              <>
                <div className={s.skeletonBar} style={{ width: "70%" }} />
                <div className={s.skeletonBar} style={{ width: "55%" }} />
                <div className={s.skeletonBar} style={{ width: "62%" }} />
              </>
            ) : recent.length === 0 ? (
              <div className={s.empty}>No projects yet.</div>
            ) : (
              recent.map((p) => (
                <Link key={p.id} href={`/build/${p.id}`} className={s.row}>
                  <span
                    className={`${s.node} ${
                      p.needsApproval
                        ? s.nodeWaiting
                        : p.status === "building"
                          ? s.nodeBuilding
                          : p.status === "done"
                            ? s.nodeReady
                            : s.nodeFailed
                    }`}
                  />
                  <span className={s.rowText}>
                    <span className={s.rowName}>{p.name || "Untitled project"}</span>
                    <span className={s.rowSub}>{p.stageMessage}</span>
                  </span>
                  <span className={s.rowTime}>{relativeTime(p.updatedAt)}</span>
                </Link>
              ))
            )}
          </div>

          <div className={s.panel}>
            <div className={s.panelHead}>
              <span className={s.panelHeadLabel}>Needs your approval</span>
              <Link href="/approvals" className={s.panelLink}>
                View all →
              </Link>
            </div>
            {fetching ? (
              <div className={s.skeletonBar} style={{ width: "60%" }} />
            ) : needsApproval.length === 0 ? (
              <div className={s.empty}>Nothing waiting on you.</div>
            ) : (
              needsApproval.map((p) => (
                <Link key={p.id} href={`/build/${p.id}`} className={s.row}>
                  <span className={`${s.node} ${s.nodeWaiting}`} />
                  <span className={s.rowText}>
                    <span className={s.rowName}>{p.name || "Untitled project"}</span>
                    <span className={s.rowSub}>{p.stageMessage}</span>
                  </span>
                  <span className={s.approveBtn}>Review</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </main>
    </Sidebar>
  );
}
