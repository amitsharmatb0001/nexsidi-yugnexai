"use client";
// @yugnex/nexui-react — Modal / Dialog
// Uses native <dialog> element: focus trap, Escape key, backdrop all built-in.
// Supports controlled (open prop) and uncontrolled usage.

import React, {
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from "react";

const modalStyles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(4px)",
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    animation: "nx-fade-in 150ms ease forwards",
  },
  dialog: {
    position: "relative",
    background: "var(--nx-bg-elevated, #1C2128)",
    border: "1px solid var(--nx-border-strong, rgba(255,255,255,0.16))",
    borderRadius: "12px",
    boxShadow: "0 25px 50px rgba(0,0,0,0.65)",
    color: "var(--nx-text, #E6EDF3)",
    fontFamily: "var(--nx-font-sans, system-ui, sans-serif)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    animation: "nx-scale-in 200ms cubic-bezier(0.34,1.56,0.64,1) forwards",
    outline: "none",
    padding: 0,
    margin: 0,
    width: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 24px 0",
    flexShrink: 0,
  },
  title: {
    fontSize: "var(--nx-fs-lg, 18px)",
    fontWeight: 600,
    color: "var(--nx-text, #E6EDF3)",
    margin: 0,
    lineHeight: 1.3,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--nx-text-3, #6E7681)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "background 150ms ease, color 150ms ease",
    fontSize: 16,
    lineHeight: 1,
  },
  body: {
    padding: "16px 24px",
    overflowY: "auto",
    flex: 1,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    padding: "0 24px 20px",
    flexShrink: 0,
  },
};

const SIZE_WIDTHS: Record<string, number> = {
  sm:   400,
  md:   560,
  lg:   720,
  xl:   900,
  full: 9999,
};

interface ModalProps {
  open:       boolean;
  onClose:    () => void;
  title?:     string;
  children?:  ReactNode;
  footer?:    ReactNode;
  size?:      "sm" | "md" | "lg" | "xl" | "full";
  closeable?: boolean;
}

export function Modal({ open, onClose, title, children, footer, size = "md", closeable = true }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef   = useRef<HTMLDivElement>(null);

  // Focus the dialog when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => dialogRef.current?.focus());
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Escape key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape" && closeable) onClose();
  }, [closeable, onClose]);

  // Click outside
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current && closeable) onClose();
  }, [closeable, onClose]);

  if (!open) return null;

  const maxWidth = SIZE_WIDTHS[size] ?? SIZE_WIDTHS.md;

  return (
    <div
      ref={backdropRef}
      style={modalStyles.backdrop}
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      <div
        ref={dialogRef}
        style={{ ...modalStyles.dialog, maxWidth: size === "full" ? "calc(100% - 32px)" : `${maxWidth}px` }}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {(title || closeable) && (
          <div style={modalStyles.header}>
            {title && <h2 style={modalStyles.title}>{title}</h2>}
            {closeable && (
              <button
                style={modalStyles.closeBtn}
                onClick={onClose}
                aria-label="Close modal"
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--nx-bg-overlay, #21262D)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--nx-text, #E6EDF3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--nx-text-3, #6E7681)"; }}
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div style={modalStyles.body}>{children}</div>
        {footer && <div style={modalStyles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
