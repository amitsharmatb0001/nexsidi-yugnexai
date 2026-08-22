"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useControllableState } from "@yugnex/core/client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

const shellClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[2],
  padding: theme.space[3],
  borderRadius: theme.radius.lg,
  border: `1px solid ${theme.color.input}`,
  backgroundColor: theme.color.card,
  transitionProperty: "border-color, box-shadow",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  "&:focus-within": {
    borderColor: theme.color.ring,
    boxShadow: `0 0 0 3px ${theme.color.accent}`,
  },
  '&[data-disabled="true"]': {
    opacity: 0.6,
    cursor: "not-allowed",
  },
});

const textareaClass = css({
  width: "100%",
  resize: "none",
  border: "none",
  outline: "none",
  background: "transparent",
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  lineHeight: theme.lineHeight.base,
  padding: 0,
  maxHeight: "16rem",
  overflowY: "auto",
  "&::placeholder": { color: theme.color.mutedForeground },
  "&:disabled": { cursor: "not-allowed" },
});

const footerClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: theme.space[2],
});

const hintClass = css({
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const counterOverClass = css({ color: theme.color.destructive });

export interface PromptInputProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onSubmit"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Fired on Enter (without Shift) and by any submit affordance you render in `actions`. */
  onSubmit?: (value: string) => void;
  /** Rendered on the right of the footer — typically a send Button. */
  actions?: ReactNode;
  /** Rendered on the left of the footer — attachments, model picker, etc. */
  leading?: ReactNode;
  /** Show a "characters used" counter and mark it destructive past this length. */
  maxLength?: number;
  /** Rows to start at before auto-growing. */
  minRows?: number;
  isLoading?: boolean;
}

/**
 * The prompt box for a chat or agent UI: auto-grows with content, submits on
 * Enter (Shift+Enter inserts a newline), and exposes footer slots for a send
 * button, attachments, or a model picker.
 */
export const PromptInput = forwardRef<HTMLTextAreaElement, PromptInputProps>(function PromptInput(
  {
    value,
    defaultValue = "",
    onValueChange,
    onSubmit,
    actions,
    leading,
    maxLength,
    minRows = 1,
    isLoading,
    disabled,
    placeholder = "Send a message…",
    onKeyDown,
    className,
    ...props
  },
  ref,
) {
  const [text, setText] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });

  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const isDisabled = disabled || isLoading;

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    // Reset first so the scrollHeight reflects a shrink, not just growth.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [text, resize]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isDisabled && text.trim()) onSubmit?.(text);
    }
  }

  const over = maxLength != null && text.length > maxLength;

  return (
    <div className={className ? `${shellClass} ${className}` : shellClass} data-disabled={isDisabled || undefined}>
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={minRows}
        className={textareaClass}
        value={text}
        placeholder={placeholder}
        disabled={isDisabled}
        aria-busy={isLoading || undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        {...props}
      />
      {actions || leading || maxLength != null ? (
        <div className={footerClass}>
          <div className={hintClass}>{leading}</div>
          <div className={footerClass}>
            {maxLength != null ? (
              <span className={over ? `${hintClass} ${counterOverClass}` : hintClass}>
                {text.length}/{maxLength}
              </span>
            ) : null}
            {actions}
          </div>
        </div>
      ) : null}
    </div>
  );
});
