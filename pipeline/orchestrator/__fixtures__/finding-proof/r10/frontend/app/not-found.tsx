import Link from "next/link";
import { Button } from "@/components/nexui/button";

export default function NotFound() {
  return (
    <div style={{ padding: "4rem 1rem", textAlign: "center", minHeight: "60vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", fontWeight: 700, marginBottom: "1rem" }}>Page not found</h1>
      <p style={{ fontFamily: "var(--font-body)", color: "var(--nx-color-muted-foreground)", marginBottom: "2rem" }}>
        The page you are looking for doesn't exist or has been moved.
      </p>
      <Button asChild size="lg" tone="primary">
        <Link href="/">Return Home</Link>
      </Button>
    </div>
  );
}