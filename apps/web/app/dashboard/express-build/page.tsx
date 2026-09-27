"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { expressBuild as s } from "./express-build.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface DoneProject {
  id: string;
  name: string;
  status: string;
}

type Mode = "auto" | "manual";

interface ExpressBuildResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export default function ExpressBuildPage() {
  const [doneProjects, setDoneProjects] = useState<DoneProject[]>([]);
  const [mode, setMode] = useState<Mode>("auto");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basedOn, setBasedOn] = useState("");
  const [changes, setChanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ExpressBuildResult | null>(null);

  useEffect(() => {
    fetch(`${API}/api/projects`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((data) => {
        const done = (data.projects ?? []).filter((p: DoneProject) => p.status === "done");
        setDoneProjects(done);
        if (done.length > 0) setBasedOn(done[0].id);
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

    const body: Record<string, string> = { name, changes };
    if (mode === "auto") body.description = description;
    else body.basedOn = basedOn;

    try {
      const r = await fetch(`${API}/api/projects/express-build`, {
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

  const canSubmit = name.trim().length > 0 && changes.trim().length > 0 && (mode === "auto" ? description.trim().length > 0 : basedOn.length > 0) && !busy;

  return (
    <Sidebar>
      <main className={s.main}>
        <header className={s.masthead}>
          <span className={s.eyebrow}>Express Build</span>
          <h1 className={s.title}>Your site, built in minutes</h1>
          <p className={s.sub}>
            Name it, describe it, say what you want — content, a new page, a new
            feature, colors. Express Build sets it up, applies your changes and
            deploys it as a new project. Usually a few minutes.
          </p>
        </header>

        <form className={s.form} onSubmit={submit}>
          <div className={s.field}>
            <label className={s.label} htmlFor="name">Project name</label>
            <input
              id="name"
              className={s.input}
              placeholder="e.g. Harbor & Pine Studio"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
            />
          </div>

          <div className={s.field}>
            <span className={s.label}>Starting point</span>
            <div className={s.modeRow}>
              <button
                type="button"
                className={`${s.modeBtn} ${mode === "auto" ? s.modeBtnActive : ""}`}
                onClick={() => setMode("auto")}
                disabled={busy}
              >
                Automatic
              </button>
              <button
                type="button"
                className={`${s.modeBtn} ${mode === "manual" ? s.modeBtnActive : ""}`}
                onClick={() => setMode("manual")}
                disabled={busy}
              >
                Choose from my projects
              </button>
            </div>
          </div>

          {mode === "auto" ? (
            <div className={s.field}>
              <label className={s.label} htmlFor="description">Describe the site</label>
              <textarea
                id="description"
                className={s.textarea}
                placeholder="e.g. A boutique creative agency site — who we are, what we make, a way to reach out."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
              <span className={s.hint}>Express Build chooses the best starting point automatically.</span>
            </div>
          ) : (
            <div className={s.field}>
              <label className={s.label} htmlFor="basedOn">Project</label>
              {doneProjects.length === 0 ? (
                <span className={s.hint}>No finished projects yet.</span>
              ) : (
                <select
                  id="basedOn"
                  className={s.select}
                  value={basedOn}
                  onChange={(e) => setBasedOn(e.target.value)}
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
            <label className={s.label} htmlFor="changes">What you want</label>
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
            {busy ? `Working… ${elapsed}s` : "Start Express Build"}
          </button>
        </form>

        {(busy || result) && (
          <section className={s.statusPanel}>
            {busy && (
              <div className={s.statusRow}>
                <span className={s.spinner} />
                <span>Building and deploying your new project — usually a few minutes.</span>
              </div>
            )}

            {result && (
              <>
                <div className={s.statusRow}>
                  <span className={result.ok ? s.ok : s.fail}>
                    {result.ok ? "✓ Delivered" : `✗ ${String(result.body.error ?? "Failed")}`}
                  </span>
                </div>

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
