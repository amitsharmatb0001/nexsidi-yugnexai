"use client";

import { useState } from "react";
import { Input } from "@/components/nexui/input";
import { Button } from "@/components/nexui/button";
import { fetchApi } from "@/lib/api";
import { css, themeVars as theme } from "@yugnex/core";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetchApi("/api/v1/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to sign in");
      return;
    }

    document.cookie = `token=${res.data.token}; path=/`;
    const isStaffUser = res.data.user?.role === "staff" || res.data.user?.role === "admin";
    const redirectPath = isStaffUser ? "/staff/dashboard" : "/my-orders";
    window.location.assign(redirectPath);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {error && <div style={{ color: "var(--nx-color-destructive)", fontSize: "0.875rem", marginBottom: "0.5rem" }}>{error}</div>}
      <Input 
        label="Email" 
        type="email" 
        required 
        value={email} 
        onChange={(e) => setEmail(e.target.value)} 
        placeholder="hello@example.com"
      />
      <Input 
        label="Password" 
        type="password" 
        required 
        value={password} 
        onChange={(e) => setPassword(e.target.value)} 
        placeholder="••••••••"
      />
      <Button type="submit" tone="primary" isLoading={loading} style={{ marginTop: "1rem" }}>
        Sign In
      </Button>
    </form>
  );
}