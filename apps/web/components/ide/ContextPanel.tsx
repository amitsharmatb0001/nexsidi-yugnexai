"use client";

// The project's own reference material — what it's built from, added at
// creation and editable afterward — real and persisted (PATCH
// /api/projects/:id, the `context` column added in migration 0009), kept
// separate from every other project's context and from the ephemeral
// planning chat log. File upload is a real, named gap: there is no storage
// backing it yet, so it stays behind a "Soon" tag rather than pretending to
// work — the same pattern already used for Language/Notifications in
// AccountMenu, applied here too.
import { useCallback, useEffect, useState } from "react";
import { Textarea } from "@/components/nexui/textarea";
import { Button } from "@/components/nexui/button";
import { IconAttach } from "./IdeIcons";
import { ws as s } from "./IdeWorkspace.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default function ContextPanel({ projectId }: { projectId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/projects/${projectId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const context = typeof data.context === "string" ? data.context : "";
        setValue(context);
        setSaved(context);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  const dirty = value !== null && value !== saved;

  const save = useCallback(async () => {
    if (value === null || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/projects/${projectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: value }),
      });
      if (!r.ok) throw new Error();
      setSaved(value);
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }, [projectId, value, dirty]);

  if (value === null) {
    return <div className={s.tileEmpty}>Loading…</div>;
  }

  return (
    <div className={s.contextPanelBody}>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add anything the AI should know about this project — background, constraints, decisions already made. Starts empty; nothing here is required."
        rows={6}
        maxLength={8000}
      />
      <div className={s.contextPanelRow}>
        <button type="button" className={s.contextPanelUpload} disabled aria-disabled="true">
          <IconAttach size={12} />
          Add files
          <span className={s.contextPanelSoon}>Soon</span>
        </button>
        <div className={s.contextPanelSpacer} />
        {error && <span className={s.contextPanelError}>{error}</span>}
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
