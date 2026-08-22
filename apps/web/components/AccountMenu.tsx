"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { account as s } from "./AccountMenu.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Account {
  id: string;
  email: string;
  name: string;
}

function initials(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * The account entry point every authenticated page shares — the sidebar
 * shell and the IDE title bar both mount this rather than each rolling their
 * own copy, and each screen's separate bell/help icons and the dashboard's
 * standalone profile card have folded into this one menu instead.
 *
 * Settings and Sign out are real. Help links to a real page. Language and
 * Notifications are listed because the redesign calls for them, but nothing
 * on the backend produces a language preference or a notification feed yet —
 * they render disabled with a "Soon" tag rather than pretend to work, since a
 * control that looks live but silently does nothing is worse than one that's
 * honestly not there yet.
 */
export default function AccountMenu() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`${API}/api/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setAccount(data.user ?? null))
      .catch(() => router.push("/sign-in"));
  }, [router]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const signOut = useCallback(async () => {
    await fetch(`${API}/api/auth/sign-out`, { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/sign-in");
  }, [router]);

  if (!account) return null;

  return (
    <div className={s.root} ref={ref}>
      <button
        type="button"
        className={s.btn}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={s.avatar}>{initials(account.name || account.email)}</span>
        <span className={s.name}>{account.name || account.email}</span>
      </button>
      {open && (
        <div className={s.menu} role="menu">
          <div className={s.menuEmail}>{account.email}</div>

          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            onClick={() => {
              setOpen(false);
              router.push("/settings");
            }}
          >
            Settings
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            onClick={() => {
              setOpen(false);
              router.push("/help");
            }}
          >
            Help
          </button>

          <button
            type="button"
            role="menuitem"
            aria-disabled="true"
            className={`${s.menuItem} ${s.menuItemDisabled}`}
          >
            Language
            <span className={s.menuItemSoon}>Soon</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-disabled="true"
            className={`${s.menuItem} ${s.menuItemDisabled}`}
          >
            Notifications
            <span className={s.menuItemSoon}>Soon</span>
          </button>

          <div className={s.menuSep} />

          <button
            type="button"
            role="menuitem"
            className={`${s.menuItem} ${s.menuItemAlert}`}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
