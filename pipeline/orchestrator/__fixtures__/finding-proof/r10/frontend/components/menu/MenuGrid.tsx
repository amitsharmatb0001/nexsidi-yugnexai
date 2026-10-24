"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { MenuItem } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
import { Badge } from "@/components/nexui/badge";
import { Button } from "@/components/nexui/button";
import { Skeleton } from "@/components/nexui/skeleton";
import Link from "next/link";

interface MenuGridProps {
  items: MenuItem[];
  isLoading: boolean;
  error?: string;
  onRetry?: () => void;
}

const gridClass = css({
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: theme.space[6],
  "@media (min-width: 640px)": {
    gridTemplateColumns: "repeat(2, 1fr)",
  },
  "@media (min-width: 1024px)": {
    gridTemplateColumns: "repeat(3, 1fr)",
  }
});

const itemCardClass = css({
  backgroundColor: "#F3ECE1", // Warm alabaster
  border: `1px solid #D8D5CC`, // Cozy border
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  height: "100%",
  transition: "transform 0.15s ease, box-shadow 0.15s ease",
  ":hover": {
    transform: "translateY(-2px)",
    boxShadow: "0 4px 12px rgba(44, 30, 24, 0.08)", // subtle espresso shadow
  }
});

const textContainerClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[2],
});

const nameRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: theme.space[2],
});

const nameClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "1.25rem",
  fontWeight: 700,
  color: "#2C1E18", // Espresso brown
  margin: 0,
});

const priceClass = css({
  fontFamily: "var(--font-mono)",
  fontSize: "1.125rem",
  fontWeight: 600,
  color: "#C87D55", // Roasted caramel accent
  whiteSpace: "nowrap",
});

const descClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  color: "rgba(44, 30, 24, 0.75)", // Espresso brown with some opacity
  lineHeight: 1.5,
  margin: 0,
  minHeight: "2.25rem",
});

const badgeRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  marginTop: theme.space[2],
});

const errorPanelClass = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: theme.space[12],
  textAlign: "center",
  backgroundColor: "#F3ECE1",
  borderRadius: theme.radius.lg,
  border: `1px solid #D8D5CC`,
  gap: theme.space[4],
  maxWidth: "500px",
  margin: "0 auto",
});

const emptyStateClass = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: theme.space[16],
  textAlign: "center",
  backgroundColor: "#F3ECE1",
  borderRadius: theme.radius.lg,
  border: `1px solid #D8D5CC`,
  gap: theme.space[4],
  maxWidth: "600px",
  margin: "4rem auto 0 auto",
});

export function MenuGrid({ items, isLoading, error, onRetry }: MenuGridProps) {
  if (isLoading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className={itemCardClass}>
            <CardHeader style={{ paddingBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <Skeleton shape="rect" width="60%" height="24px" />
                <Skeleton shape="rect" width="25%" height="24px" />
              </div>
              <Skeleton shape="text" lines={2} />
            </CardHeader>
            <CardBody>
              <Skeleton shape="rect" width="40%" height="20px" />
            </CardBody>
            <CardFooter>
              <Skeleton shape="rect" width="100%" height="36px" />
            </CardFooter>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={errorPanelClass}>
        <h3 style={{ fontFamily: "var(--font-display)", color: "#2C1E18", margin: 0, fontSize: "1.25rem" }}>
          Unable to load menu
        </h3>
        <p style={{ fontFamily: "var(--font-body)", color: "rgba(44, 30, 24, 0.75)", margin: 0 }}>
          {error}
        </p>
        {onRetry && (
          <Button variant="outline" tone="primary" onClick={onRetry}>
            Try Again
          </Button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={emptyStateClass}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C87D55" strokeWidth="1.5">
          <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 style={{ fontFamily: "var(--font-display)", color: "#2C1E18", margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
          No menu items found
        </h3>
        <p style={{ fontFamily: "var(--font-body)", color: "rgba(44, 30, 24, 0.75)", margin: 0, maxWidth: "400px" }}>
          We couldn't find any drinks or pastries matching your criteria. Try adjusting your filters or search terms.
        </p>
      </div>
    );
  }

  return (
    <div className={gridClass}>
      {items.map((item) => (
        <Card key={item.id} className={itemCardClass}>
          <CardHeader>
            <div className={textContainerClass}>
              <div className={nameRowClass}>
                <h3 className={nameClass}>{item.name}</h3>
                <span className={priceClass}>{formatMoney(item.price)}</span>
              </div>
              <p className={descClass}>{item.description || "Freshly prepared drink or pastry made with love."}</p>
              <div className={badgeRowClass}>
                <Badge variant="outline" tone="secondary" size="sm">
                  {item.category}
                </Badge>
                {item.is_available ? (
                  <Badge variant="soft" tone="success" size="sm">
                    In Stock
                  </Badge>
                ) : (
                  <Badge variant="soft" tone="destructive" size="sm">
                    Sold Out
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardFooter style={{ marginTop: "auto" }}>
            {item.is_available ? (
              <Button asChild variant="solid" tone="primary" style={{ width: "100%", backgroundColor: "#2F6F4F", borderColor: "#2F6F4F" }}>
                <Link href={`/order?item=${item.id}`}>Order Ahead</Link>
              </Button>
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "2.5rem",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--nx-radius-md)",
                  border: "1px solid var(--nx-color-border)",
                  fontFamily: "var(--font-body)",
                  fontSize: "var(--nx-text-sm)",
                  fontWeight: 500,
                  color: "rgba(44, 30, 24, 0.5)",
                  backgroundColor: "transparent",
                  opacity: 0.6,
                  cursor: "not-allowed",
                }}
              >
                Unavailable
              </div>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
