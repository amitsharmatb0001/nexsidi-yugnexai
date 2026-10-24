"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
import { Badge } from "@/components/nexui/badge";
import { Button } from "@/components/nexui/button";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";

const gridClass = css({
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: theme.space[6],
  "@media (min-width: 768px)": {
    gridTemplateColumns: "repeat(3, 1fr)",
  }
});

const sectionTitleClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "2rem",
  fontWeight: 700,
  marginBottom: theme.space[8],
});

export function FeaturedItems() {
  // Since we don't have the backend fetching the menu yet, we show a few highlighted items statically.
  const featured = [
    { name: "Oat Milk Draft Latte", description: "Our signature espresso blend smoothed with creamy oat milk, served on draft.", price: 4.50 },
    { name: "Salted Caramel Cold Brew", description: "Slow-steeped cold brew with house-made salted caramel syrup.", price: 5.00 },
    { name: "Almond Croissant", description: "Twice-baked butter croissant loaded with almond frangipane.", price: 4.00 },
  ];

  return (
    <section style={{ marginBottom: theme.space[16] }}>
      <h2 className={sectionTitleClass}>Seasonal Highlights</h2>
      <div className={gridClass}>
        {featured.map((item, i) => (
          <Card key={i}>
            <CardHeader>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <CardTitle>{item.name}</CardTitle>
                <Badge variant="soft" tone="primary">{formatMoney(item.price)}</Badge>
              </div>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline" size="sm" style={{ width: "100%" }}>
                <Link href="/menu">Order Now</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}