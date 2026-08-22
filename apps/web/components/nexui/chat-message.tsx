"use client";

import { createVariants, css, themeVars as theme } from "@yugnex/core";
import type { HTMLAttributes, ReactNode } from "react";

export type ChatRole = "user" | "assistant" | "system";

const rowVariants = createVariants({
  base: {
    display: "flex",
    gap: theme.space[3],
    alignItems: "flex-start",
    width: "100%",
  },
  variants: {
    role: {
      user: { flexDirection: "row-reverse" },
      assistant: { flexDirection: "row" },
      system: { flexDirection: "row", justifyContent: "center" },
    },
  },
  defaultVariants: { role: "assistant" },
});

const bubbleVariants = createVariants({
  base: {
    position: "relative",
    maxWidth: "42rem",
    padding: `${theme.space[3]} ${theme.space[4]}`,
    borderRadius: theme.radius.lg,
    fontFamily: theme.fontFamily.sans,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.lineHeight.base,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  variants: {
    role: {
      user: {
        backgroundColor: theme.color.primary,
        color: theme.color.primaryForeground,
        borderBottomRightRadius: theme.radius.sm,
      },
      assistant: {
        backgroundColor: theme.color.muted,
        color: theme.color.foreground,
        borderBottomLeftRadius: theme.radius.sm,
      },
      system: {
        backgroundColor: "transparent",
        border: `1px dashed ${theme.color.border}`,
        color: theme.color.mutedForeground,
        fontSize: theme.fontSize.xs,
        textAlign: "center",
      },
    },
  },
  defaultVariants: { role: "assistant" },
});

const avatarSlotClass = css({
  flexShrink: 0,
  marginTop: "2px",
});

const columnClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1],
  minWidth: 0,
});

const metaClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const actionsClass = css({
  display: "flex",
  gap: theme.space[1],
  opacity: 0,
  transitionProperty: "opacity",
  transitionDuration: theme.duration.fast,
  '[data-nx-chat-message]:hover &, [data-nx-chat-message]:focus-within &': {
    opacity: 1,
  },
});

export interface ChatMessageProps extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  role?: ChatRole;
  children: ReactNode;
  /** Rendered beside the bubble — pass an <Avatar />, an icon, or omit entirely. */
  avatar?: ReactNode;
  /** Small label above the bubble, e.g. a model name. */
  name?: ReactNode;
  timestamp?: ReactNode;
  /** Copy / retry / feedback controls. Revealed on hover or keyboard focus. */
  actions?: ReactNode;
}

/**
 * One turn in a conversation. `role` drives alignment and color: user messages
 * sit right in the primary color, assistant messages left in muted, and system
 * messages render centered and de-emphasized.
 */
export function ChatMessage({
  role = "assistant",
  children,
  avatar,
  name,
  timestamp,
  actions,
  className,
  ...props
}: ChatMessageProps) {
  return (
    <div data-nx-chat-message="" className={rowVariants({ role, className })} {...props}>
      {avatar && role !== "system" ? <div className={avatarSlotClass}>{avatar}</div> : null}
      <div className={columnClass}>
        {name || timestamp ? (
          <div className={metaClass}>
            {name ? <span>{name}</span> : null}
            {timestamp ? <time>{timestamp}</time> : null}
          </div>
        ) : null}
        <div className={bubbleVariants({ role })}>{children}</div>
        {actions ? <div className={actionsClass}>{actions}</div> : null}
      </div>
    </div>
  );
}

const listClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[5],
  width: "100%",
});

/** A vertical stack of <ChatMessage>s with consistent spacing, marked up as a live log for screen readers. */
export function ChatMessageList({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      className={className ? `${listClass} ${className}` : listClass}
      {...props}
    >
      {children}
    </div>
  );
}
