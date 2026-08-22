"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/nexui/card";
import { Button } from "@/components/nexui/button";
import { Heading } from "@/components/nexui/heading";
import { Text } from "@/components/nexui/text";
import { eyebrow, ground } from "@/lib/design";
import { css, themeVars as theme } from "@yugnex/core";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Account {
  id: string;
  email: string;
  name: string;
}

const page = css({
  minHeight: "100dvh",
  backgroundColor: ground.void,
  padding: `${theme.space[8]} ${theme.space[5]}`,
});
const wrap = css({ maxWidth: "560px", margin: "0 auto" });
const back = css({
  display: "inline-block",
  marginBottom: theme.space[4],
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
  textDecoration: "none",
  "&:hover": { color: theme.color.foreground },
});
const row = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: `${theme.space[3]} 0`,
  borderTop: `1px solid ${ground.seam}`,
  "&:first-of-type": { borderTop: "none" },
});

/**
 * Real, minimal account settings — name, email, sign out. Everything else
 * the reference dashboard implied under "Settings" (language, notification
 * preferences) has no backend to configure yet; this page does not pretend
 * otherwise by rendering controls for them.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    fetch(`${API}/api/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setAccount(data.user ?? null))
      .catch(() => router.push("/sign-in"));
  }, [router]);

  const signOut = async () => {
    await fetch(`${API}/api/auth/sign-out`, { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/sign-in");
  };

  if (!account) return null;

  return (
    <div className={page}>
      <div className={wrap}>
        <Link href="/dashboard" className={back}>
          ← Dashboard
        </Link>
        <span className={eyebrow}>Account</span>
        <Heading as="h1" size="xl" style={{ marginTop: 4, marginBottom: 24 }}>
          Settings
        </Heading>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account details.</CardDescription>
          </CardHeader>
          <CardBody>
            <div className={row}>
              <Text tone="muted" size="sm">
                Name
              </Text>
              <Text size="sm">{account.name || "—"}</Text>
            </div>
            <div className={row}>
              <Text tone="muted" size="sm">
                Email
              </Text>
              <Text size="sm">{account.email}</Text>
            </div>
          </CardBody>
        </Card>

        <div style={{ marginTop: 24 }}>
          <Button variant="outline" tone="destructive" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
