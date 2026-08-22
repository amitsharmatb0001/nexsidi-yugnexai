"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { forwardRef, type HTMLAttributes } from "react";

const cardClass = css({
  borderRadius: theme.radius.lg,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  color: theme.color.cardForeground,
  boxShadow: theme.shadow.sm,
});

const headerClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1.5],
  padding: theme.space[6],
});

const titleClass = css({
  fontSize: theme.fontSize.lg,
  fontWeight: theme.fontWeight.semibold,
  lineHeight: theme.lineHeight.lg,
  margin: 0,
});

const descriptionClass = css({
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
  margin: 0,
});

const bodyClass = css({
  padding: theme.space[6],
  paddingTop: 0,
});

const footerClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  padding: theme.space[6],
  paddingTop: 0,
});

function mergeClass(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={mergeClass(cardClass, className)} {...props} />;
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={mergeClass(headerClass, className)} {...props} />;
});

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function CardTitle(
  { className, ...props },
  ref,
) {
  return <h3 ref={ref} className={mergeClass(titleClass, className)} {...props} />;
});

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return <p ref={ref} className={mergeClass(descriptionClass, className)} {...props} />;
  },
);

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardBody(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={mergeClass(bodyClass, className)} {...props} />;
});

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={mergeClass(footerClass, className)} {...props} />;
});
