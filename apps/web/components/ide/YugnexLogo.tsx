"use client";

// The real YugNex mark (public/brand/yugnex-mark.png — the gold arch-and-N
// monogram, sourced from yugnex-website's own asset set) with a soft
// breathing halo behind it. Replaces the earlier placeholder line-drawing
// that stood in before the brand asset was available.
import { logo as s } from "./YugnexLogo.styles";

export default function YugnexLogo({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <span className={s.mark} style={{ width: size, height: size }}>
      <span className={s.halo} aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local
          brand asset at small fixed sizes; next/image's overhead buys nothing here. */}
      <img
        src="/brand/yugnex-mark.png"
        alt={title ?? ""}
        role={title ? "img" : "presentation"}
        aria-hidden={title ? undefined : true}
        width={size}
        height={size}
        className={s.img}
        style={{ width: size, height: size }}
      />
    </span>
  );
}
