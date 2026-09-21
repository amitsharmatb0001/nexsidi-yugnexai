"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { clone as s } from "./clone.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface DoneProject {
  id: string;
  name: string;
  status: string;
}

type Mode = "auto" | "manual";

interface CloneResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export default function ClonePage() {
  const [doneProjects, setDoneProjects] = useState<DoneProject[]>([]);
  const [mode, setMode] = useState<Mode>("auto");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [changes, setChanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<CloneResult | null>(null);

  useEffect(() => {
    fetch(`${API}/api/projects`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((data) => {
        const done = (data.projects ?? []).filter((p: DoneProject) => p.status === "done");
        setDoneProjects(done);
        if (done.length > 0) setSourceId(done[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setElapsed(0);
    setResult(null);

    const path = mode === "auto" ? "auto" : sourceId;
    const body: Record<string, string> = { name, changes };
    if (mode === "auto") body.description = description;

    try {
      const r = await fetch(`${API}/api/projects/${path}/clone`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await r.json().catch(() => ({}));
      setResult({ ok: r.ok, status: r.status, body: responseBody });
    } catch (err) {
      setResult({ ok: false, status: 0, body: { error: "network_error", message: err instanceof Error ? err.message : String(err) } });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = name.trim().length > 0 && changes.trim().length > 0 && (mode === "auto" ? description.trim().length > 0 : sourceId.length > 0) && !busy;

  return (
    <Sidebar>
      <main className={s.main}>
        <header className={s.masthead}>
          <span className={s.eyebrow}>Clone a project</span>
          <h1 className={s.title}>Clone with changes</h1>
          <p className={s.sub}>
            Copies one of your delivered projects and applies your requested changes —
            content, a new page, a new backend feature, color — before deploying it as
            a new project. Runs for real; expect this to take several minutes.
          </p>
        </header>

        <form className={s.form} onSubmit={submit}>
          <div className={s.field}>
            <label className={s.label} htmlFor="name">New project name</label>
            <input
              id="name"
              className={s.input}
              placeholder="e.g. Ferro & Wade Advisory"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
            />
          </div>

          <div className={s.field}>
            <span className={s.label}>Which project to clone from</span>
            <div className={s.modeRow}>
              <button
                type="button"
                className={`${s.modeBtn} ${mode === "auto" ? s.modeBtnActive : ""}`}
                onClick={() => setMode("auto")}
                disabled={busy}
              >
                Let the system decide
              </button>
              <button
                type="button"
                className={`${s.modeBtn} ${mode === "manual" ? s.modeBtnActive : ""}`}
                onClick={() => setMode("manual")}
                disabled={busy}
              >
                I'll pick one
              </button>
            </div>
          </div>

          {mode === "auto" ? (
            <div className={s.field}>
              <label className={s.label} htmlFor="description">Describe the new project</label>
              <textarea
                id="description"
                className={s.textarea}
                placeholder="e.g. A boutique creative agency site — who we are, what we make, a way to reach out."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
              <span className={s.hint}>
                The system picks the closest structural match from your own delivered
                projects — you won't see which one until it responds.
              </span>
            </div>
          ) : (
            <div className={s.field}>
              <label className={s.label} htmlFor="source">Source project</label>
              {doneProjects.length === 0 ? (
                <span className={s.hint}>No delivered projects to clone from yet.</span>
              ) : (
                <select
                  id="source"
                  className={s.select}
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  disabled={busy}
                >
                  {doneProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name || p.id}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className={s.field}>
            <label className={s.label} htmlFor="changes">What should change</label>
            <textarea
              id="changes"
              className={s.textarea}
              placeholder="e.g. Remove the least essential service. Add a private client portal with a project-status table only the owning user can see. Add a public Insights page. Change the accent color to a deep plum."
              value={changes}
              onChange={(e) => setChanges(e.target.value)}
              disabled={busy}
              style={{ minHeight: "140px" }}
            />
          </div>

          <button type="submit" className={s.submit} disabled={!canSubmit}>
            {busy ? `Working… ${elapsed}s` : "Clone it"}
          </button>
        </form>

        {(busy || result) && (
          <section className={s.statusPanel}>
            {busy && (
              <div className={s.statusRow}>
                <span className={s.spinner} />
                <span>Cloning, planning, building, and deploying — this runs for real, usually several minutes.</span>
              </div>
            )}

            {result && (
              <>
                <div className={s.statusRow}>
                  <span className={result.ok ? s.ok : s.fail}>
                    {result.ok ? "✓ Delivered" : `✗ ${String(result.body.error ?? "Failed")}`}
                  </span>
                </div>

                {typeof result.body.clonedFromName === "string" && (
                  <p className={s.resultLine}>
                    <span className={s.resultLabel}>Cloned from</span>
                    {result.body.clonedFromName}
                  </p>
                )}
                {typeof result.body.sourcePickReasoning === "string" && (
                  <p className={s.resultLine}>
                    <span className={s.resultLabel}>Why</span>
                    {result.body.sourcePickReasoning}
                  </p>
                )}
                {typeof result.body.appUrl === "string" && (
                  <p className={s.resultLine}>
                    <span className={s.resultLabel}>Live at</span>
                    <a className={s.link} href={result.body.appUrl} target="_blank" rel="noreferrer">{result.body.appUrl}</a>
                  </p>
                )}
                {typeof result.body.backendSummary === "string" && (
                  <p className={s.resultLine}>
                    <span className={s.resultLabel}>Backend</span>
                    {result.body.backendSummary}
                  </p>
                )}
                {typeof result.body.changesSummary === "string" && (
                  <p className={s.resultLine}>
                    <span className={s.resultLabel}>Frontend</span>
                    {result.body.changesSummary}
                  </p>
                )}
                {typeof result.body.message === "string" && (
                  <p className={s.resultLine}>
                    <span className={s.resultLabel}>Details</span>
                    {result.body.message}
                  </p>
                )}

                <pre className={s.pre}>{JSON.stringify(result.body, null, 2)}</pre>
              </>
            )}
          </section>
        )}
      </main>
    </Sidebar>
  );
}
