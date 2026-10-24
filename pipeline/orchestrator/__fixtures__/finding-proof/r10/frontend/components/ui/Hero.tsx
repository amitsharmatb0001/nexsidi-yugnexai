"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { Button } from "@/components/nexui/button";
import Link from "next/link";

const heroClass = css({
  padding: `${theme.space[24]} ${theme.space[6]}`,
  backgroundColor: theme.color.card,
  borderRadius: theme.radius.lg,
  marginBottom: theme.space[16],
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  border: `1px solid ${theme.color.border}`,
});

const titleClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "2.5rem",
  fontWeight: 700,
  color: theme.color.foreground,
  marginBottom: theme.space[6],
  maxWidth: "800px",
  "@media (min-width: 768px)": {
    fontSize: "3.5rem",
  }
});

const subtitleClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "1.125rem",
  color: theme.color.mutedForeground,
  marginBottom: theme.space[10],
  maxWidth: "600px",
});

const actionsClass = css({
  display: "flex",
  gap: theme.space[4],
  flexWrap: "wrap",
  justifyContent: "center",
});

export function Hero() {
  return (
    <div className={heroClass}>
      <h1 className={titleClass}>Neighborhood Craft Coffee, Ready When You Are.</h1>
      <p className={subtitleClass}>
        Skip the line. Browse our daily selection of freshly roasted drinks and local bakery items, 
        select your pickup time, and pay in-store.
      </p>
      <div className={actionsClass}>
        <Button asChild size="lg" tone="primary">
          <Link href="/menu">Browse Menu</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/sign-up">Create Account</Link>
        </Button>
      </div>
    </div>
  );
}