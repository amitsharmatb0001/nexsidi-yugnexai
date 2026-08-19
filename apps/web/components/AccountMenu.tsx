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
 * The account entry point every authenticated page shares — dashboard nav
 * and IDE title bar both mount this rather than each rolling their own copy.
 * Redirects to /sign-in on an unauthenticated response, the same guard the
 * dashboard already had, now applied uniformly instead of only there.
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
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const signOut = useCallback(async () => {
    await fetch(`${API}/api/auth/sign-out`, { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/sign-in");
  }, [router]);

  if (!account) return null;

  return (
    <div className={s.root} ref={ref}>
      <button type="button" className={s.btn} onClick={() => setOpen((v) => !v)}>
        <span className={s.avatar}>{initials(account.name || account.email)}</span>
        <span className={s.name}>{account.name || account.email}</span>
      </button>
      {open && (
        <div className={s.menu}>
          <div className={s.menuEmail}>{account.email}</div>
          <button type="button" className={`${s.menuItem} ${s.menuItemAlert}`} onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
