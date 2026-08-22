"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/nexui/badge";
import AccountMenu from "./AccountMenu";
import YugnexLogo from "./ide/YugnexLogo";
import { sidebar as s } from "./Sidebar.styles";

type NavHref = "/dashboard" | "/projects" | "/memory" | "/approvals" | "/billing";

interface NavItem {
  href: NavHref;
  label: string;
  /** Real-data count shown as a badge — omit rather than show a fabricated 0. */
  count?: number;
}

/**
 * Nav list, pruned against two things at once: CLAUDE.md's confidentiality
 * rule (no agent names, no agent count, no internal architecture in any
 * user-facing surface) and what the backend can actually back today.
 *
 * Deliberately absent, and why:
 *  - "Agents" — the reference mockup named agents individually
 *    (confidentiality violation). Explicitly asked to be removed.
 *  - "Workstreams" / "System Monitor" — the reference exposed the platform's
 *    own CPU/memory/disk and a fabricated multi-workstream count with no
 *    backing data model. Cut on my own judgment, not asked for explicitly —
 *    flagged back to Amit rather than assumed settled.
 *  - "IDE Workspace" as a standalone nav target — there's no global IDE; it
 *    only exists per-project at /build/[id], so a bare nav link would have
 *    nothing to open.
 *
 * Project creation, rename, and delete live only on /projects now — this
 * shell doesn't duplicate that surface.
 */
const NAV: (approvalsCount?: number) => NavItem[] = (approvalsCount) => [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/memory", label: "Memory Vault" },
  { href: "/approvals", label: "Approvals", count: approvalsCount },
  { href: "/billing", label: "Billing & Usage" },
];

export default function Sidebar({
  children,
  approvalsCount,
}: {
  children: ReactNode;
  approvalsCount?: number;
}) {
  const pathname = usePathname();

  return (
    <div className={s.shell}>
      <aside className={s.rail}>
        <Link href="/dashboard" className={s.brand}>
          <YugnexLogo size={18} />
          YugNex
        </Link>

        <nav className={s.nav}>
          {NAV(approvalsCount).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${s.navItem} ${active ? s.navItemActive : ""}`}
              >
                {item.label}
                {typeof item.count === "number" && item.count > 0 && (
                  <Badge tone="primary" size="sm">
                    {item.count}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>

        <div className={s.navSpacer} />
      </aside>

      <div className={s.main}>
        <header className={s.topbar}>
          <div className={s.topbarSpacer} />
          <AccountMenu />
        </header>
        {children}
      </div>
    </div>
  );
}
