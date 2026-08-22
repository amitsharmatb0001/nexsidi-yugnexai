"use client";

// A single collapsible, maximizable section in the right-side panel dock —
// the reusable piece Plan/Context/Preview/Background-Tasks/Files-Changed/
// Cost are all built from. Modeled on Claude.ai's own Project sidebar
// (Instructions / Memory / Context / Scheduled, each its own independently
// expandable section) rather than the single Plan/Grid drawer this
// replaces — several small panels you open one at a time, not one drawer
// switching between two fixed modes.
import { type ReactNode } from "react";
import { IconChevronDown, IconMaximize, IconMinimize } from "./IdeIcons";
import { ws as s } from "./IdeWorkspace.styles";

export interface DockPanelProps {
  icon: ReactNode;
  label: string;
  /** Small dot/count rendered next to the label — real signal only (e.g. an
   * unreviewed-changes count), never decorative. */
  badge?: ReactNode;
  open: boolean;
  onToggleOpen: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  /** Disables the maximize control for panels too small to benefit (e.g. Cost). */
  maximizable?: boolean;
  children: ReactNode;
}

export default function DockPanel({
  icon,
  label,
  badge,
  open,
  onToggleOpen,
  maximized,
  onToggleMaximize,
  maximizable = true,
  children,
}: DockPanelProps) {
  return (
    <section className={`${s.dockPanel} ${open ? s.dockPanelOpen : ""}`}>
      <div className={s.dockPanelHead}>
        <button type="button" className={s.dockPanelHeadBtn} onClick={onToggleOpen}>
          <span className={s.dockPanelIcon}>{icon}</span>
          <span className={s.dockPanelLabel}>{label}</span>
          {badge}
          <span className={s.dockPanelSpacer} />
          <span className={`${s.dockPanelChevron} ${open ? s.dockPanelChevronOpen : ""}`}>
            <IconChevronDown size={12} />
          </span>
        </button>
        {open && maximizable && (
          <button
            type="button"
            className={s.dockPanelMaxBtn}
            title={maximized ? "Restore" : "Maximize"}
            onClick={onToggleMaximize}
          >
            {maximized ? <IconMinimize size={12} /> : <IconMaximize size={12} />}
          </button>
        )}
      </div>
      {open && <div className={s.dockPanelBody}>{children}</div>}
    </section>
  );
}
