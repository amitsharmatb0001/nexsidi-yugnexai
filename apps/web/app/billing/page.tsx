"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { css, themeVars as theme } from "@yugnex/core";
import { eyebrow, ground, readout } from "@/lib/design";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Project {
  id: string;
  name: string;
  costUsd: string;
  tokensIn: number;
  tokensOut: number;
}

const main = css({ maxWidth: "760px", margin: "0 auto", padding: `${theme.space[8]} ${theme.space[5]} ${theme.space[16]}` });
const title = css({
  margin: 0,
  fontFamily: "var(--nx-font-family-display)",
  fontSize: "28px",
  fontWeight: theme.fontWeight.bold,
  letterSpacing: "-0.025em",
  color: theme.color.foreground,
});
const totalWrap = css({
  marginTop: theme.space[5],
  marginBottom: theme.space[6],
  padding: theme.space[5],
  border: `1px solid ${ground.seam}`,
  borderRadius: theme.radius.md,
  backgroundColor: ground.panel,
});
const totalValue = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: "36px",
  fontWeight: theme.fontWeight.medium,
  letterSpacing: theme.letterSpacing.tight,
  color: theme.color.foreground,
});
const totalLabel = css({ marginTop: theme.space[1], fontSize: theme.fontSize.sm, color: theme.color.mutedForeground });
const list = css({
  border: `1px solid ${ground.seam}`,
  borderRadius: theme.radius.md,
  backgroundColor: ground.panel,
  overflow: "hidden",
});
const row = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: theme.space[3],
  padding: `${theme.space[3]} ${theme.space[4]}`,
  borderTop: `1px solid ${ground.seam}`,
  "&:first-of-type": { borderTop: "none" },
});
const rowName = css({ fontSize: theme.fontSize.sm, color: theme.color.foreground, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

/** Per-project cost breakdown, summed from the same token_spend rows the
 * dashboard's total-spend card reads — one source of truth, two views. */
export default function BillingPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/projects`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setProjects(data.projects ?? []);
    } catch {
      // keep last-known state
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => projects.reduce((sum, p) => sum + Number(p.costUsd || 0), 0), [projects]);
  const ranked = useMemo(
    () => [...projects].sort((a, b) => Number(b.costUsd || 0) - Number(a.costUsd || 0)),
    [projects],
  );

  return (
    <Sidebar>
      <main className={main}>
        <span className={eyebrow}>Billing</span>
        <h1 className={title}>Usage</h1>

        <div className={totalWrap}>
          <div className={totalValue}>${total.toFixed(2)}</div>
          <div className={totalLabel}>Total spend across all projects</div>
        </div>

        {!fetching && ranked.length > 0 && (
          <div className={list}>
            {ranked.map((p) => (
              <div key={p.id} className={row}>
                <span className={rowName}>{p.name || "Untitled project"}</span>
                <span className={readout} style={{ fontSize: 12 }}>
                  ${Number(p.costUsd || 0).toFixed(2)} · {formatTokens(p.tokensIn + p.tokensOut)} tok
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </Sidebar>
  );
}
