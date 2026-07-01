// @yugnex/nexui — NexBadge Web Component
// Inline status chip for labels, counts, and state indicators.
// Attributes:
//   variant: default | accent | live | success | error | warning | muted
//   size:    sm | md
//   dot:     boolean — shows a pulsing presence dot before the text

import { nexui_compiler } from "../core/compiler";

export class NexBadge extends HTMLElement {
  static get observedAttributes() {
    return ["variant", "size", "dot"];
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

  private render() {
    if (!this.shadowRoot) return;

    const variant  = this.getAttribute("variant") ?? "default";
    const size     = this.getAttribute("size") ?? "md";
    const showDot  = this.getAttribute("dot") === "true";
    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const variantCSS: Record<string, string> = {
      default: `background:var(--nx-bg-elevated,#1C2128); color:var(--nx-text-2,#8B949E); border:1px solid var(--nx-border,rgba(255,255,255,0.08));`,
      accent:  `background:var(--nx-accent-dim,rgba(232,144,16,0.09)); color:var(--nx-accent-text,#F5B342); border:1px solid var(--nx-accent-border,rgba(232,144,16,0.22));`,
      live:    `background:var(--nx-live-dim,rgba(15,212,198,0.09)); color:var(--nx-live,#0FD4C6); border:1px solid var(--nx-live-border,rgba(15,212,198,0.22));`,
      success: `background:var(--nx-success-dim,rgba(34,197,94,0.10)); color:var(--nx-success,#22C55E); border:1px solid rgba(34,197,94,0.25);`,
      error:   `background:var(--nx-error-dim,rgba(239,68,68,0.10)); color:var(--nx-error,#EF4444); border:1px solid rgba(239,68,68,0.25);`,
      warning: `background:var(--nx-warning-dim,rgba(234,179,8,0.10)); color:var(--nx-warning,#EAB308); border:1px solid rgba(234,179,8,0.25);`,
      muted:   `background:rgba(255,255,255,0.04); color:var(--nx-text-3,#6E7681); border:1px solid transparent;`,
    };

    const dotColor: Record<string, string> = {
      default: "var(--nx-text-4,#484F58)",
      accent:  "var(--nx-accent,#E89010)",
      live:    "var(--nx-live,#0FD4C6)",
      success: "var(--nx-success,#22C55E)",
      error:   "var(--nx-error,#EF4444)",
      warning: "var(--nx-warning,#EAB308)",
      muted:   "var(--nx-text-4,#484F58)",
    };

    const sizeCSS = size === "sm"
      ? `font-size:10px; padding:2px 6px; border-radius:4px; gap:4px;`
      : `font-size:11px; padding:3px 8px; border-radius:5px; gap:5px;`;

    const dotSize = size === "sm" ? 5 : 6;

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host {
          display: inline-flex;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          font-family: var(--nx-font-mono, ui-monospace, monospace);
          font-weight: 500;
          letter-spacing: 0.04em;
          white-space: nowrap;
          line-height: 1;
          ${sizeCSS}
          ${variantCSS[variant] ?? variantCSS.default}
        }
        .dot {
          width: ${dotSize}px;
          height: ${dotSize}px;
          border-radius: 50%;
          background: ${dotColor[variant] ?? dotColor.default};
          flex-shrink: 0;
          animation: ${variant === "live" ? "nx-pulse 2s ease-in-out infinite" : "none"};
        }
        @keyframes nx-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      </style>
      <span class="badge" part="badge">
        ${showDot ? '<span class="dot" aria-hidden="true"></span>' : ""}
        <slot></slot>
      </span>
    `;
  }
}
