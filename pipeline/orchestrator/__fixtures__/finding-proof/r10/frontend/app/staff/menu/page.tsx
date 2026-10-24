"use client";

import { useEffect, useState } from "react";
import { css, themeVars as theme } from "@yugnex/core";
import { MenuItem, getMenuItems, getUserRole } from "@/lib/api";
import { layoutCss } from "@/lib/styles";
import { MenuManagerTable } from "@/components/staff/MenuManagerTable";
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

export default function StaffMenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    // Check role on mount
    const role = getUserRole();
    if (role === "staff" || role === "admin") {
      setIsAuthorized(true);
      fetchMenu();
    } else {
      setIsAuthorized(false);
      setIsLoading(false);
    }
  }, []);

  const fetchMenu = async () => {
    setIsLoading(true);
    setError(undefined);
    const res = await getMenuItems();
    if (res.success) {
      setItems(res.items);
    } else {
      setError(res.error || "Failed to load menu items");
    }
    setIsLoading(false);
  };

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
          The Staff Menu Manager is only accessible to authorized baristas and shop managers. If you have a staff account, please sign in.
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

  return (
    <div className={layoutCss.pageContainer} style={{ backgroundColor: "#FAF6F0" }}>
      <main className={layoutCss.mainContent}>
        <div className={layoutCss.section}>
          <div className={layoutCss.container}>
            <div className={headerSectionClass}>
              <div className={titleRowClass}>
                <div style={{ display: "flex", alignItems: "center", gap: theme.space[3] }}>
                  <h1 className={pageTitleClass}>Staff Menu Manager</h1>
                  <Badge variant="solid" tone="primary" size="md">Staff Only</Badge>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Link href="/menu" style={{ textDecoration: "none" }}>
                    <span style={{ display: "inline-block", fontSize: "0.875rem", padding: "0.5rem 1rem", border: "1px solid #D8D5CC", borderRadius: theme.radius.md, color: "#2C1E18", backgroundColor: "#F3ECE1", fontWeight: 500 }}>
                      View Customer Menu ↗
                    </span>
                  </Link>
                </div>
              </div>
              <p className={pageSubtitleClass}>
                Add new drinks or pastries, update prices, and instantly toggle items in/out of stock (86'ing) to reflect real-time availability on the customer-facing menu.
              </p>
            </div>

            {error && (
              <div style={{ padding: "1rem", backgroundColor: "rgba(212, 106, 78, 0.1)", border: "1px solid #D46A4E", borderRadius: theme.radius.md, color: "#D46A4E", marginBottom: theme.space[6], fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" /></svg>
                <span>{error}.</span> <button onClick={fetchMenu} style={{ background: "none", border: "none", color: "#D46A4E", textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}>Try reloading</button>
              </div>
            )}

            <MenuManagerTable
              items={items}
              isLoading={isLoading}
              onRefresh={fetchMenu}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
