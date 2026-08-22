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
  border: "none",
  backgroundColor: "rgba(0, 0, 0, 0.4)",
  transitionProperty: "background-color",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  "&:focus-within": {
    border: "none",
    boxShadow: "none",
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

export interface AttachedItem {
  name: string;
  type: string;
  content: string;
}

export interface PromptInputProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onSubmit"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  actions?: ReactNode;
  leading?: ReactNode;
  maxLength?: number;
  minRows?: number;
  isLoading?: boolean;
  onAttachItem?: (item: AttachedItem) => void;
  attachments?: AttachedItem[];
  onRemoveAttachment?: (name: string) => void;
}

/**
 * Borderless prompt input supporting clipboard screenshot paste (Ctrl+V / PrtScn),
 * file attachments (📎), and voice recording (🎤).
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
    onAttachItem,
    attachments = [],
    onRemoveAttachment,
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
      if (!isDisabled && (text.trim() || attachments.length > 0)) onSubmit?.(text);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items || !onAttachItem) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.indexOf("image") !== -1) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = (e) => {
          const content = String(e.target?.result ?? "");
          onAttachItem({
            name: `pasted-screenshot-${Date.now().toString().slice(-4)}.png`,
            type: file.type || "image/png",
            content,
          });
        };
        reader.readAsDataURL(file);
      }
    }
  }

  return (
    <div className={className ? `${shellClass} ${className}` : shellClass} data-disabled={isDisabled || undefined}>
      {/* Attached file & screenshot chips */}
      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
          {attachments.map((att) => (
            <div
              key={att.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "rgba(6, 182, 212, 0.18)",
                border: "1px solid rgba(6, 182, 212, 0.3)",
                color: "#22D3EE",
                fontSize: "11px",
              }}
            >
              <span>{att.type.startsWith("image/") ? "🖼️" : "📄"}</span>
              <span>{att.name}</span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.name)}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", marginLeft: "2px" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={minRows}
        className={textareaClass}
        value={text}
        disabled={isDisabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        {...props}
      />
      <div className={footerClass}>
        <div>{leading}</div>
        <div>{actions}</div>
      </div>
    </div>
  );
});
