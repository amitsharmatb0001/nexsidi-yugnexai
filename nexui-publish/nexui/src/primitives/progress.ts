// @yugnex/nexui — NexProgress Web Component
// Linear and circular progress indicators.
// Attributes:
//   value:    0-100 (default 0). Omit for indeterminate.
//   variant:  linear | circular (default: linear)
//   size:     sm | md | lg
//   color:    accent | live | success | error | warning (default: accent)
//   label:    string — accessible label
//   show-value: boolean — renders the percentage text

import { nexui_compiler } from "../core/compiler";

export class NexProgress extends HTMLElement {
  static get observedAttributes() {
    return ["value", "variant", "size", "color", "label", "show-value"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  private render() {
    if (!this.shadowRoot) return;

    const rawVal     = this.getAttribute("value");
    const value      = rawVal !== null ? Math.min(100, Math.max(0, parseFloat(rawVal))) : null;
    const variant    = this.getAttribute("variant") ?? "linear";
    const size       = this.getAttribute("size") ?? "md";
    const color      = this.getAttribute("color") ?? "accent";
    const label      = this.getAttribute("label") ?? "Progress";
    const showValue  = this.getAttribute("show-value") === "true";
    const indeterminate = value === null;
    const themeCSS   = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const colorMap: Record<string, string> = {
      accent:  "var(--nx-accent, #E89010)",
      live:    "var(--nx-live, #0FD4C6)",
      success: "var(--nx-success, #22C55E)",
      error:   "var(--nx-error, #EF4444)",
      warning: "var(--nx-warning, #EAB308)",
    };
    const fillColor = colorMap[color] ?? colorMap.accent;

    if (variant === "circular") {
      const szMap = { sm: 32, md: 48, lg: 64 };
      const sz = szMap[size as keyof typeof szMap] ?? 48;
      const r  = (sz / 2) - 4;
      const circ = 2 * Math.PI * r;
      const offset = indeterminate ? circ * 0.25 : circ - (value! / 100) * circ;

      this.shadowRoot.innerHTML = `
        <style>
          ${themeCSS}
          :host { display: inline-flex; align-items: center; gap: 8px; }
          .arc {
            transition: stroke-dashoffset 400ms cubic-bezier(0,0,0.2,1);
            transform-origin: center;
            transform: rotate(-90deg);
          }
          .indeterminate { animation: nx-spin-arc 1.4s linear infinite; }
          @keyframes nx-spin-arc { to { transform: rotate(270deg); } }
          .val { font-family: var(--nx-font-mono, monospace); font-size: ${Math.round(sz * 0.22)}px; fill: var(--nx-text, #E6EDF3); }
        </style>
        <svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" aria-label="${label}${value !== null ? `: ${value}%` : ""}" role="progressbar" aria-valuenow="${value ?? ""}" aria-valuemin="0" aria-valuemax="100">
          <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="var(--nx-border, rgba(255,255,255,0.08))" stroke-width="4"/>
          <circle class="arc${indeterminate ? " indeterminate" : ""}" cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none"
            stroke="${fillColor}" stroke-width="4" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
          ${showValue && !indeterminate ? `<text class="val" x="${sz/2}" y="${sz/2 + sz * 0.08}" text-anchor="middle" font-weight="600">${Math.round(value!)}%</text>` : ""}
        </svg>
        ${showValue && !indeterminate ? "" : ""}
      `;
    } else {
      const hMap = { sm: "3px", md: "5px", lg: "8px" };
      const h = hMap[size as keyof typeof hMap] ?? "5px";

      this.shadowRoot.innerHTML = `
        <style>
          ${themeCSS}
          :host { display: block; }
          .track {
            width: 100%;
            height: ${h};
            background: var(--nx-border, rgba(255,255,255,0.08));
            border-radius: 9999px;
            overflow: hidden;
          }
          .fill {
            height: 100%;
            background: ${fillColor};
            border-radius: 9999px;
            transition: width 400ms cubic-bezier(0,0,0.2,1);
            ${indeterminate ? `animation: nx-indeterminate 1.6s ease-in-out infinite; width: 40%;` : `width: ${value}%;`}
          }
          .label-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-family: var(--nx-font-sans, system-ui); font-size: 11px; color: var(--nx-text-3, #6E7681); }
          @keyframes nx-indeterminate {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        </style>
        <div role="progressbar" aria-label="${label}" aria-valuenow="${value ?? ""}" aria-valuemin="0" aria-valuemax="100">
          ${label || showValue ? `<div class="label-row"><span>${label}</span>${showValue && !indeterminate ? `<span>${Math.round(value!)}%</span>` : ""}</div>` : ""}
          <div class="track"><div class="fill"></div></div>
        </div>
      `;
    }
  }
}
