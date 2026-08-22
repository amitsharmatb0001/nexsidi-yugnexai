"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { EmptyState } from "@/components/nexui/empty-state";
import { css, themeVars as theme } from "@yugnex/core";
import { eyebrow, ground, signal } from "@/lib/design";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Project {
  id: string;
  name: string;
  status: "building" | "done" | "failed";
  stageMessage: string;
  needsApproval: boolean;
}

const main = css({ maxWidth: "760px", margin: "0 auto", padding: `${theme.space[8]} ${theme.space[5]} ${theme.space[16]}` });
const title = css({
  margin: 0,
  fontFamily: "var(--nx-font-family-display)",
  fontSize: "28px",
  fontWeight: theme.fontWeight.bold,
  letterSpacing: "-0.025em",
  color: theme.color.foreground,
  marginBottom: theme.space[6],
});
const list = css({
  border: `1px solid ${ground.seam}`,
  borderRadius: theme.radius.md,
  backgroundColor: ground.panel,
  overflow: "hidden",
});
const row = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  padding: `${theme.space[3]} ${theme.space[4]}`,
  borderTop: `1px solid ${ground.seam}`,
  textDecoration: "none",
  color: "inherit",
  "&:first-of-type": { borderTop: "none" },
  "&:hover": { backgroundColor: ground.raised },
});
const rowText = css({ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" });
const rowName = css({ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, color: theme.color.foreground });
const rowSub = css({ fontSize: "12px", color: theme.color.mutedForeground });
const approveBtn = css({
  flexShrink: 0,
  padding: `${theme.space[1.5]} ${theme.space[3]}`,
  borderRadius: theme.radius.full,
  border: `1px solid ${signal.humanEdge}`,
  backgroundColor: signal.humanDim,
  color: signal.humanBright,
  fontSize: "12px",
  fontWeight: theme.fontWeight.medium,
});

/**
 * Every project currently paused waiting on you — spec approval or deploy
 * approval, the two real gates the pipeline has. The reference this screen
 * was drawn from showed per-file, per-command approvals ("Write File
 * src/services/auth.service.ts") attributed to named agents; that granularity
 * doesn't exist in this pipeline (its gates are project-level, not
 * file-level), so this page reflects what's actually real instead of
 * reproducing the mockup's invented detail.
 */
export default function ApprovalsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/projects`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setProjects(data.projects ?? []);
    } catch {
      // Keep the last-known list on a transient failure.
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const waiting = useMemo(() => projects.filter((p) => p.needsApproval), [projects]);

  return (
    <Sidebar approvalsCount={waiting.length}>
      <main className={main}>
        <div>
          <span className={eyebrow}>Approvals</span>
          <h1 className={title}>Needs your approval</h1>
        </div>

        {fetching ? null : waiting.length === 0 ? (
          <div className={list}>
            <div style={{ padding: `${theme.space[10]}px 0` }}>
              <EmptyState title="Nothing waiting on you" description="Projects that need a plan or deploy approval will show up here." />
            </div>
          </div>
        ) : (
          <div className={list}>
            {waiting.map((p) => (
              <Link key={p.id} href={`/build/${p.id}`} className={row}>
                <div className={rowText}>
                  <span className={rowName}>{p.name || "Untitled project"}</span>
                  <span className={rowSub}>{p.stageMessage}</span>
                </div>
                <span className={approveBtn}>Review</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </Sidebar>
  );
}
