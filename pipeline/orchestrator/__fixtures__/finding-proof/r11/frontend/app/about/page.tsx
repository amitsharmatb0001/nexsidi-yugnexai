"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { storyTimeline } from "@/content/about";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/nexui/card";
import { layoutCss } from "@/lib/styles";

const timelineClass = css({
  position: "relative",
  paddingLeft: theme.space[8],
  borderLeft: `2px solid ${theme.color.border}`,
  display: "flex",
  flexDirection: "column",
  gap: theme.space[12],
});

const timelineDotClass = css({
  position: "absolute",
  left: "calc(-2rem - 9px)",
  width: "16px",
  height: "16px",
  borderRadius: "50%",
  backgroundColor: theme.color.primary,
  border: `4px solid ${theme.color.background}`,
});

export default function AboutPage() {
  return (
    <div className={layoutCss.pageContainer}>
      <main className={layoutCss.mainContent}>
        <div className={layoutCss.section}>
          <div className={layoutCss.container} style={{ maxWidth: "800px" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", fontWeight: 700, marginBottom: "2rem" }}>
              Our Craft Coffee Philosophy
            </h1>
            
            <p style={{ fontFamily: "var(--font-body)", fontSize: "1.125rem", color: "var(--nx-color-muted-foreground)", marginBottom: "3rem", lineHeight: 1.6 }}>
              At Brewline, we believe in a single-location craft coffee experience. We source thoughtfully, roast meticulously in-house, and pair our drinks with a local bakery program. Every cup is an investment in quality.
            </p>

            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.75rem", fontWeight: 600, marginBottom: "2rem" }}>
              Our Story
            </h2>

            <div className={timelineClass}>
              {storyTimeline.map((step, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <div className={timelineDotClass} />
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", color: "var(--nx-color-muted-foreground)", marginBottom: "0.5rem" }}>
                    {step.date}
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>{step.title}</CardTitle>
                    </CardHeader>
                    <CardBody>
                      <p style={{ margin: 0, color: "var(--nx-color-muted-foreground)" }}>{step.description}</p>
                    </CardBody>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}