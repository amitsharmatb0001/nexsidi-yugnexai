import Link from "next/link";
import { Heading } from "@/components/nexui/heading";
import { Text } from "@/components/nexui/text";
import { Card, CardBody } from "@/components/nexui/card";
import { eyebrow, ground } from "@/lib/design";
import { css, themeVars as theme } from "@yugnex/core";

const page = css({
  minHeight: "100dvh",
  backgroundColor: ground.void,
  padding: `${theme.space[8]} ${theme.space[5]}`,
});
const wrap = css({ maxWidth: "640px", margin: "0 auto" });
const back = css({
  display: "inline-block",
  marginBottom: theme.space[4],
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
  textDecoration: "none",
  "&:hover": { color: theme.color.foreground },
});
const item = css({
  padding: `${theme.space[3]} 0`,
  borderTop: `1px solid ${ground.seam}`,
  "&:first-of-type": { borderTop: "none" },
});

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How do I start a new project?",
    a: "From the dashboard, click New project and describe what you want built in your own words. You'll be asked only what's actually needed before the build starts.",
  },
  {
    q: "What happens when a project needs my approval?",
    a: "The pipeline pauses at two points — once the plan is written, and once the build passes its checks — and waits for you. You'll see it flagged on the dashboard and in the project itself.",
  },
  {
    q: "Where do I see what a project has cost so far?",
    a: "Each project's dashboard row shows running cost and token usage, updated as the build progresses.",
  },
];

export default function HelpPage() {
  return (
    <div className={page}>
      <div className={wrap}>
        <Link href="/dashboard" className={back}>
          ← Dashboard
        </Link>
        <span className={eyebrow}>Help</span>
        <Heading as="h1" size="xl" style={{ marginTop: 4, marginBottom: 24 }}>
          Frequently asked
        </Heading>

        <Card>
          <CardBody>
            {FAQ.map((entry) => (
              <div key={entry.q} className={item}>
                <Text weight="medium" style={{ marginBottom: 6 }}>
                  {entry.q}
                </Text>
                <Text tone="muted" size="sm">
                  {entry.a}
                </Text>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
