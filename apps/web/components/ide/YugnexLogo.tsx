"use client";

/**
 * YugNex mark — three strokes converging to a single point.
 *
 * The convergence is the product idea, not decoration: many independent
 * workstreams resolving into one delivered thing. Drawn on a 24-unit grid so
 * it stays crisp at the 20–22px it is actually used at, with butt caps and a
 * single stroke width so it reads as one continuous form rather than three
 * separate lines.
 */
export default function YugnexLogo({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* Two outer strokes fall inward to the stem's top. */}
      <path
        d="M4 4 L12 13.5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M20 4 L12 13.5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* The stem — what the three become. */}
      <path
        d="M12 13.5 L12 20"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
