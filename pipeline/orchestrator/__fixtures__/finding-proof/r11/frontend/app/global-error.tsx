"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ backgroundColor: "var(--nx-color-background)", color: "var(--nx-color-foreground)", padding: "4rem 1rem", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: "100vh", margin: 0 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Critical Error</h2>
        <p style={{ fontFamily: "var(--font-body)", color: "var(--nx-color-muted-foreground)", marginBottom: "2rem", maxWidth: "400px" }}>
          A serious error prevented the application from loading.
        </p>
        <button onClick={() => reset()} style={{ padding: "0.5rem 1rem", backgroundColor: "var(--nx-color-primary)", color: "var(--nx-color-primary-foreground)", border: "none", borderRadius: "var(--nx-radius-md)", cursor: "pointer", fontWeight: 600 }}>
          Try again
        </button>
      </body>
    </html>
  );
}