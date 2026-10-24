"use client";

import { useEffect } from "react";
import { Button } from "@/components/nexui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: "4rem 1rem", textAlign: "center", minHeight: "60vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Something went wrong!</h2>
      <p style={{ fontFamily: "var(--font-body)", color: "var(--nx-color-muted-foreground)", marginBottom: "2rem", maxWidth: "400px" }}>
        {error.message || "An unexpected error occurred while loading this page."}
      </p>
      <Button onClick={() => reset()} tone="primary">
        Try again
      </Button>
    </div>
  );
}