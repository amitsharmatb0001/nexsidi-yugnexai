import Sidebar from "@/components/Sidebar";
import { EmptyState } from "@/components/nexui/empty-state";
import { css, themeVars as theme } from "@yugnex/core";
import { eyebrow, ground } from "@/lib/design";

const main = css({ maxWidth: "640px", margin: "0 auto", padding: `${theme.space[8]} ${theme.space[5]} ${theme.space[16]}` });
const title = css({
  margin: 0,
  fontFamily: "var(--nx-font-family-display)",
  fontSize: "28px",
  fontWeight: theme.fontWeight.bold,
  letterSpacing: "-0.025em",
  color: theme.color.foreground,
  marginBottom: theme.space[6],
});
const panel = css({
  border: `1px solid ${ground.seam}`,
  borderRadius: theme.radius.md,
  backgroundColor: ground.panel,
  padding: `${theme.space[10]} ${theme.space[4]}`,
});

/**
 * Deliberately empty of numbers.
 *
 * The system's mistake-memory table (instincts) has no per-user or reliable
 * per-project isolation today — writes hardcode projectId to null, and reads
 * apply no project filter at all, so every account's data is currently
 * pooled together. Rendering "your Decisions: 24, Documents: 112" style
 * counts here would be showing a mix of every user's data as if it were
 * yours — exactly the isolation gap this conversation started from. This
 * page stays honest about that instead of faking the reference mockup's
 * numbers until the isolation work lands.
 */
export default function MemoryVaultPage() {
  return (
    <Sidebar>
      <main className={main}>
        <span className={eyebrow}>Memory</span>
        <h1 className={title}>Memory Vault</h1>

        <div className={panel}>
          <EmptyState
            title="Not isolated per account yet"
            description="The system's memory currently isn't separated per user or project — showing it here would mix in other accounts' data. This page will fill in once that isolation is built."
          />
        </div>
      </main>
    </Sidebar>
  );
}
