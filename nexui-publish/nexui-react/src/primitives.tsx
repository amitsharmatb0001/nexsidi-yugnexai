"use client";
// @yugnex/nexui-react — Web Component Wrappers
// Thin typed React wrappers for every @yugnex/nexui Web Component.
// Each wrapper:
//   • Declares proper TypeScript prop types
//   • Forwards refs to the underlying DOM element
//   • Handles imperative APIs (e.g. TextStream.pushLogTrace)
//   • Bridges React synthetic events ↔ Web Component custom events

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from "react";

// ─── JSX type augmentation so nex-* tags work in TSX ──────────────────────
// Full-system audit finding (2026-07-04): React 19 moved the JSX namespace
// out of the global scope and into the `react` module itself. Augmenting
// `declare global { namespace JSX }` (the React 18-era pattern this used to
// use) silently fails to merge with React 19's types — consumers on React
// 19 got "Property 'nex-panel' does not exist on type JSX.IntrinsicElements"
// and Claude Sonnet 5 had to rediscover and hand-write this exact same
// augmentation, under `declare module "react"`, in the generated project's
// own types/ dir, on multiple independent stress-test runs (2026-07-03/04).
// Fixing it once here means every future generated project gets it correct
// out of the vendored package instead of re-solving the same bug per project.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "nex-panel":       any;
      "nex-button":      any;
      "nex-badge":       any;
      "nex-input":       any;
      "nex-avatar":      any;
      "nex-status-ring": any;
      "nex-text-stream": any;
      "nex-progress":    any;
      "nex-switch":      any;
      "nex-checkbox":    any;
      "nex-skeleton":    any;
      "nex-separator":   any;
      "nex-spinner":     any;
    }
  }
}

// ─── Panel ────────────────────────────────────────────────────────────────
interface NexPanelProps {
  variant?:   "void" | "base" | "surface" | "elevated" | "overlay" | "accent" | "live" | "success" | "error" | "warning";
  padding?:   "none" | "xs" | "sm" | "md" | "lg" | "xl";
  elevation?: "0" | "1" | "2" | "3" | "4";
  matrix?:    string;
  className?: string;
  children?:  ReactNode;
  style?:     React.CSSProperties;
}
export const Panel = forwardRef<HTMLElement, NexPanelProps>(
  ({ children, ...props }, ref) => (
    <nex-panel ref={ref as any} {...props}>{children}</nex-panel>
  )
);
Panel.displayName = "Panel";

// ─── Button ───────────────────────────────────────────────────────────────
interface NexButtonProps {
  variant?:   "primary" | "secondary" | "ghost" | "danger" | "outline" | "accent" | "live";
  size?:      "sm" | "md" | "lg";
  loading?:   boolean;
  disabled?:  boolean;
  "icon-only"?: boolean;
  type?:      "button" | "submit" | "reset";
  className?: string;
  children?:  ReactNode;
  onClick?:   React.MouseEventHandler<HTMLElement>;
  style?:     React.CSSProperties;
}
export const Button = forwardRef<HTMLElement, NexButtonProps>(
  ({ loading, "icon-only": iconOnly, children, ...props }, ref) => (
    <nex-button
      ref={ref as any}
      loading={loading ? "true" : undefined}
      icon-only={iconOnly ? "true" : undefined}
      {...props}
    >
      {children}
    </nex-button>
  )
);
Button.displayName = "Button";

// ─── Badge ────────────────────────────────────────────────────────────────
interface NexBadgeProps {
  variant?:  "default" | "accent" | "live" | "success" | "error" | "warning" | "muted";
  size?:     "sm" | "md";
  dot?:      boolean;
  className?: string;
  children?:  ReactNode;
  style?:     React.CSSProperties;
}
export const Badge = forwardRef<HTMLElement, NexBadgeProps>(
  ({ dot, children, ...props }, ref) => (
    <nex-badge ref={ref as any} dot={dot ? "true" : undefined} {...props}>
      {children}
    </nex-badge>
  )
);
Badge.displayName = "Badge";

// ─── Input ────────────────────────────────────────────────────────────────
interface NexInputProps {
  type?:        string;
  label?:       string;
  placeholder?: string;
  helper?:      string;
  error?:       string;
  size?:        "sm" | "md" | "lg";
  disabled?:    boolean;
  required?:    boolean;
  value?:       string;
  className?:   string;
  onChange?:    React.ChangeEventHandler<HTMLInputElement>;
  onInput?:     React.FormEventHandler<HTMLInputElement>;
  onFocus?:     React.FocusEventHandler<HTMLInputElement>;
  onBlur?:      React.FocusEventHandler<HTMLInputElement>;
  style?:       React.CSSProperties;
}
export const Input = forwardRef<HTMLElement, NexInputProps>(
  ({ onChange, onInput, onFocus, onBlur, ...props }, ref) => {
    const elRef = useRef<HTMLElement>(null);
    useImperativeHandle(ref, () => elRef.current!);

    useEffect(() => {
      const el = elRef.current;
      if (!el) return;
      const handlers: Array<[string, EventListener]> = [];
      if (onChange) { const h = (e: Event) => onChange(e as any); el.addEventListener("change", h); handlers.push(["change", h]); }
      if (onInput)  { const h = (e: Event) => onInput(e as any);  el.addEventListener("input",  h); handlers.push(["input",  h]); }
      if (onFocus)  { const h = (e: Event) => onFocus(e as any);  el.addEventListener("focus",  h); handlers.push(["focus",  h]); }
      if (onBlur)   { const h = (e: Event) => onBlur(e as any);   el.addEventListener("blur",   h); handlers.push(["blur",   h]); }
      return () => handlers.forEach(([ev, h]) => el.removeEventListener(ev, h));
    }, [onChange, onInput, onFocus, onBlur]);

    return <nex-input ref={elRef as any} {...props} />;
  }
);
Input.displayName = "Input";

// ─── Avatar ───────────────────────────────────────────────────────────────
interface NexAvatarProps {
  src?:       string;
  name?:      string;
  size?:      "xs" | "sm" | "md" | "lg" | "xl";
  status?:    "online" | "away" | "busy" | "offline";
  shape?:     "circle" | "square";
  className?: string;
  style?:     React.CSSProperties;
}
export const Avatar = forwardRef<HTMLElement, NexAvatarProps>(
  (props, ref) => <nex-avatar ref={ref as any} {...props} />
);
Avatar.displayName = "Avatar";

// ─── StatusRing ───────────────────────────────────────────────────────────
interface NexStatusRingProps {
  score?:     number;
  label?:     string;
  color?:     string;
  size?:      number;
  className?: string;
  style?:     React.CSSProperties;
}
export const StatusRing = forwardRef<HTMLElement, NexStatusRingProps>(
  ({ score, size, ...props }, ref) => (
    <nex-status-ring
      ref={ref as any}
      score={score !== undefined ? String(score) : undefined}
      size={size !== undefined ? String(size) : undefined}
      {...props}
    />
  )
);
StatusRing.displayName = "StatusRing";

// ─── TextStream — imperative ref API ──────────────────────────────────────
export interface TextStreamHandle {
  push:  (msg: string) => void;
  batch: (msgs: string[]) => void;
  clear: () => void;
}
interface NexTextStreamProps {
  maxRows?:     number;
  showNumbers?: boolean;
  className?:   string;
  style?:       React.CSSProperties;
}
export const TextStream = forwardRef<TextStreamHandle, NexTextStreamProps>(
  ({ maxRows, showNumbers, ...props }, ref) => {
    const elRef = useRef<any>(null);
    useImperativeHandle(ref, () => ({
      push:  (msg: string) => elRef.current?.pushLogTrace(msg),
      batch: (msgs: string[]) => elRef.current?.pushBatch(msgs),
      clear: () => elRef.current?.clear(),
    }));
    return (
      <nex-text-stream
        ref={elRef}
        max-rows={maxRows !== undefined ? String(maxRows) : undefined}
        show-numbers={showNumbers === false ? "false" : undefined}
        {...props}
      />
    );
  }
);
TextStream.displayName = "TextStream";

// ─── Progress ─────────────────────────────────────────────────────────────
interface NexProgressProps {
  value?:      number;
  variant?:    "linear" | "circular";
  size?:       "sm" | "md" | "lg";
  color?:      "accent" | "live" | "success" | "error" | "warning";
  label?:      string;
  "show-value"?: boolean;
  className?:  string;
  style?:      React.CSSProperties;
}
export const Progress = forwardRef<HTMLElement, NexProgressProps>(
  ({ value, "show-value": showVal, ...props }, ref) => (
    <nex-progress
      ref={ref as any}
      value={value !== undefined ? String(value) : undefined}
      show-value={showVal ? "true" : undefined}
      {...props}
    />
  )
);
Progress.displayName = "Progress";

// ─── Switch ───────────────────────────────────────────────────────────────
interface NexSwitchProps {
  checked?:   boolean;
  disabled?:  boolean;
  label?:     string;
  size?:      "sm" | "md" | "lg";
  color?:     "accent" | "live" | "success";
  className?: string;
  onChange?:  (checked: boolean) => void;
  style?:     React.CSSProperties;
}
export const Switch = forwardRef<HTMLElement, NexSwitchProps>(
  ({ checked, onChange, ...props }, ref) => {
    const elRef = useRef<HTMLElement>(null);
    useImperativeHandle(ref, () => elRef.current!);
    useEffect(() => {
      const el = elRef.current;
      if (!el || !onChange) return;
      const h = (e: Event) => onChange((e as CustomEvent).detail.checked);
      el.addEventListener("change", h);
      return () => el.removeEventListener("change", h);
    }, [onChange]);
    return (
      <nex-switch
        ref={elRef as any}
        checked={checked ? "" : undefined}
        {...props}
      />
    );
  }
);
Switch.displayName = "Switch";

// ─── Checkbox ─────────────────────────────────────────────────────────────
interface NexCheckboxProps {
  checked?:       boolean;
  indeterminate?: boolean;
  disabled?:      boolean;
  label?:         string;
  size?:          "sm" | "md" | "lg";
  className?:     string;
  onChange?:      (checked: boolean) => void;
  style?:         React.CSSProperties;
}
export const Checkbox = forwardRef<HTMLElement, NexCheckboxProps>(
  ({ checked, indeterminate, onChange, ...props }, ref) => {
    const elRef = useRef<HTMLElement>(null);
    useImperativeHandle(ref, () => elRef.current!);
    useEffect(() => {
      const el = elRef.current;
      if (!el || !onChange) return;
      const h = (e: Event) => onChange((e as CustomEvent).detail.checked);
      el.addEventListener("change", h);
      return () => el.removeEventListener("change", h);
    }, [onChange]);
    return (
      <nex-checkbox
        ref={elRef as any}
        checked={checked ? "" : undefined}
        indeterminate={indeterminate ? "" : undefined}
        {...props}
      />
    );
  }
);
Checkbox.displayName = "Checkbox";

// ─── Skeleton ─────────────────────────────────────────────────────────────
interface NexSkeletonProps {
  variant?:  "text" | "circle" | "rect";
  width?:    string;
  height?:   string;
  lines?:    number;
  animate?:  boolean;
  className?: string;
  style?:    React.CSSProperties;
}
export const Skeleton = forwardRef<HTMLElement, NexSkeletonProps>(
  ({ lines, animate, ...props }, ref) => (
    <nex-skeleton
      ref={ref as any}
      lines={lines !== undefined ? String(lines) : undefined}
      animate={animate === false ? "false" : undefined}
      {...props}
    />
  )
);
Skeleton.displayName = "Skeleton";

// ─── Separator ────────────────────────────────────────────────────────────
interface NexSeparatorProps {
  orientation?: "horizontal" | "vertical";
  variant?:     "default" | "strong" | "muted";
  label?:       string;
  className?:   string;
  style?:       React.CSSProperties;
}
export const Separator = forwardRef<HTMLElement, NexSeparatorProps>(
  (props, ref) => <nex-separator ref={ref as any} {...props} />
);
Separator.displayName = "Separator";

// ─── Spinner ──────────────────────────────────────────────────────────────
interface NexSpinnerProps {
  size?:      "xs" | "sm" | "md" | "lg" | "xl";
  color?:     "accent" | "live" | "success" | "error" | "muted";
  label?:     string;
  className?: string;
  style?:     React.CSSProperties;
}
export const Spinner = forwardRef<HTMLElement, NexSpinnerProps>(
  (props, ref) => <nex-spinner ref={ref as any} {...props} />
);
Spinner.displayName = "Spinner";
