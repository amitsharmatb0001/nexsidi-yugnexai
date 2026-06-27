// @yugnex/nexui — NexSeparator Web Component
// Horizontal or vertical divider line.
// Attributes:
//   orientation: horizontal | vertical (default: horizontal)
//   variant:     default | strong | muted (default: default)
//   label:       string — centered label text

import { nexui_compiler } from "../core/compiler";

export class NexSeparator extends HTMLElement {
  static get observedAttributes() {
    return ["orientation", "variant", "label"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  private render() {
    if (!this.shadowRoot) return;

    const orientation = this.getAttribute("orientation") ?? "horizontal";
    const variant     = this.getAttribute("variant") ?? "default";
    const label       = this.getAttribute("label") ?? "";
    const themeCSS    = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const colorMap: Record<string, string> = {
      default: "var(--nx-border, rgba(255,255,255,0.08))",
      strong:  "var(--nx-border-strong, rgba(255,255,255,0.16))",
      muted:   "rgba(255,255,255,0.04)",
    };
    const borderColor = colorMap[variant] ?? colorMap.default;

    if (orientation === "vertical") {
      this.shadowRoot.innerHTML = `
        <style>
          ${themeCSS}
          :host { display: inline-block; width: 1px; align-self: stretch; }
          .line { width: 1px; height: 100%; background: ${borderColor}; }
        </style>
        <div class="line" role="separator" aria-orientation="vertical"></div>
      `;
    } else if (label) {
      this.shadowRoot.innerHTML = `
        <style>
          ${themeCSS}
          :host { display: block; }
          .row { display: flex; align-items: center; gap: 12px; }
          .line { flex: 1; height: 1px; background: ${borderColor}; }
          .text { font-family: var(--nx-font-sans, system-ui); font-size: 11px; font-weight: 500; color: var(--nx-text-4, #484F58); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
        </style>
        <div class="row" role="separator">
          <div class="line"></div>
          <span class="text">${label}</span>
          <div class="line"></div>
        </div>
      `;
    } else {
      this.shadowRoot.innerHTML = `
        <style>
          ${themeCSS}
          :host { display: block; }
          .line { width: 100%; height: 1px; background: ${borderColor}; }
        </style>
        <div class="line" role="separator" aria-orientation="horizontal"></div>
      `;
    }
  }
}
