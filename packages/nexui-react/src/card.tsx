"use client";
// @yugnex/nexui-react — Card
// Composable card with optional header, body, and footer sections.
// Usage:
//   <Card>
//     <CardHeader title="Project" action={<Badge>Active</Badge>} />
//     <CardBody>Content here</CardBody>
//     <CardFooter><Button>Open</Button></CardFooter>
//   </Card>

import React, { type ReactNode, type CSSProperties } from "react";

interface CardProps {
  variant?:   "base" | "surface" | "elevated";
  hoverable?: boolean;
  onClick?:   () => void;
  children?:  ReactNode;
  className?: string;
  style?:     CSSProperties;
}

export function Card({ variant = "surface", hoverable, onClick, children, className, style }: CardProps) {
  const bgMap: Record<string, string> = {
    base:     "var(--nx-bg-base, #0D1117)",
    surface:  "var(--nx-bg-surface, #161B22)",
    elevated: "var(--nx-bg-elevated, #1C2128)",
  };

  return (
    <div
      className={className}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        background: bgMap[variant] ?? bgMap.surface,
        border: "1px solid var(--nx-border, rgba(255,255,255,0.08))",
        borderRadius: 10,
        overflow: "hidden",
        fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
        color: "var(--nx-text, #E6EDF3)",
        cursor: onClick ? "pointer" : "default",
        transition: hoverable || onClick ? "border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease" : "none",
        ...(hoverable || onClick ? {
          ["&:hover" as string]: {
            borderColor: "var(--nx-border-strong, rgba(255,255,255,0.16))",
            boxShadow: "0 4px 6px rgba(0,0,0,0.40)",
            transform: "translateY(-1px)",
          },
        } : {}),
        ...style,
      }}
      onMouseEnter={hoverable || onClick ? e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "var(--nx-border-strong, rgba(255,255,255,0.16))";
        el.style.boxShadow = "0 4px 6px rgba(0,0,0,0.40)";
        if (onClick) el.style.transform = "translateY(-1px)";
      } : undefined}
      onMouseLeave={hoverable || onClick ? e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "";
        el.style.boxShadow = "";
        el.style.transform = "";
      } : undefined}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title?:     ReactNode;
  subtitle?:  ReactNode;
  action?:    ReactNode;
  children?:  ReactNode;
  className?: string;
  style?:     CSSProperties;
}

export function CardHeader({ title, subtitle, action, children, className, style }: CardHeaderProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "16px 20px",
        borderBottom: "1px solid var(--nx-border, rgba(255,255,255,0.08))",
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div style={{ fontSize: "var(--nx-fs-md, 14px)", fontWeight: 600, color: "var(--nx-text, #E6EDF3)", lineHeight: 1.3 }}>
            {title}
          </div>
        )}
        {subtitle && (
          <div style={{ fontSize: "var(--nx-fs-xs, 11px)", color: "var(--nx-text-3, #6E7681)", marginTop: 3, lineHeight: 1.4 }}>
            {subtitle}
          </div>
        )}
        {children}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

export function CardBody({ children, className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={className} style={{ padding: "16px 20px", ...style }}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        padding: "12px 20px",
        borderTop: "1px solid var(--nx-border, rgba(255,255,255,0.08))",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
