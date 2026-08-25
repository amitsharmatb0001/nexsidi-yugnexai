"use client";

import { mockup as s } from "./DesignMockupPreview.styles";

interface PaletteColor {
  name: string;
  hex: string;
}

interface DesignBrief {
  mood?: string;
  palette?: PaletteColor[];
  typography?: { display?: string; body?: string };
  layoutConcept?: string;
}

// Workstream 3 (2026-08-24): root cause — the spec-approval gate showed
// design tokens as text and color swatches (PlanPreview.tsx's own "Design
// Direction" section) but never an actual rendered picture. You approved a
// DESCRIPTION of a design, never a look at one. This renders a small,
// honestly-labeled illustrative mockup — nav, hero, three content cards —
// styled with the REAL locked hex values and font names, so there is
// something to actually look at before code generation starts.
//
// Palette entries don't follow one fixed naming scheme (Vanya's own doctrine
// asks for names like "ink"/"accent"/"surface" but doesn't guarantee them),
// so role resolution below is a best-effort keyword match, not a contract.
function resolveRole(palette: PaletteColor[], keywords: string[], fallbackIndex: number): string {
  for (const kw of keywords) {
    const exact = palette.find((c) => c.name.toLowerCase() === kw);
    if (exact) return exact.hex;
  }
  for (const kw of keywords) {
    const hit = palette.find((c) => c.name.toLowerCase().includes(kw));
    if (hit) return hit.hex;
  }
  return palette[fallbackIndex]?.hex ?? palette[0]?.hex ?? "#8892a0";
}

export default function DesignMockupPreview({ design }: { design: DesignBrief }) {
  const palette = design.palette ?? [];
  if (palette.length < 2) return null; // not enough tokens to render anything honest

  const bg = resolveRole(palette, ["background", "paper", "surface", "bg", "ground"], palette.length > 1 ? 1 : 0);
  const ink = resolveRole(palette, ["ink", "text", "foreground", "fg"], 0);
  const accent = resolveRole(palette, ["accent"], Math.min(2, palette.length - 1));
  const border = resolveRole(palette, ["border", "muted", "subtle"], palette.length - 1);
  const displayFont = design.typography?.display ? `"${design.typography.display}", sans-serif` : "inherit";
  const bodyFont = design.typography?.body ? `"${design.typography.body}", serif` : "inherit";

  return (
    <div className={s.frame}>
      <div className={s.frameLabel}>
        <span className={s.frameLabelDot} />
        Illustrative layout — rendered from your locked tokens, not final copy
      </div>

      <div className={s.canvas} style={{ background: bg, borderColor: border }}>
        <div className={s.nav} style={{ borderColor: border }}>
          <div className={s.navBrand}>
            <span className={s.navDot} style={{ background: accent }} />
            <span style={{ color: ink, fontFamily: displayFont }}>Brand</span>
          </div>
          <div className={s.navLinks} style={{ color: ink }}>
            <span>Product</span>
            <span>Pricing</span>
            <span>About</span>
          </div>
          <span className={s.navCta} style={{ background: accent }}>Get started</span>
        </div>

        <div className={s.hero}>
          <div className={s.heroHeading} style={{ color: ink, fontFamily: displayFont }}>
            This is your headline
          </div>
          <div className={s.heroBody} style={{ color: ink, fontFamily: bodyFont }}>
            A supporting line of body copy, set in the locked body typeface, showing how paragraph text reads against this background.
          </div>
          <span className={s.heroCta} style={{ background: accent }}>Primary action</span>
        </div>

        <div className={s.cardRow}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={s.card} style={{ borderColor: border }}>
              <div className={s.cardTitle} style={{ color: ink, fontFamily: displayFont }}>Card {i + 1}</div>
              <div className={s.cardBody} style={{ color: ink, fontFamily: bodyFont }}>
                Body text sample.
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
