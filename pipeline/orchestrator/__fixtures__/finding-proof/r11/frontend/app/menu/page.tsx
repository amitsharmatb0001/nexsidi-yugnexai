"use client";

import { useEffect, useState, useMemo } from "react";
import { css, themeVars as theme } from "@yugnex/core";
import { MenuItem, getMenuItems } from "@/lib/api";
import { layoutCss } from "@/lib/styles";
import { MenuFilter } from "@/components/menu/MenuFilter";
import { MenuGrid } from "@/components/menu/MenuGrid";
import { Badge } from "@/components/nexui/badge";

const headerSectionClass = css({
  textAlign: "center",
  marginBottom: theme.space[12],
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: theme.space[3],
});

const pageTitleClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "2.5rem",
  fontWeight: 700,
  color: "#2C1E18", // Espresso brown
  margin: 0,
});

const pageSubtitleClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "1.125rem",
  color: "rgba(44, 30, 24, 0.75)",
  maxWidth: "700px",
  lineHeight: 1.6,
  margin: 0,
});

const pickupBannerClass = css({
  backgroundColor: "#EFEBE4",
  border: `1px solid #D8D5CC`,
  borderRadius: theme.radius.md,
  padding: `${theme.space[4]} ${theme.space[6]}`,
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[3],
  marginTop: theme.space[4],
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "#2C1E18",
});

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);

  const fetchMenu = async () => {
    setIsLoading(true);
    setError(undefined);
    const res = await getMenuItems();
    if (res.success) {
      setItems(res.items);
    } else {
      setError(res.error || "Failed to load menu. Please try again.");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchMenu();
  }, []);

  // Standard category list fallback, plus any custom categories from DB
  const defaultCategories = useMemo(() => [
    "Coffee & Espresso",
    "Cold Brew & Iced Drinks",
    "Tea & Specialty",
    "Fresh Pastries & Bakery",
    "Seasonal",
  ], []);

  const categories = useMemo(() => {
    return Array.from(
      new Set([
        ...defaultCategories,
        ...items.map((item) => item.category).filter(Boolean),
      ])
    );
  }, [items, defaultCategories]);

  // Filter logic
  const filteredItems = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    const catLower = selectedCategory.toLowerCase();
    return items.filter((item) => {
      const matchesCategory =
        selectedCategory === "all" ||
        item.category.toLowerCase() === catLower;

      const matchesSearch =
        item.name.toLowerCase().includes(searchLower) ||
        (item.description &&
          item.description.toLowerCase().includes(searchLower));

      const matchesAvailability = !inStockOnly || item.is_available;

      return matchesCategory && matchesSearch && matchesAvailability;
    });
  }, [items, selectedCategory, searchQuery, inStockOnly]);

  return (
    <div className={layoutCss.pageContainer} style={{ backgroundColor: "#FAF6F0" }}>
      <main className={layoutCss.mainContent}>
        <div className={layoutCss.section}>
          <div className={layoutCss.container}>
            <div className={headerSectionClass}>
              <Badge variant="outline" tone="primary" size="md">Brewline Coffee Shop</Badge>
              <h1 className={pageTitleClass}>Our Craft Menu</h1>
              <p className={pageSubtitleClass}>
                Browse our slow-roasted espresso beverages, draft cold brews, specialty loose-leaf teas, and daily baked croissants and pastries.
              </p>
              <div className={pickupBannerClass}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  Single-Location Pickup: <strong>128 Espresso Way, Portland OR</strong>
                </span>
                <span style={{ color: "#D8D5CC" }}>|</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  Open Daily 7:00 AM – 4:00 PM
                </span>
              </div>
              <div style={{ fontSize: "0.875rem", color: "#C87D55", fontWeight: 500, marginTop: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
                Select items, pick a convenient slot, and pay in-store at our pickup counter!
              </div>
            </div>

            <MenuFilter
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              inStockOnly={inStockOnly}
              onInStockOnlyChange={setInStockOnly}
            />

            <MenuGrid
              items={filteredItems}
              isLoading={isLoading}
              error={error}
              onRetry={fetchMenu}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
