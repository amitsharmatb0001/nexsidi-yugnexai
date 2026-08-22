"use client";

import { css, overlayHide, overlayShow, scaleIn, scaleOut, themeVars as theme } from "@yugnex/core";
import { useClickOutside, useEscapeKey, useFocusTrap, usePortal, usePresence } from "@yugnex/core/client";
import { createContext, useContext, useEffect, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext(component: string): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error(`<${component}> must be used within <Modal>`);
  return ctx;
}

/** Read the open state / close handler from inside <ModalContent> — e.g. to build a close button. */
export function useModal(): ModalContextValue {
  return useModalContext("useModal");
}

const overlayClass = css({
  position: "fixed",
  inset: 0,
  zIndex: theme.zIndex.overlay,
  backgroundColor: theme.color.overlay,
  // Blur on top of the (now much heavier) overlay tint — belt and braces
  // against background content ever reading as legible through a modal
  // backdrop again, and a softer, more considered transition than a flat
  // color change alone.
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  '&[data-state="open"]': { animation: `${overlayShow} ${theme.duration.base} ${theme.easing.standard}` },
  '&[data-state="closed"]': { animation: `${overlayHide} ${theme.duration.base} ${theme.easing.standard}` },
});

const contentClass = css({
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: theme.zIndex.modal,
  width: "min(28rem, calc(100vw - 2rem))",
  maxHeight: "calc(100vh - 4rem)",
  overflowY: "auto",
  borderRadius: theme.radius.lg,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  color: theme.color.cardForeground,
  boxShadow: theme.shadow.overlay,
  padding: theme.space[6],
  "&:focus-visible": { outline: "none" },
  '&[data-state="open"]': { animation: `${scaleIn} ${theme.duration.base} ${theme.easing.decelerate}` },
  '&[data-state="closed"]': { animation: `${scaleOut} ${theme.duration.fast} ${theme.easing.accelerate}` },
});

const headerClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1.5],
  marginBottom: theme.space[4],
});
const titleClass = css({ fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.semibold, margin: 0 });
const descriptionClass = css({ fontSize: theme.fontSize.sm, color: theme.color.mutedForeground, margin: 0 });
const footerClass = css({
  display: "flex",
  justifyContent: "flex-end",
  gap: theme.space[2],
  marginTop: theme.space[6],
});

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** Root: owns open state via context. Compose with <ModalContent> (and Header/Title/Description/Footer). */
export function Modal({ open, onOpenChange, children }: ModalProps) {
  return <ModalContext.Provider value={{ open, onOpenChange }}>{children}</ModalContext.Provider>;
}

export interface ModalContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ModalContent({ children, className, ...props }: ModalContentProps) {
  const { open, onOpenChange } = useModalContext("ModalContent");
  const { mounted, dataState } = usePresence(open, { exitDuration: 200 });
  const portalNode = usePortal();
  // Keyed on `mounted`, not `open`: the content node (and its ref) only
  // exists once `mounted` flips true one tick after `open` does, so trapping
  // focus on `open` would fire before there's anything to trap focus in.
  const contentRef = useFocusTrap<HTMLDivElement>(mounted);

  useEscapeKey(() => onOpenChange(false), open);
  useClickOutside(contentRef, () => onOpenChange(false), open);

  useEffect(() => {
    if (!mounted) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mounted]);

  if (!mounted || !portalNode) return null;

  return createPortal(
    <>
      <div className={overlayClass} data-state={dataState} aria-hidden="true" />
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        data-state={dataState}
        tabIndex={-1}
        className={className ? `${contentClass} ${className}` : contentClass}
        {...props}
      >
        {children}
      </div>
    </>,
    portalNode,
  );
}

export function ModalHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `${headerClass} ${className}` : headerClass} {...props} />;
}

export function ModalTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={className ? `${titleClass} ${className}` : titleClass} {...props} />;
}

export function ModalDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={className ? `${descriptionClass} ${className}` : descriptionClass} {...props} />;
}

export function ModalFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `${footerClass} ${className}` : footerClass} {...props} />;
}
