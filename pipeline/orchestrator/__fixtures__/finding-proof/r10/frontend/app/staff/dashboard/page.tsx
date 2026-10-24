"use client";

import { useEffect, useState } from "react";
import { css, themeVars as theme } from "@yugnex/core";
import { getUserRole } from "@/lib/api";
import { layoutCss } from "@/lib/styles";
import StaffOrderBoard from "@/components/staff/StaffOrderBoard";
import { Badge } from "@/components/nexui/badge";
import Link from "next/link";

const headerSectionClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[3],
  marginBottom: theme.space[10],
  borderBottom: `1px solid #D8D5CC`,
  paddingBottom: theme.space[6],
});

const titleRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: theme.space[4],
});

const pageTitleClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "2.25rem",
  fontWeight: 700,
  color: "#2C1E18", // Espresso brown
  margin: 0,
});

const pageSubtitleClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  color: "rgba(44, 30, 24, 0.75)",
  maxWidth: "800px",
  lineHeight: 1.5,
  margin: 0,
});

const unauthorizedPanelClass = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: theme.space[16],
  textAlign: "center",
  backgroundColor: "#FAF6F0",
  minHeight: "60vh",
  gap: theme.space[6],
});

export default function StaffDashboardPage() {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const role = getUserRole();
    if (role === "staff" || role === "admin") {
      setIsAuthorized(true);
    } else {
      setIsAuthorized(false);
    }
  }, []);

  if (isAuthorized === false) {
    return (
      <div className={unauthorizedPanelClass}>
        <div style={{ padding: "1rem", backgroundColor: "rgba(44, 30, 24, 0.05)", borderRadius: "9999px" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2C1E18" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", color: "#2C1E18", margin: 0, fontSize: "1.75rem", fontWeight: 700 }}>
          Access Restricted
        </h1>
        <p style={{ fontFamily: "var(--font-body)", color: "rgba(44, 30, 24, 0.75)", maxWidth: "450px", margin: 0 }}>
          The Barista Pre-Order Dashboard is only accessible to authorized baristas and shop managers. If you have a staff account, please sign in.
        </p>
        <div style={{ display: "flex", gap: "1rem" }}>
          <Link href="/sign-in" style={{ textDecoration: "none" }}>
            <span style={{ display: "inline-block", padding: "0.5rem 1.25rem", backgroundColor: "#2F6F4F", color: "#FAF6F0", borderRadius: "var(--nx-radius-md)", fontWeight: 500 }}>
              Sign In as Staff
            </span>
          </Link>
          <Link href="/" style={{ textDecoration: "none" }}>
            <span style={{ display: "inline-block", padding: "0.5rem 1.25rem", backgroundColor: "transparent", border: "1px solid #D8D5CC", color: "#2C1E18", borderRadius: "var(--nx-radius-md)", fontWeight: 500 }}>
              Back to Home
            </span>
          </Link>
        </div>
      </div>
    );
  }

  if (isAuthorized === null) {
    return (
      <div className={layoutCss.pageContainer} style={{ backgroundColor: "#FAF6F0", minHeight: "80vh", justifyContent: "center", alignItems: "center" }}>
        <p style={{ fontFamily: "var(--font-body)", color: "#2C1E18" }}>Loading authorization status...</p>
      </div>
    );
  }

  return (
    <div className={layoutCss.pageContainer} style={{ backgroundColor: "#FAF6F0" }}>
      <main className={layoutCss.mainContent}>
        <div className={layoutCss.section}>
          <div className={layoutCss.container}>
            <div className={headerSectionClass}>
              <div className={titleRowClass}>
                <div style={{ display: "flex", alignItems: "center", gap: theme.space[3] }}>
                  <h1 className={pageTitleClass}>Staff Order Dashboard</h1>
                  <Badge variant="solid" tone="primary" size="md">Barista Workspace</Badge>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Link href="/staff/menu" style={{ textDecoration: "none" }}>
                    <span style={{ display: "inline-block", fontSize: "0.875rem", padding: "0.5rem 1rem", border: "1px solid #D8D5CC", borderRadius: theme.radius.md, color: "#FAF6F0", backgroundColor: "#2F6F4F", fontWeight: 500 }}>
                      Staff Menu Manager
                    </span>
                  </Link>
                  <Link href="/menu" style={{ textDecoration: "none" }}>
                    <span style={{ display: "inline-block", fontSize: "0.875rem", padding: "0.5rem 1rem", border: "1px solid #D8D5CC", borderRadius: theme.radius.md, color: "#2C1E18", backgroundColor: "#F3ECE1", fontWeight: 500 }}>
                      View Customer Menu ↗
                    </span>
                  </Link>
                </div>
              </div>
              <p className={pageSubtitleClass}>
                Monitor and manage incoming active customer pre-orders in real time. Move orders through their lifecycle from Pending, to Preparing, to Ready for pickup, and finally to Completed.
              </p>
            </div>

            <StaffOrderBoard />
          </div>
        </div>
      </main>
    </div>
  );
}
