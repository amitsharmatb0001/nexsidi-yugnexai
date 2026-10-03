"use client";

// The planner's research, shown the way Claude Code shows tool work (Amit,
// 3 Oct 2026, run 4): live steps while it runs ("Searching: …" with a tick
// when done), then one collapsed line — "Researched your product · 8
// searches · 55 sources" — that opens to the notes and the sources by site
// name. Before, the whole research landed at the end as one wall of raw
// markdown with long Google redirect links.
import { useState } from "react";
import { PlanDocument } from "@/components/nexui/plan-document";
import { ThinkingIndicator } from "@/components/nexui/thinking-indicator";

export interface ResearchNotes {
  notes: string;
  sources: Array<{ title: string; url: string }>;
  queries: string[];
}

export interface ResearchStep {
  query: string;
  state: "running" | "done" | "failed";
  sources?: number;
}

/** A source's label: its site name, never the long redirect link. */
export function sourceLabel(source: { title: string; url: string }): string {
  const title = source.title?.trim();
  if (title) return title.replace(/^www\./, "");
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

/** The distinct sites the research used, in first-seen order. */
export function distinctSources(sources: ResearchNotes["sources"]): Array<{ label: string; url: string }> {
  const seen = new Map<string, string>();
  for (const s of sources) {
    const label = sourceLabel(s);
    if (!seen.has(label)) seen.set(label, s.url);
  }
  return [...seen].map(([label, url]) => ({ label, url }));
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--nx-text2)" };
const card: React.CSSProperties = { border: "1px solid var(--nx-border, rgba(255,255,255,0.08))", borderRadius: 10, padding: "10px 12px", background: "var(--nx-surface, rgba(255,255,255,0.02))" };

function Steps({ steps }: { steps: ResearchStep[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ ...row, fontSize: 12 }}>
          <span aria-hidden style={{ width: 14, textAlign: "center", color: s.state === "failed" ? "var(--nx-red, #F85149)" : s.state === "done" ? "var(--nx-green, #3FB950)" : "var(--nx-text3)" }}>
            {s.state === "done" ? "✓" : s.state === "failed" ? "✕" : "•"}
          </span>
          <span style={{ color: "var(--nx-text3)" }}>{s.state === "running" ? "Searching" : "Searched"}</span>
          <span style={{ color: "var(--nx-text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.query}</span>
          {s.state === "done" && typeof s.sources === "number" && (
            <span style={{ color: "var(--nx-text3)", flexShrink: 0 }}>· {s.sources} sources</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Live: shown while the research runs. */
export function ResearchLive({ steps }: { steps: ResearchStep[] }) {
  return (
    <div style={card}>
      <ThinkingIndicator label={steps.length ? "Researching your product" : "Planning the research"} />
      {steps.length > 0 && <Steps steps={steps} />}
    </div>
  );
}

/** Done: one collapsed line that opens to the notes and sources. */
export function ResearchCard({ research }: { research: ResearchNotes }) {
  const [open, setOpen] = useState(false);
  const sites = distinctSources(research.sources);
  return (
    <div style={card}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ ...row, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
      >
        <span aria-hidden style={{ color: "var(--nx-green, #3FB950)" }}>✓</span>
        <span style={{ color: "var(--nx-text)", fontWeight: 600 }}>Researched your product</span>
        <span style={{ color: "var(--nx-text3)" }}>
          · {research.queries.length} searches · {sites.length} sources
        </span>
        <span aria-hidden style={{ marginLeft: "auto", color: "var(--nx-text3)", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>›</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <Steps steps={research.queries.map((q) => ({ query: q, state: "done" }))} />
          {research.notes && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <PlanDocument source={research.notes} />
            </div>
          )}
          {sites.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {sites.map((s) => (
                <a
                  key={s.label}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--nx-border, rgba(255,255,255,0.1))", color: "var(--nx-text2)", textDecoration: "none" }}
                >
                  {s.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
