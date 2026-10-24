"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { layoutCss } from "@/lib/styles";
import CustomerOrderHistory from "./CustomerOrderHistory";
import { Badge } from "@/components/nexui/badge";

const headerSectionClass = css({
  textAlign: "center",
  marginBottom: theme.space[10],
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: theme.space[2],
});

const titleClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "2.5rem",
  fontWeight: 700,
  color: "#2C1E18",
  margin: 0,
});

const subtitleClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "1.125rem",
  color: "rgba(44, 30, 24, 0.75)",
  maxWidth: "600px",
  lineHeight: 1.6,
  margin: 0,
});

export default function MyOrdersPageClient() {
  return (
    <div className={layoutCss.pageContainer} style={{ backgroundColor: "#FAF6F0" }}>
      <main className={layoutCss.mainContent}>
        <div className={layoutCss.section}>
          <div className={layoutCss.container}>
            <div className={headerSectionClass}>
              <Badge variant="outline" tone="primary" size="md">Customer Portal</Badge>
              <h1 className={titleClass}>My Orders</h1>
              <p className={subtitleClass}>
                Track your active pre-orders in real-time, view past orders, and see exact total amounts due for in-store payment at pickup.
              </p>
            </div>

            <CustomerOrderHistory />
          </div>
        </div>
      </main>
    </div>
  );
}
