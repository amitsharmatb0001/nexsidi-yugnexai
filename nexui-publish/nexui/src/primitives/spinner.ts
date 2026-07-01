// @yugnex/nexui — NexSpinner Web Component
// Loading spinner. Lightweight — just CSS animation, no JS after render.
// Attributes:
//   size:  xs | sm | md | lg | xl (default: md)
//   color: accent | live | success | error | muted (default: accent)
//   label: accessible label (default: "Loading")

import { nexui_compiler } from "../core/compiler";

export class NexSpinner extends HTMLElement {
  static get observedAttributes() {
    return ["size", "color", "label"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  private render() {
    if (!this.shadowRoot) return;

    const size    = this.getAttribute("size") ?? "md";
    const color   = this.getAttribute("color") ?? "accent";
    const label   = this.getAttribute("label") ?? "Loading";
    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const szMap: Record<string, { px: number; sw: number }> = {
      xs: { px: 12, sw: 1.5 },
      sm: { px: 16, sw: 2 },
      md: { px: 24, sw: 2.5 },
      lg: { px: 32, sw: 3 },
      xl: { px: 48, sw: 3.5 },
    };
    const { px, sw } = szMap[size] ?? szMap.md;

    const colorMap: Record<string, string> = {
      accent:  "var(--nx-accent, #E89010)",
      live:    "var(--nx-live, #0FD4C6)",
      success: "var(--nx-success, #22C55E)",
      error:   "var(--nx-error, #EF4444)",
      muted:   "var(--nx-text-4, #484F58)",
    };
    const spinColor = colorMap[color] ?? colorMap.accent;

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host { display: inline-flex; align-items: center; justify-content: center; }
        .ring {
          width: ${px}px;
          height: ${px}px;
          border-radius: 50%;
          border: ${sw}px solid rgba(255,255,255,0.08);
          border-top-color: ${spinColor};
          animation: nx-spin 700ms linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ring { animation-duration: 2s; }
        }
        @keyframes nx-spin { to { transform: rotate(360deg); } }
      </style>
      <div class="ring" role="status" aria-label="${label}">
        <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">${label}</span>
      </div>
    `;
  }
}
