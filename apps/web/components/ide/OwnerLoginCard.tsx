"use client";

// The staff sign-in of a delivered app (2026-11-02). The system sets and proves it at delivery; only the project's owner can read it.
import { useEffect, useState } from "react";
import { API } from "../../lib/live";
import { ws as s } from "./IdeWorkspace.styles";

interface Login {
  role: string;
  email: string;
  password: string;
}

export default function OwnerLoginCard({ projectId }: { projectId: string }) {
  const [logins, setLogins] = useState<Login[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/pipeline/${projectId}/owner-login`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { logins: [] }))
      .then((b: { logins?: Login[] }) => {
        if (!cancelled) setLogins(b.logins ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (logins.length === 0) return null;
  return (
    <div style={{ position: "relative" }}>
      <button type="button" className={s.openBtn} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Staff sign-in
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, minWidth: 280, padding: 12, borderRadius: 8, background: "var(--nx-color-card, #1a1d24)", border: "1px solid var(--nx-color-border, #333)", fontSize: 12, lineHeight: 1.6 }}>
          <div>Use this to sign in to your app. Keep it private.</div>
          {logins.map((l) => (
            <div key={l.role} style={{ marginTop: 8, overflowWrap: "anywhere" }}>
              <div>Email: <code>{l.email}</code></div>
              <div>Password: <code>{l.password}</code></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
