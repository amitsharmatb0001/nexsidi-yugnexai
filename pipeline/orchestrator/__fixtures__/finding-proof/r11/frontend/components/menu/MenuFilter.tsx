"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { Input } from "@/components/nexui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/nexui/tabs";
import { Checkbox } from "@/components/nexui/checkbox";

interface MenuFilterProps {
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  inStockOnly: boolean;
  onInStockOnlyChange: (checked: boolean) => void;
}

const filterContainerClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[6],
  marginBottom: theme.space[10],
  padding: theme.space[6],
  backgroundColor: "#F3ECE1", // Warm alabaster card background as per design description
  borderRadius: theme.radius.lg,
  border: `1px solid #D8D5CC`, // Warm border
});

const searchRowClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
  "@media (min-width: 768px)": {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  }
});

const searchInputWrapperClass = css({
  flex: 1,
  maxWidth: "100%",
  "@media (min-width: 768px)": {
    maxWidth: "400px",
  }
});

const checkboxLabelClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[2],
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "#2C1E18", // Espresso brown
  userSelect: "none",
});

const tabsWrapperClass = css({
  overflowX: "auto",
  scrollbarWidth: "none",
  "::-webkit-scrollbar": {
    display: "none",
  },
});

export function MenuFilter({
  categories,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  inStockOnly,
  onInStockOnlyChange,
}: MenuFilterProps) {
  return (
    <div className={filterContainerClass}>
      <div className={searchRowClass}>
        <div className={searchInputWrapperClass}>
          <Input
            label="Search our Menu"
            placeholder="Search drinks or pastries..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div>
          <label className={checkboxLabelClass}>
            <Checkbox
              checked={inStockOnly}
              onCheckedChange={(checked) => onInStockOnlyChange(checked === true)}
            />
            Show In-Stock Only
          </label>
        </div>
      </div>

      <div className={tabsWrapperClass}>
        <Tabs value={selectedCategory} onValueChange={onSelectCategory}>
          <TabsList style={{ display: "inline-flex", gap: "0.5rem" }}>
            <TabsTrigger value="all">All Items</TabsTrigger>
            {categories.map((cat) => (
              <TabsTrigger key={cat} value={cat}>
                {cat}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
