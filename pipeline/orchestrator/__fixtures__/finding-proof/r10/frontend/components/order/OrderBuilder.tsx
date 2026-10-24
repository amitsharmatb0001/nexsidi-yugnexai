"use client";

import { useEffect, useState, useRef, useMemo, useTransition, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { css, themeVars as theme } from "@yugnex/core";
import { MenuItem, Order, getMenuItems, createOrder } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
import { Button } from "@/components/nexui/button";
import { Input } from "@/components/nexui/input";
import { Badge } from "@/components/nexui/badge";
import { Skeleton } from "@/components/nexui/skeleton";
import PickupTimeSelector from "./PickupTimeSelector";

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes: string;
}

const mainGridClass = css({
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: theme.space[8],
  alignItems: "start",
  "@media (min-width: 1024px)": {
    gridTemplateColumns: "3fr 2fr",
  },
});

const sectionTitleClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "1.5rem",
  fontWeight: 700,
  color: "#2C1E18", // Espresso brown
  marginBottom: theme.space[4],
  margin: 0,
});

const menuListClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
});

const menuItemCardClass = css({
  backgroundColor: "#F3ECE1", // Warm alabaster
  border: "1px solid #D8D5CC",
  borderRadius: theme.radius.md,
  padding: theme.space[4],
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: theme.space[4],
  transition: "transform 0.1s ease, box-shadow 0.1s ease",
  ":hover": {
    transform: "translateY(-1px)",
    boxShadow: "0 2px 8px rgba(44, 30, 24, 0.05)",
  },
});

const cartItemCardClass = css({
  backgroundColor: "#F3ECE1",
  border: "1px solid #D8D5CC",
  borderRadius: theme.radius.md,
  padding: theme.space[4],
  display: "flex",
  flexDirection: "column",
  gap: theme.space[3],
});

const summaryCardClass = css({
  backgroundColor: "#EFEBE4", // slightly darker warm cream for summary
  border: "1px solid #D8D5CC",
  borderRadius: theme.radius.lg,
  padding: theme.space[6],
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
  position: "sticky",
  top: "100px",
});

const formGroupClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[2],
});

function OrderBuilderContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [menuError, setMenuItemsError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [pickupTime, setPickupTime] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<boolean>(false);

  // Load menu items
  useEffect(() => {
    async function loadMenu() {
      setIsLoadingMenu(true);
      const res = await getMenuItems();
      if (res.success) {
        // Only allow ordering of available menu items
        setMenuItems(res.items.filter((item) => item.is_available));
      } else {
        setMenuItemsError(res.error || "Failed to load the menu catalog.");
      }
      setIsLoadingMenu(false);
    }
    loadMenu();
  }, []);

  // Pre-add item from query param if available
  const initialProcessedRef = useRef<string | null>(null);

  useEffect(() => {
    const itemId = searchParams.get("item");
    if (itemId && menuItems.length > 0 && initialProcessedRef.current !== itemId) {
      initialProcessedRef.current = itemId;
      const match = menuItems.find((item) => item.id === itemId);
      if (match) {
        setCart((prev) => {
          if (prev.some((c) => c.menuItem.id === itemId)) return prev;
          return [...prev, { menuItem: match, quantity: 1, notes: "" }];
        });
      }
    }
  }, [searchParams, menuItems]);

  const handleAddToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItem.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.menuItem.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { menuItem: item, quantity: 1, notes: "" }];
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((c) => {
          if (c.menuItem.id === itemId) {
            const nextQty = c.quantity + delta;
            return { ...c, quantity: nextQty };
          }
          return c;
        })
        .filter((c) => c.quantity > 0);
    });
  };

  const handleUpdateNotes = (itemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((c) => (c.menuItem.id === itemId ? { ...c, notes } : c))
    );
  };

  const handleRemoveFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((c) => c.menuItem.id !== itemId));
  };

  // Live total calculation
  const subtotal = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);

  // Memoize cart items map to optimize lookup inside menuItems loop from O(N*M) to O(N + M)
  const cartItemMap = useMemo(() => {
    const map = new Map<string, CartItem>();
    for (const c of cart) {
      map.set(c.menuItem.id, c);
    }
    return map;
  }, [cart]);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (cart.length === 0) {
      setFormError("Your pre-order cart is empty. Please add at least one item.");
      return;
    }

    if (!pickupTime) {
      setFormError("Please select a valid pickup time.");
      return;
    }

    startTransition(async () => {
      const orderPayload = {
        pickup_time: pickupTime,
        items: cart.map((c) => ({
          menu_item_id: c.menuItem.id,
          quantity: c.quantity,
          notes: c.notes.trim() || undefined,
        })),
      };

      const res = await createOrder(orderPayload);
      if (res.success) {
        setOrderSuccess(true);
        setCart([]);
        router.push("/my-orders");
      } else {
        setFormError(res.error || "Failed to submit pre-order. Please try again.");
      }
    });
  };

  return (
    <form onSubmit={handleSubmitOrder} className={mainGridClass}>
      {/* Menu / Cart Builder section */}
      <div style={{ display: "flex", flexDirection: "column", gap: theme.space[8] }}>
        {/* Selected Items / Cart */}
        <div>
          <h2 className={sectionTitleClass}>Your Pre-Order Cart</h2>
          {cart.length === 0 ? (
            <div
              style={{
                padding: "3rem 2rem",
                textAlign: "center",
                backgroundColor: "#F3ECE1",
                border: "1px dashed #D8D5CC",
                borderRadius: "8px",
              }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#C87D55"
                strokeWidth="1.5"
                style={{ marginBottom: "1rem" }}
              >
                <path
                  d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.125rem", color: "#2C1E18", margin: "0 0 0.5rem 0" }}>
                Your cart is empty
              </h3>
              <p style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "rgba(44, 30, 24, 0.75)", margin: 0 }}>
                Select from our fresh drinks and bakes below to build your pre-order!
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: theme.space[4] }}>
              {cart.map((item) => (
                <div key={item.menuItem.id} className={cartItemCardClass}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.125rem", color: "#2C1E18", margin: 0 }}>
                        {item.menuItem.name}
                      </h4>
                      <span style={{ fontSize: "0.75rem", color: "#C87D55", fontWeight: 500 }}>
                        {item.menuItem.category}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#2C1E18" }}>
                        {formatMoney(item.menuItem.price * item.quantity)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        tone="destructive"
                        onClick={() => handleRemoveFromCart(item.menuItem.id)}
                        aria-label={`Remove ${item.menuItem.name}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Button>
                    </div>
                  </div>

                  {/* Quantity and Notes */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.875rem", color: "rgba(44, 30, 24, 0.75)", fontWeight: 500 }}>
                        Quantity:
                      </span>
                      <div style={{ display: "flex", alignItems: "center", border: "1px solid #D8D5CC", borderRadius: "4px", backgroundColor: "#FAF6F0" }}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          style={{ padding: "0 0.5rem", height: "1.75rem" }}
                          onClick={() => handleUpdateQuantity(item.menuItem.id, -1)}
                        >
                          -
                        </Button>
                        <span style={{ padding: "0 0.75rem", fontSize: "0.875rem", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                          {item.quantity}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          style={{ padding: "0 0.5rem", height: "1.75rem" }}
                          onClick={() => handleUpdateQuantity(item.menuItem.id, 1)}
                        >
                          +
                        </Button>
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: "200px" }}>
                      <Input
                        placeholder="Preparation notes (e.g., extra shot, oat milk, warm up)"
                        value={item.notes}
                        onChange={(e) => handleUpdateNotes(item.menuItem.id, e.target.value)}
                        style={{ height: "2rem" }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Catalog of Addable Items */}
        <div>
          <h2 className={sectionTitleClass}>Add More Bestsellers</h2>
          {isLoadingMenu ? (
            <div className={menuListClass}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ display: "flex", gap: "1rem", backgroundColor: "#F3ECE1", padding: "1rem", borderRadius: "6px" }}>
                  <Skeleton shape="rect" width="100%" height="40px" />
                </div>
              ))}
            </div>
          ) : menuError ? (
            <p style={{ color: "red" }}>{menuError}</p>
          ) : (
            <div className={menuListClass}>
              {menuItems.map((item) => {
                const inCart = cartItemMap.get(item.id);
                return (
                  <div key={item.id} className={menuItemCardClass}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.125rem", color: "#2C1E18", margin: 0 }}>
                        {item.name}
                      </h4>
                      <p style={{ fontFamily: "var(--font-body)", fontSize: "0.825rem", color: "rgba(44, 30, 24, 0.7)", margin: 0 }}>
                        {item.description || "Brewline craft favorite."}
                      </p>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                        <Badge variant="outline" tone="secondary" size="sm">
                          {item.category}
                        </Badge>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", fontWeight: 600, color: "#C87D55" }}>
                          {formatMoney(item.price)}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={inCart ? "outline" : "solid"}
                      tone="primary"
                      size="sm"
                      style={{
                        backgroundColor: inCart ? "transparent" : "#2F6F4F",
                        borderColor: "#2F6F4F",
                        color: inCart ? "#2F6F4F" : "white",
                        minWidth: "90px",
                      }}
                      onClick={() => handleAddToCart(item)}
                    >
                      {inCart ? `Add (+${inCart.quantity})` : "Add to Order"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Summary, Time selector and Actions */}
      <div className={summaryCardClass}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 700, color: "#2C1E18", margin: 0 }}>
          Order Checkout
        </h3>

        {/* Pickup Time Selector */}
        <PickupTimeSelector value={pickupTime} onChange={setPickupTime} />

        <div style={{ borderTop: "1px solid #D8D5CC", paddingTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontFamily: "var(--font-body)", color: "rgba(44, 30, 24, 0.8)", fontSize: "0.875rem" }}>
              Total Items
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: "0.875rem" }}>
              {cart.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "#2C1E18", fontSize: "1.125rem" }}>
              Amount Due
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "#2F6F4F", fontSize: "1.35rem" }}>
              {formatMoney(subtotal)}
            </span>
          </div>
        </div>

        {formError && (
          <div
            style={{
              padding: "0.75rem",
              borderRadius: "4px",
              backgroundColor: "rgba(212, 106, 78, 0.1)",
              border: "1px solid #D46A4E",
              color: "#D46A4E",
              fontSize: "0.825rem",
              fontWeight: 500,
            }}
          >
            {formError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button
            type="submit"
            variant="solid"
            tone="primary"
            style={{
              width: "100%",
              backgroundColor: "#2F6F4F",
              borderColor: "#2F6F4F",
              height: "3rem",
              fontSize: "1rem",
              fontWeight: 600,
            }}
            isLoading={isPending}
            disabled={cart.length === 0}
          >
            Confirm & Place Pre-Order
          </Button>
          <p style={{ fontSize: "0.75rem", color: "rgba(44, 30, 24, 0.65)", textAlign: "center", margin: 0, lineHeight: 1.4, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            <span>Payment is handled entirely in-store when picking up your drinks. Placing this pre-order reserves your items and prepares our baristas.</span>
          </p>
        </div>
      </div>
    </form>
  );
}

export default function OrderBuilder() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", justifyContent: "center", padding: "4rem" }}>
        <Skeleton shape="rect" width="100%" height="400px" />
      </div>
    }>
      <OrderBuilderContent />
    </Suspense>
  );
}
