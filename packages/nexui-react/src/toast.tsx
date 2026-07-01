"use client";
// @yugnex/nexui-react — Toast / Toaster
// Zero external deps. React context-based queue.
//
// Setup (app/layout.tsx):
//   <NexuiProvider><Toaster />{children}</NexuiProvider>
//
// Usage anywhere:
//   const { toast } = useToast();
//   toast.success("Saved!");
//   toast.error("Something went wrong");
//   toast("Custom message", { variant: "accent", duration: 5000 });

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";

export type ToastVariant = "default" | "success" | "error" | "warning" | "accent" | "live";

export interface ToastItem {
  id:        string;
  message:   ReactNode;
  variant:   ToastVariant;
  duration:  number;
  createdAt: number;
}

interface ToastContextValue {
  toasts:   ToastItem[];
  add:      (message: ReactNode, opts?: Partial<Pick<ToastItem, "variant" | "duration">>) => string;
  remove:   (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  add:    () => "",
  remove: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const add = useCallback((message: ReactNode, opts?: Partial<Pick<ToastItem, "variant" | "duration">>): string => {
    const id = `nx-toast-${++counter.current}`;
    const item: ToastItem = {
      id,
      message,
      variant:  opts?.variant  ?? "default",
      duration: opts?.duration ?? 4000,
      createdAt: Date.now(),
    };
    setToasts(prev => [item, ...prev].slice(0, 5));
    if (item.duration > 0) {
      setTimeout(() => remove(id), item.duration);
    }
    return id;
  }, [remove]);

  return (
    <ToastContext.Provider value={{ toasts, add, remove }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const { add, remove } = useContext(ToastContext);
  return {
    toast: Object.assign(
      (msg: ReactNode, opts?: Partial<Pick<ToastItem, "variant" | "duration">>) => add(msg, opts),
      {
        success: (msg: ReactNode, opts?: Partial<Pick<ToastItem, "duration">>) => add(msg, { ...opts, variant: "success" }),
        error:   (msg: ReactNode, opts?: Partial<Pick<ToastItem, "duration">>) => add(msg, { ...opts, variant: "error" }),
        warning: (msg: ReactNode, opts?: Partial<Pick<ToastItem, "duration">>) => add(msg, { ...opts, variant: "warning" }),
        accent:  (msg: ReactNode, opts?: Partial<Pick<ToastItem, "duration">>) => add(msg, { ...opts, variant: "accent" }),
        live:    (msg: ReactNode, opts?: Partial<Pick<ToastItem, "duration">>) => add(msg, { ...opts, variant: "live" }),
        dismiss: remove,
      }
    ),
  };
}

const VARIANT_STYLES: Record<ToastVariant, CSSProperties> = {
  default: { borderColor: "var(--nx-border-strong, rgba(255,255,255,0.16))" },
  success: { borderColor: "rgba(34,197,94,0.35)",   color: "var(--nx-success, #22C55E)" },
  error:   { borderColor: "rgba(239,68,68,0.35)",   color: "var(--nx-error,   #EF4444)" },
  warning: { borderColor: "rgba(234,179,8,0.35)",   color: "var(--nx-warning, #EAB308)" },
  accent:  { borderColor: "var(--nx-accent-border, rgba(232,144,16,0.22))", color: "var(--nx-accent-text, #F5B342)" },
  live:    { borderColor: "var(--nx-live-border, rgba(15,212,198,0.22))",   color: "var(--nx-live,    #0FD4C6)" },
};

function ToastItem({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        background: "var(--nx-bg-elevated, #1C2128)",
        border: "1px solid",
        borderRadius: 8,
        boxShadow: "0 10px 15px rgba(0,0,0,0.50), 0 4px 6px rgba(0,0,0,0.30)",
        fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
        fontSize: "var(--nx-fs-sm, 12px)",
        color: "var(--nx-text, #E6EDF3)",
        maxWidth: 380,
        width: "100%",
        transform: visible ? "translateY(0)" : "translateY(8px)",
        opacity: visible ? 1 : 0,
        transition: "transform 200ms ease, opacity 200ms ease",
        ...VARIANT_STYLES[item.variant],
      }}
    >
      <span style={{ flex: 1, lineHeight: 1.5 }}>{item.message}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "var(--nx-text-4, #484F58)",
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
          marginTop: 1,
        }}
      >✕</button>
    </div>
  );
}

export function Toaster() {
  const { toasts, remove } = useContext(ToastContext);

  return (
    <div
      aria-label="Notifications"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: "auto" }}>
          <ToastItem item={t} onClose={() => remove(t.id)} />
        </div>
      ))}
    </div>
  );
}
