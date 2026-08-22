"use client";

import { css, fadeOut, slideInFromBottom, themeVars as theme } from "@yugnex/core";
import { usePortal } from "@yugnex/core/client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ToastData {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
  duration?: number;
}

type Listener = () => void;

let toasts: ToastData[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastData[] {
  return toasts;
}

function getServerSnapshot(): ToastData[] {
  return [];
}

let idCounter = 0;

/** Queue a toast from anywhere in the app. Requires a mounted <ToastViewport />. */
export function toast(data: Omit<ToastData, "id">): string {
  const id = `nx-toast-${++idCounter}`;
  toasts = [...toasts, { duration: 4000, tone: "default", ...data, id }];
  emit();
  return id;
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

const viewportClass = css({
  position: "fixed",
  bottom: theme.space[4],
  right: theme.space[4],
  zIndex: theme.zIndex.toast,
  display: "flex",
  flexDirection: "column",
  gap: theme.space[2],
  width: "min(24rem, calc(100vw - 2rem))",
  pointerEvents: "none",
});

const itemClass = css({
  pointerEvents: "auto",
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  color: theme.color.cardForeground,
  boxShadow: theme.shadow.lg,
  padding: theme.space[4],
  fontFamily: theme.fontFamily.sans,
  '&[data-state="open"]': {
    animation: `${slideInFromBottom} ${theme.duration.base} ${theme.easing.decelerate}`,
  },
  '&[data-state="closed"]': {
    animation: `${fadeOut} ${theme.duration.fast} ${theme.easing.accelerate}`,
  },
});

const titleClass = css({ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold, margin: 0 });
const descriptionClass = css({
  marginTop: theme.space[1],
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
});

const toneBorderColor: Record<NonNullable<ToastData["tone"]>, string> = {
  default: theme.color.border,
  success: theme.color.success,
  warning: theme.color.warning,
  destructive: theme.color.destructive,
};

function ToastItem({ data }: { data: ToastData }) {
  const [dataState, setDataState] = useState<"open" | "closed">("open");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(data.duration ?? 4000);
  const startedAtRef = useRef(Date.now());

  const close = () => {
    setDataState("closed");
    setTimeout(() => dismissToast(data.id), 150);
  };

  const startTimer = (ms: number) => {
    startedAtRef.current = Date.now();
    timeoutRef.current = setTimeout(close, ms);
  };

  useEffect(() => {
    startTimer(remainingRef.current);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const pause = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    remainingRef.current -= Date.now() - startedAtRef.current;
  };

  const resume = () => {
    startTimer(Math.max(remainingRef.current, 0));
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-state={dataState}
      className={itemClass}
      style={{ borderColor: toneBorderColor[data.tone ?? "default"] }}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {data.title ? <p className={titleClass}>{data.title}</p> : null}
      {data.description ? <p className={descriptionClass}>{data.description}</p> : null}
    </div>
  );
}

/** Mount once near the root. Every toast() call renders here via a portal. */
export function ToastViewport() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const portalNode = usePortal("nexui-toast-viewport");

  if (!portalNode) return null;

  return createPortal(
    <div className={viewportClass}>
      {items.map((item) => (
        <ToastItem key={item.id} data={item} />
      ))}
    </div>,
    portalNode,
  );
}
