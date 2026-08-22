"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useMemo, type HTMLAttributes, type ReactNode } from "react";

const listClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[0.5],
  padding: theme.space[2],
  margin: 0,
  listStyle: "none",
});

const groupLabelClass = css({
  padding: `${theme.space[3]} ${theme.space[2]} ${theme.space[1]}`,
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  letterSpacing: theme.letterSpacing.wide,
  textTransform: "uppercase",
  color: theme.color.mutedForeground,
});

const itemClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  width: "100%",
  padding: `${theme.space[2]} ${theme.space[2.5]}`,
  borderRadius: theme.radius.sm,
  border: "none",
  background: "transparent",
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  textAlign: "left",
  cursor: "pointer",
  transitionProperty: "background-color, color",
  transitionDuration: theme.duration.fast,
  "&:hover": { backgroundColor: theme.color.muted, color: theme.color.foreground },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "-2px" },
  '&[aria-current="true"]': {
    backgroundColor: theme.color.accent,
    color: theme.color.accentForeground,
    fontWeight: theme.fontWeight.medium,
  },
});

const titleClass = css({
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const trailingClass = css({
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1],
  opacity: 0,
  transitionProperty: "opacity",
  transitionDuration: theme.duration.fast,
  "[data-nx-conversation]:hover &, [data-nx-conversation]:focus-within &": { opacity: 1 },
  '[aria-current="true"] &': { opacity: 1 },
});

const emptyClass = css({
  padding: theme.space[6],
  textAlign: "center",
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
});

export interface Conversation {
  id: string;
  title: string;
  /** Drives the Today / Yesterday / Previous 7 days grouping. */
  updatedAt?: Date | number;
  icon?: ReactNode;
  /** Per-row trailing controls, revealed on hover or focus. */
  actions?: ReactNode;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Buckets by calendar day rather than elapsed hours, so "Yesterday" means yesterday's date. */
function bucketFor(updatedAt: Date | number | undefined, now: Date): string {
  if (updatedAt == null) return "Earlier";
  const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  if (days <= 30) return "Previous 30 days";
  return "Earlier";
}

const BUCKET_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Earlier"];

export interface ConversationListProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  conversations: Conversation[];
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Turn off date bucketing and render one flat list. */
  grouped?: boolean;
  emptyMessage?: string;
  /** Reference date for bucketing. Pass a fixed value to keep snapshots stable. */
  now?: Date;
}

/**
 * The conversation history sidebar of an agent app — grouped by recency the way
 * every chat product does it, with per-row actions that appear on hover or
 * keyboard focus.
 */
export function ConversationList({
  conversations,
  activeId,
  onSelect,
  grouped = true,
  emptyMessage = "No conversations yet.",
  now,
  className,
  ...props
}: ConversationListProps) {
  const groups = useMemo(() => {
    if (!grouped) return [["", conversations]] as Array<[string, Conversation[]]>;
    const reference = now ?? new Date();
    const map = new Map<string, Conversation[]>();
    for (const conversation of conversations) {
      const bucket = bucketFor(conversation.updatedAt, reference);
      const list = map.get(bucket);
      if (list) list.push(conversation);
      else map.set(bucket, [conversation]);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b) ?? []] as [string, Conversation[]]);
  }, [conversations, grouped, now]);

  if (conversations.length === 0) {
    return <p className={emptyClass}>{emptyMessage}</p>;
  }

  return (
    <div className={className} {...props}>
      {groups.map(([label, items]) => (
        <div key={label || "all"}>
          {label ? <p className={groupLabelClass}>{label}</p> : null}
          <ul className={listClass}>
            {items.map((conversation) => (
              <li key={conversation.id} data-nx-conversation="" style={{ listStyle: "none" }}>
                <button
                  type="button"
                  className={itemClass}
                  aria-current={conversation.id === activeId}
                  onClick={() => onSelect?.(conversation.id)}
                >
                  {conversation.icon}
                  <span className={titleClass}>{conversation.title}</span>
                  {conversation.actions ? <span className={trailingClass}>{conversation.actions}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
