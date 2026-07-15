"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import s from "./auth.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signingUp = mode === "sign-up";

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/api/auth/${mode}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!response.ok) throw new Error(signingUp ? "We could not create that account. Try a different email or a stronger password." : "Email or password is incorrect.");
      router.push("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong. Please try again."); } finally { setBusy(false); }
  }

  return <main className={s.page}><Link href="/" className={s.brand}><span>N</span>NexSidi</Link><section className={s.card}><p className={s.eyebrow}>{signingUp ? "CREATE YOUR WORKSPACE" : "WELCOME BACK"}</p><h1>{signingUp ? "Build what’s next." : "Pick up where you left off."}</h1><p className={s.intro}>{signingUp ? "One account for every project you create." : "Sign in to manage your projects and launches."}</p><form onSubmit={submit}><label>Email address<input type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete={signingUp ? "new-password" : "current-password"} minLength={12} placeholder="At least 12 characters" required value={password} onChange={e => setPassword(e.target.value)} /></label>{signingUp && <p className={s.hint}>Use at least 12 characters. We securely hash your password before storing it.</p>}{error && <p className={s.error} role="alert">{error}</p>}<button className={s.submit} disabled={busy}>{busy ? "Please wait…" : signingUp ? "Create account" : "Sign in"}<span>→</span></button></form><p className={s.switch}>{signingUp ? "Already have an account?" : "New to NexSidi?"} <Link href={signingUp ? "/sign-in" : "/sign-up"}>{signingUp ? "Sign in" : "Create an account"}</Link></p></section><p className={s.footer}>Local development environment · Your data stays in your configured database.</p></main>;
}
