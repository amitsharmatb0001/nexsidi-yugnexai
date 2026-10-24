"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/nexui/card";
import { layoutCss } from "@/lib/styles";

const gridClass = css({
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: theme.space[8],
  "@media (min-width: 768px)": {
    gridTemplateColumns: "1fr 1fr",
  }
});

const labelClass = css({
  fontFamily: "var(--font-mono)",
  fontSize: "0.875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  color: theme.color.mutedForeground,
  marginBottom: theme.space[2],
});

export default function ContactPage() {
  return (
    <div className={layoutCss.pageContainer}>
      <main className={layoutCss.mainContent}>
        <div className={layoutCss.section}>
          <div className={layoutCss.container} style={{ maxWidth: "900px" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", fontWeight: 700, marginBottom: "1rem" }}>
              Contact & Hours
            </h1>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "1.125rem", color: "var(--nx-color-muted-foreground)", marginBottom: "3rem" }}>
              Visit our single-location neighborhood storefront. Order ahead online and head straight to the pickup counter.
            </p>

            <div className={gridClass}>
              <Card>
                <CardHeader>
                  <CardTitle>Visit Us</CardTitle>
                </CardHeader>
                <CardBody style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <div>
                    <div className={labelClass}>Address</div>
                    <p style={{ margin: 0 }}>
                      1204 Brewline Ave<br />
                      Portland, OR 97204
                    </p>
                  </div>
                  <div>
                    <div className={labelClass}>Pickup Instructions</div>
                    <p style={{ margin: 0, color: "var(--nx-color-muted-foreground)" }}>
                      When you arrive, bypass the main register and head straight to the dedicated online pickup counter on the left. Present your order name to pay and collect.
                    </p>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Get in Touch</CardTitle>
                </CardHeader>
                <CardBody style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <div>
                    <div className={labelClass}>Hours</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", color: "var(--nx-color-muted-foreground)" }}>
                      <li>Mon–Fri: 6:30 AM – 4:00 PM</li>
                      <li>Sat–Sun: 7:30 AM – 5:00 PM</li>
                    </ul>
                  </div>
                  <div>
                    <div className={labelClass}>Contact</div>
                    <p style={{ margin: 0 }}>
                      (503) 555-0199<br />
                      hello@brewline.co
                    </p>
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}