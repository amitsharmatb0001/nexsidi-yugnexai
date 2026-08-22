"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { forwardRef, useState, type HTMLAttributes } from "react";

type AvatarStatus = "loading" | "loaded" | "error";

const rootClass = css({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  borderRadius: theme.radius.full,
  backgroundColor: theme.color.muted,
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.sans,
  fontWeight: theme.fontWeight.medium,
  userSelect: "none",
  flexShrink: 0,
});

const imgClass = css({
  width: "100%",
  height: "100%",
  objectFit: "cover",
});

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: number;
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { src, alt = "", fallback, size = 40, className, style, ...props },
  ref,
) {
  const [status, setStatus] = useState<AvatarStatus>(src ? "loading" : "error");

  return (
    <span
      ref={ref}
      className={className ? `${rootClass} ${className}` : rootClass}
      style={{ width: size, height: size, fontSize: size * 0.4, ...style }}
      {...props}
    >
      {src && status !== "error" ? (
        <img
          src={src}
          alt={alt}
          className={imgClass}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          style={{ display: status === "loaded" ? "block" : "none" }}
        />
      ) : null}
      {status !== "loaded" ? (
        <span aria-hidden={Boolean(alt)}>{fallback ?? alt.slice(0, 2).toUpperCase()}</span>
      ) : null}
    </span>
  );
});
