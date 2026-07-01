// @yugnex/nexui — NexPanel Web Component
// A themed container that uses the LayoutMatrix bitmask system.
// Shadow DOM safe: injects theme vars + compiled matrix CSS into its own shadow root.

import { nexui_compiler } from "../core/compiler";
import { LayoutMatrix } from "../core/matrix";

export class NexPanel extends HTMLElement {
  static get observedAttributes() {
    return ["matrix", "variant", "padding", "elevation"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  private getMask(): number {
    const raw = this.getAttribute("matrix");
    if (raw !== null) return parseInt(raw, 16);

    // Build from convenience attributes if matrix is not set
    let mask = 0;
    const padding = this.getAttribute("padding") ?? "md";
    const padMap: Record<string, number> = {
      none: LayoutMatrix.PAD_NONE, xs: LayoutMatrix.PAD_XS,
      sm: LayoutMatrix.PAD_SM, md: LayoutMatrix.PAD_MD,
      lg: LayoutMatrix.PAD_LG, xl: LayoutMatrix.PAD_XL,
    };
    mask |= padMap[padding] ?? LayoutMatrix.PAD_MD;
    return mask;
  }

  private render() {
    if (!this.shadowRoot) return;

    const mask     = this.getMask();
    const variant  = this.getAttribute("variant") ?? "base";
    const elevation = this.getAttribute("elevation") ?? "0";

    const bgMap: Record<string, string> = {
      "void":     "var(--nx-bg-void)",
      "base":     "var(--nx-bg-base)",
      "surface":  "var(--nx-bg-surface)",
      "elevated": "var(--nx-bg-elevated)",
      "overlay":  "var(--nx-bg-overlay)",
      "accent":   "var(--nx-accent-dim)",
      "live":     "var(--nx-live-dim)",
      "success":  "var(--nx-success-dim)",
      "error":    "var(--nx-error-dim)",
      "warning":  "var(--nx-warning-dim)",
    };

    const shadowMap: Record<string, string> = {
      "0": "none",
      "1": "0 1px 3px rgba(0,0,0,0.50)",
      "2": "0 4px 6px rgba(0,0,0,0.40), 0 2px 4px rgba(0,0,0,0.30)",
      "3": "0 10px 15px rgba(0,0,0,0.50), 0 4px 6px rgba(0,0,0,0.30)",
      "4": "0 20px 25px rgba(0,0,0,0.55), 0 8px 10px rgba(0,0,0,0.30)",
    };

    const matrixCSS  = nexui_compiler.compileBitmaskToString(mask);
    const matrixClass = `nx-m-${mask.toString(16).toUpperCase()}`;
    const themeCSS   = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        ${matrixCSS}
        :host {
          display: block;
        }
        .panel {
          background: ${bgMap[variant] ?? bgMap["base"]};
          border: 1px solid var(--nx-border);
          border-radius: 8px;
          box-shadow: ${shadowMap[elevation] ?? "none"};
          color: var(--nx-text);
          font-family: var(--nx-font-sans, system-ui, sans-serif);
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        .panel[data-variant="elevated"] {
          border-color: var(--nx-border-strong);
        }
        .panel[data-variant="accent"] {
          border-color: var(--nx-accent-border);
        }
        .panel[data-variant="live"] {
          border-color: var(--nx-live-border);
        }
        .panel[data-variant="error"] {
          border-color: var(--nx-error-dim);
        }
        .panel[data-variant="success"] {
          border-color: var(--nx-success-dim);
        }
      </style>
      <div class="panel ${matrixClass}" data-variant="${variant}">
        <slot></slot>
      </div>
    `;
  }
}
