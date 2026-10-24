"use client";

import { useEffect, useState, useMemo } from "react";
import { css, themeVars as theme } from "@yugnex/core";
import { StaffOrder, updateOrderStatus, getStaffOrders } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { Badge } from "@/components/nexui/badge";
import { Button } from "@/components/nexui/button";
import { Skeleton } from "@/components/nexui/skeleton";
import { Separator } from "@/components/nexui/separator";
import { Input } from "@/components/nexui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/nexui/tabs";

// Styles
const boardContainerClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[6],
});

const controlsRowClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
  backgroundColor: "#F3ECE1", // Warm alabaster
  border: "1px solid #D8D5CC",
  borderRadius: theme.radius.lg,
  padding: theme.space[4],
  "@media (min-width: 768px)": {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});

const searchInputWrapperClass = css({
  flex: 1,
  maxWidth: "100%",
  "@media (min-width: 768px)": {
    maxWidth: "350px",
  },
});

const refreshSectionClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  justifyContent: "space-between",
  "@media (min-width: 768px)": {
    justifyContent: "flex-end",
  },
});

const ordersGridClass = css({
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: theme.space[6],
  "@media (min-width: 768px)": {
    gridTemplateColumns: "repeat(2, 1fr)",
  },
  "@media (min-width: 1100px)": {
    gridTemplateColumns: "repeat(3, 1fr)",
  },
});

const orderCardClass = css({
  backgroundColor: "#F3ECE1", // Warm alabaster
  border: "1px solid #D8D5CC",
  borderRadius: theme.radius.lg,
  padding: theme.space[5],
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: theme.space[4],
  transition: "transform 0.2s ease, box-shadow 0.2s ease",
  ":hover": {
    transform: "translateY(-2px)",
    boxShadow: "0 4px 12px rgba(44, 30, 24, 0.05)",
  },
});

const orderCardHeaderClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: theme.space[2],
});

const orderIdClass = css({
  fontFamily: "var(--font-mono)",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#C87D55", // Roasted caramel
});

const pickupHighlightClass = css({
  backgroundColor: "rgba(47, 111, 79, 0.08)", // Translucent Forest green
  borderLeft: "3px solid #2F6F4F",
  padding: `${theme.space[2.5]} ${theme.space[3]}`,
  borderRadius: theme.radius.md,
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1],
});

const pickupLabelClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#2F6F4F",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
});

const pickupTimeClass = css({
  fontFamily: "var(--font-mono)",
  fontSize: "1rem",
  fontWeight: 700,
  color: "#14171F",
});

const customerEmailClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  color: "#2C1E18",
  fontWeight: 500,
  wordBreak: "break-all",
});

const itemsListClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[2.5],
  margin: `${theme.space[2]} 0`,
});

const itemRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  fontSize: "0.9rem",
  fontFamily: "var(--font-body)",
  color: "#14171F",
});

const itemQtyClass = css({
  fontFamily: "var(--font-mono)",
  fontWeight: 600,
  color: "#C87D55",
  marginRight: theme.space[2],
});

const noteCalloutClass = css({
  fontSize: "0.8rem",
  fontStyle: "italic",
  color: "#D46A4E", // Terracotta
  backgroundColor: "rgba(212, 106, 78, 0.06)",
  border: "1px dashed rgba(212, 106, 78, 0.3)",
  padding: `${theme.space[1.5]} ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  marginTop: theme.space[1],
  marginLeft: theme.space[6],
});

const totalRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  paddingTop: theme.space[3],
  borderTop: "1px solid #D8D5CC",
});

const actionsWrapperClass = css({
  display: "flex",
  gap: theme.space[2],
  marginTop: "auto",
  paddingTop: theme.space[2],
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
  border: "1px dashed #D8D5CC",
  gap: theme.space[4],
  maxWidth: "600px",
  margin: "3rem auto",
});

const metaTextClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  color: "rgba(44, 30, 24, 0.5)",
});

// Date formatting helpers
const fmtDateIn = (dateStr: string) => {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
};

const fmtTimeIn = (dateStr: string) => {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateStr;
  }
};

// Format requested pickup time (ISO String -> readable)
const formatPickupTimeSlot = (dateStr: string) => {
  if (!dateStr) return "ASAP";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr; // fallback if plain text
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    let dayLabel = "";
    if (diffDays === 0) {
      dayLabel = "Today";
    } else if (diffDays === 1) {
      dayLabel = "Tomorrow";
    } else if (diffDays === -1) {
      dayLabel = "Yesterday";
    } else {
      dayLabel = date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    }

    return `${timeStr} (${dayLabel})`;
  } catch {
    return dateStr;
  }
};

export default function StaffOrderBoard() {
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Filtering and searching
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveDayFilter] = useState<string>("active");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  const fetchOrders = async (showQuietRefresh = false) => {
    if (showQuietRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    const res = await getStaffOrders();
    if (res.success) {
      // Sort orders by pickup time (soonest pickup first)
      const sorted = [...res.orders].sort(
        (a, b) => new Date(a.pickup_time).getTime() - new Date(b.pickup_time).getTime()
      );
      setOrders(sorted);
    } else {
      setError(res.error || "Failed to load incoming pre-orders.");
    }

    setIsLoading(false);
    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchOrders();

    // Baristas need live dashboard updates: poll every 10 seconds
    const interval = setInterval(() => {
      fetchOrders(true);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    setUpdatingOrderId(orderId);
    const res = await updateOrderStatus(orderId, newStatus);
    if (res.success) {
      // update local state
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
    } else {
      alert(`Error updating status: ${res.error || "Please try again."}`);
    }
    setUpdatingOrderId(null);
  };

  // Filter & Search Logic
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Search logic (email or order ID)
      const matchesSearch =
        order.customer_email.toLowerCase().includes(search.toLowerCase()) ||
        order.id.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      // Status filter logic
      const status = order.status.toLowerCase();
      if (activeFilter === "active") {
        return ["pending", "preparing", "ready"].includes(status);
      }
      if (activeFilter === "pending") return status === "pending";
      if (activeFilter === "preparing") return status === "preparing";
      if (activeFilter === "ready") return status === "ready";
      if (activeFilter === "completed") return status === "completed";
      if (activeFilter === "cancelled") return status === "cancelled";
      
      return true; // "all"
    });
  }, [orders, search, activeFilter]);

  // Memoized counts for each status to optimize rendering performance
  const statusCounts = useMemo(() => {
    const counts = {
      active: 0,
      pending: 0,
      preparing: 0,
      ready: 0,
      completed: 0,
      cancelled: 0,
      all: orders.length,
    };
    for (const o of orders) {
      const s = o.status.toLowerCase();
      if (["pending", "preparing", "ready"].includes(s)) counts.active++;
      if (s === "pending") counts.pending++;
      if (s === "preparing") counts.preparing++;
      if (s === "ready") counts.ready++;
      if (s === "completed") counts.completed++;
      if (s === "cancelled") counts.cancelled++;
    }
    return counts;
  }, [orders]);

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    switch (s) {
      case "pending":
        return <Badge variant="soft" tone="warning" size="sm">Pending</Badge>;
      case "preparing":
        return <Badge variant="soft" tone="primary" size="sm">Preparing</Badge>;
      case "ready":
        return <Badge variant="solid" tone="success" size="sm">Ready for Pickup</Badge>;
      case "completed":
        return <Badge variant="soft" tone="success" size="sm">Completed</Badge>;
      case "cancelled":
        return <Badge variant="soft" tone="destructive" size="sm">Cancelled</Badge>;
      default:
        return <Badge variant="outline" size="sm">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className={boardContainerClass}>
        <div className={controlsRowClass}>
          <Skeleton shape="rect" width="100%" height="45px" />
        </div>
        <div className={ordersGridClass}>
          {[1, 2, 3].map((n) => (
            <div key={n} className={orderCardClass}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Skeleton shape="text" lines={1} width="120px" />
                <Skeleton shape="rect" width="80px" height="24px" />
              </div>
              <Skeleton shape="rect" width="100%" height="50px" />
              <Skeleton shape="text" lines={3} />
              <Separator />
              <Skeleton shape="rect" width="100%" height="40px" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={boardContainerClass}>
      {/* Controls & Filters */}
      <div className={controlsRowClass}>
        <div className={searchInputWrapperClass}>
          <Input
            placeholder="Search email or order number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={refreshSectionClass}>
          <span style={{ fontSize: "0.8rem", color: "rgba(44, 30, 24, 0.6)", fontFamily: "var(--font-body)" }}>
            {isRefreshing ? "Checking for new orders..." : "Live updates enabled (10s)"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchOrders()}
            isLoading={isRefreshing}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs list for Status categories */}
      <div>
        <Tabs value={activeFilter} onValueChange={setActiveDayFilter}>
          <TabsList style={{ flexWrap: "wrap", height: "auto", padding: "4px" }}>
            <TabsTrigger value="active">Active ({statusCounts.active})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({statusCounts.pending})</TabsTrigger>
            <TabsTrigger value="preparing">Preparing ({statusCounts.preparing})</TabsTrigger>
            <TabsTrigger value="ready">Ready ({statusCounts.ready})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({statusCounts.completed})</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled ({statusCounts.cancelled})</TabsTrigger>
            <TabsTrigger value="all">All ({statusCounts.all})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error && (
        <div style={{ padding: "1rem", backgroundColor: "rgba(212, 106, 78, 0.1)", border: "1px solid #D46A4E", borderRadius: theme.radius.md, color: "#D46A4E", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" /></svg>
          <span>{error}</span> <button onClick={() => fetchOrders()} style={{ background: "none", border: "none", color: "#D46A4E", textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}>Try again</button>
        </div>
      )}

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div className={emptyStateClass}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C87D55" strokeWidth="1.5">
            <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 style={{ fontFamily: "var(--font-display)", color: "#2C1E18", fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            No Pre-Orders Found
          </h3>
          <p style={{ fontFamily: "var(--font-body)", color: "rgba(44, 30, 24, 0.7)", maxWidth: "400px", margin: 0, fontSize: "0.9rem" }}>
            {search || activeFilter !== "active" 
              ? "No orders match your search criteria or selected status filter." 
              : "All clear! There are currently no active incoming pre-orders waiting to be prepared."}
          </p>
          {(search || activeFilter !== "active") && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setActiveDayFilter("active"); }}>
              Reset Filters
            </Button>
          )}
        </div>
      ) : (
        <div className={ordersGridClass}>
          {filteredOrders.map((order) => {
            const status = order.status.toLowerCase();
            const isUpdating = updatingOrderId === order.id;

            return (
              <div key={order.id} className={orderCardClass}>
                {/* Header */}
                <div className={orderCardHeaderClass}>
                  <div>
                    <span className={orderIdClass}>Order #{order.id.slice(0, 8).toUpperCase()}</span>
                    <div className={metaTextClass} style={{ marginTop: "2px" }}>
                      Placed {fmtDateIn(order.created_at)} at {fmtTimeIn(order.created_at)}
                    </div>
                  </div>
                  <div>
                    {getStatusBadge(order.status)}
                  </div>
                </div>

                <Separator />

                {/* Pickup highlight */}
                <div className={pickupHighlightClass}>
                  <div className={pickupLabelClass}>⏰ Requested Pickup Time</div>
                  <div className={pickupTimeClass}>{formatPickupTimeSlot(order.pickup_time)}</div>
                </div>

                {/* Customer Email */}
                <div>
                  <div style={{ fontSize: "0.75rem", color: "rgba(44, 30, 24, 0.5)", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em", marginBottom: "2px" }}>
                    Customer Email
                  </div>
                  <div className={customerEmailClass}>
                    {order.customer_email}
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div style={{ fontSize: "0.75rem", color: "rgba(44, 30, 24, 0.5)", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em", marginBottom: "6px" }}>
                    Drinks & Pastries ({order.items.reduce((sum, item) => sum + item.quantity, 0)})
                  </div>
                  <div className={itemsListClass}>
                    {order.items.map((item) => (
                      <div key={item.id}>
                        <div className={itemRowClass}>
                          <span>
                            <span className={itemQtyClass}>{item.quantity}x</span>
                            <span style={{ fontWeight: 500 }}>{item.name}</span>
                          </span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 500 }}>
                            {formatMoney(item.price * item.quantity)}
                          </span>
                        </div>
                        {item.notes && (
                          <div className={noteCalloutClass}>
                            <strong>Barista Note:</strong> &ldquo;{item.notes}&rdquo;
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Total */}
                <div className={totalRowClass}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "rgba(44, 30, 24, 0.5)", fontWeight: 500 }}>
                      Collect In-Store
                    </div>
                    <span style={{ fontSize: "0.7rem", color: "#2F6F4F", fontWeight: 600, textTransform: "uppercase" }}>
                      Unpaid at Pickup
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.25rem", fontWeight: 700, color: "#14171F" }}>
                      {formatMoney(order.total_price)}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {["pending", "preparing", "ready"].includes(status) && (
                  <div className={actionsWrapperClass}>
                    {status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          tone="primary"
                          style={{ flex: 1, backgroundColor: "#2F6F4F" }}
                          onClick={() => handleStatusChange(order.id, "preparing")}
                          isLoading={isUpdating}
                        >
                          Start Preparing
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          tone="destructive"
                          onClick={() => handleStatusChange(order.id, "cancelled")}
                          isLoading={isUpdating}
                        >
                          Cancel
                        </Button>
                      </>
                    )}

                    {status === "preparing" && (
                      <>
                        <Button
                          size="sm"
                          tone="primary"
                          style={{ flex: 1, backgroundColor: "#2F6F4F" }}
                          onClick={() => handleStatusChange(order.id, "ready")}
                          isLoading={isUpdating}
                        >
                          Mark Ready
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          tone="destructive"
                          onClick={() => handleStatusChange(order.id, "cancelled")}
                          isLoading={isUpdating}
                        >
                          Cancel
                        </Button>
                      </>
                    )}

                    {status === "ready" && (
                      <>
                        <Button
                          size="sm"
                          tone="primary"
                          style={{ flex: 1, backgroundColor: "#2F6F4F" }}
                          onClick={() => handleStatusChange(order.id, "completed")}
                          isLoading={isUpdating}
                        >
                          Complete Pickup
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          tone="destructive"
                          onClick={() => handleStatusChange(order.id, "cancelled")}
                          isLoading={isUpdating}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
