"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { css, themeVars as theme } from "@yugnex/core";
import { Order, getCustomerOrders } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
import { Badge } from "@/components/nexui/badge";
import { Button } from "@/components/nexui/button";
import { Skeleton } from "@/components/nexui/skeleton";
import { Separator } from "@/components/nexui/separator";

const containerClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[8],
});

const sectionTitleClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "1.5rem",
  fontWeight: 700,
  color: "#2C1E18",
  margin: 0,
});

const orderCardClass = css({
  backgroundColor: "#F3ECE1", // Warm alabaster
  border: "1px solid #D8D5CC",
  borderRadius: theme.radius.lg,
  padding: theme.space[6],
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
});

const orderHeaderClass = css({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  alignItems: "center",
  gap: theme.space[3],
});

const orderIdClass = css({
  fontFamily: "var(--font-mono)",
  fontSize: "0.9rem",
  fontWeight: 600,
  color: "#C87D55", // roasted caramel
});

const itemRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  padding: `${theme.space[2]} 0`,
  fontFamily: "var(--font-body)",
  fontSize: "0.9375rem",
});

const itemNotesClass = css({
  fontSize: "0.825rem",
  color: "rgba(44, 30, 24, 0.65)",
  fontStyle: "italic",
  margin: `${theme.space[0.5]} 0 0 ${theme.space[4]}`,
});

const totalRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  paddingTop: theme.space[3],
  borderTop: `1px solid #D8D5CC`,
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
  border: `1px dashed #D8D5CC`,
  gap: theme.space[4],
  maxWidth: "600px",
  margin: "2rem auto",
});

const fmtDate = (dStr: string) => {
  if (!dStr) return "N/A";
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dStr;
  }
};

const fmtTime = (dStr: string) => {
  if (!dStr) return "N/A";
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dStr;
  }
};

export default function CustomerOrderHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefresh] = useState(false);

  const fetchOrders = async (showRefreshLoading = false) => {
    if (showRefreshLoading) {
      setIsRefresh(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    const res = await getCustomerOrders();
    if (res.success) {
      // Sort in reverse chronological order
      const sorted = [...res.orders].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setOrders(sorted);
    } else {
      setError(res.error || "Failed to load your pre-orders. Please try again.");
    }

    setIsLoading(false);
    setIsRefresh(false);
  };

  useEffect(() => {
    fetchOrders();

    // Auto-refresh order statuses every 30 seconds for live tracker functionality
    const interval = setInterval(() => {
      fetchOrders(true);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    switch (s) {
      case "pending":
        return <Badge variant="soft" tone="warning" size="md">Pending Approval</Badge>;
      case "preparing":
        return <Badge variant="soft" tone="primary" size="md">Preparing Drink</Badge>;
      case "ready":
        return <Badge variant="solid" tone="success" size="md">Ready for Pickup!</Badge>;
      case "completed":
        return <Badge variant="soft" tone="secondary" size="md">Picked Up & Completed</Badge>;
      case "cancelled":
        return <Badge variant="soft" tone="destructive" size="md">Cancelled</Badge>;
      default:
        return <Badge variant="outline" tone="secondary" size="md">{status}</Badge>;
    }
  };

  // Separate active vs past orders
  const activeOrders = orders.filter((o) =>
    ["pending", "preparing", "ready"].includes(o.status.toLowerCase())
  );
  const pastOrders = orders.filter((o) =>
    ["completed", "cancelled"].includes(o.status.toLowerCase())
  );

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Skeleton shape="rect" width="200px" height="30px" />
          <Skeleton shape="rect" width="100px" height="36px" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className={orderCardClass}>
            <Skeleton shape="rect" width="100%" height="24px" />
            <Skeleton shape="text" lines={3} />
            <Separator />
            <Skeleton shape="rect" width="150px" height="20px" />
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 2rem" }}>
        <h3 style={{ fontFamily: "var(--font-display)", color: "#2C1E18", marginBottom: "1rem" }}>
          Could not load order history
        </h3>
        <p style={{ fontFamily: "var(--font-body)", color: "rgba(44, 30, 24, 0.75)", marginBottom: "1.5rem" }}>
          {error}
        </p>
        <Button variant="outline" tone="primary" onClick={() => fetchOrders()}>
          Retry Loading
        </Button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className={emptyStateClass}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C87D55" strokeWidth="1.5">
          <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 style={{ fontFamily: "var(--font-display)", color: "#2C1E18", margin: "0 0 0.5rem 0", fontSize: "1.5rem", fontWeight: 700 }}>
          No Pre-Orders Yet
        </h3>
        <p style={{ fontFamily: "var(--font-body)", color: "rgba(44, 30, 24, 0.75)", margin: "0 0 1.5rem 0", maxWidth: "400px" }}>
          You haven't placed any pre-orders with Brewline. Order ahead to skip the line and get fresh craft coffee!
        </p>
        <Button asChild variant="solid" tone="primary" style={{ backgroundColor: "#2F6F4F", borderColor: "#2F6F4F" }}>
          <Link href="/order">Order Your First Coffee</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ display: "none" }}>Order Portal</h2> {/* accessible header */}
        <span style={{ fontSize: "0.875rem", color: "rgba(44, 30, 24, 0.65)", fontWeight: 500 }}>
          {orders.length} {orders.length === 1 ? "pre-order" : "pre-orders"} found
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchOrders(true)}
          isLoading={isRefreshing}
          style={{ borderColor: "#D8D5CC", color: "#2C1E18" }}
        >
          {isRefreshing ? "Refreshing..." : "Refresh Tracker"}
        </Button>
      </div>

      {/* Active orders section */}
      {activeOrders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space[4] }}>
          <h3 className={sectionTitleClass}>Active Pre-Orders (Live Tracker)</h3>
          {activeOrders.map((order) => (
            <div key={order.id} className={orderCardClass}>
              <div className={orderHeaderClass}>
                <div>
                  <span className={orderIdClass}>Order ID: #{order.id.slice(0, 8).toUpperCase()}</span>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.825rem", color: "rgba(44, 30, 24, 0.65)", marginTop: "0.25rem" }}>
                    Placed: {fmtDate(order.created_at)} at {fmtTime(order.created_at)}
                  </div>
                </div>
                <div>{getStatusBadge(order.status)}</div>
              </div>

              <Separator />

              {/* Items List */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                {order.items?.map((item) => (
                  <div key={item.id} style={{ borderBottom: "1px dashed #D8D5CC", paddingBottom: "0.5rem", marginBottom: "0.5rem" }}>
                    <div className={itemRowClass}>
                      <span style={{ fontWeight: 600, color: "#2C1E18" }}>
                        {item.quantity}x {item.name}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, color: "#2C1E18" }}>
                        {formatMoney(item.price * item.quantity)}
                      </span>
                    </div>
                    {item.notes && <p className={itemNotesClass}>Note: "{item.notes}"</p>}
                  </div>
                ))}
              </div>

              {/* Pickup and Total */}
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "0.5rem" }}>
                <div style={{ backgroundColor: "#FAF6F0", padding: "0.5rem 0.75rem", borderRadius: "4px", border: "1px solid #D8D5CC" }}>
                  <span style={{ fontSize: "0.825rem", color: "rgba(44, 30, 24, 0.7)", display: "block" }}>
                    Requested Pickup Time:
                  </span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "0.9375rem", fontWeight: 700, color: "#2F6F4F" }}>
                    {fmtDate(order.pickup_time)} at {fmtTime(order.pickup_time)}
                  </span>
                </div>

                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "0.825rem", color: "rgba(44, 30, 24, 0.7)", display: "block" }}>
                    To Pay In-Store:
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "1.25rem", fontWeight: 700, color: "#2C1E18" }}>
                    {formatMoney(order.total_price)}
                  </span>
                </div>
              </div>

              {order.status.toLowerCase() === "ready" && (
                <div
                  style={{
                    backgroundColor: "rgba(47, 111, 79, 0.08)",
                    border: "1px solid #2F6F4F",
                    borderRadius: "6px",
                    padding: "0.75rem",
                    color: "#2F6F4F",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    textAlign: "center",
                  }}
                >
                  Your order is fresh and ready waiting for you at the counter! Head in for pickup & payment.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Past orders section */}
      {pastOrders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space[4], marginTop: theme.space[4] }}>
          <h3 className={sectionTitleClass}>Past Orders History</h3>
          {pastOrders.map((order) => (
            <div key={order.id} className={orderCardClass} style={{ opacity: 0.85 }}>
              <div className={orderHeaderClass}>
                <div>
                  <span className={orderIdClass} style={{ color: "rgba(44, 30, 24, 0.7)" }}>
                    Order ID: #{order.id.slice(0, 8).toUpperCase()}
                  </span>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.825rem", color: "rgba(44, 30, 24, 0.6)", marginTop: "0.25rem" }}>
                    Placed: {fmtDate(order.created_at)} at {fmtTime(order.created_at)}
                  </div>
                </div>
                <div>{getStatusBadge(order.status)}</div>
              </div>

              <Separator />

              {/* Items List (Simplified for past orders) */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                {order.items?.map((item) => (
                  <div key={item.id} className={itemRowClass} style={{ fontSize: "0.875rem", padding: "0.25rem 0" }}>
                    <span style={{ color: "rgba(44, 30, 24, 0.85)" }}>
                      {item.quantity}x {item.name}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "rgba(44, 30, 24, 0.85)" }}>
                      {formatMoney(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              <div className={totalRowClass}>
                <span style={{ fontSize: "0.825rem", color: "rgba(44, 30, 24, 0.65)" }}>
                  Pickup was requested for {fmtDate(order.pickup_time)} at {fmtTime(order.pickup_time)}
                </span>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "0.825rem", color: "rgba(44, 30, 24, 0.65)", marginRight: "0.5rem" }}>
                    Total Paid:
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#2C1E18" }}>
                    {formatMoney(order.total_price)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
