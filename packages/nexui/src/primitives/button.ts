// @yugnex/nexui — NexButton Web Component
// Attributes:
//   variant: primary | secondary | ghost | danger | outline | accent | live
//   size:    sm | md | lg
//   loading: boolean
//   disabled: boolean (native HTML attribute)
//   icon-only: boolean (square aspect ratio)

import { nexui_compiler } from "../core/compiler";

export class NexButton extends HTMLElement {
  private btn: HTMLButtonElement | null = null;

  static get observedAttributes() {
    return ["variant", "size", "loading", "disabled", "icon-only", "type"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.setupDelegation();
  }

  attributeChangedCallback() {
    this.render();
    this.setupDelegation();
  }

  // Forward clicks from the host element to the internal button
  private setupDelegation() {
    this.onclick = (e) => {
      if (this.hasAttribute("disabled") || this.getAttribute("loading") === "true") {
        e.stopImmediatePropagation();
        return;
      }
    };
  }

  private render() {
    if (!this.shadowRoot) return;

    const variant  = this.getAttribute("variant") ?? "primary";
    const size     = this.getAttribute("size") ?? "md";
    const loading  = this.getAttribute("loading") === "true";
    const disabled = this.hasAttribute("disabled") || loading;
    const iconOnly = this.getAttribute("icon-only") === "true";
    const type     = this.getAttribute("type") ?? "button";
    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const sizeStyles: Record<string, string> = {
      sm: `font-size:11px; padding:${iconOnly ? "5px" : "5px 10px"}; min-height:28px; border-radius:5px; gap:6px;`,
      md: `font-size:13px; padding:${iconOnly ? "7px" : "7px 14px"}; min-height:34px; border-radius:6px; gap:8px;`,
      lg: `font-size:14px; padding:${iconOnly ? "9px" : "9px 18px"}; min-height:40px; border-radius:7px; gap:10px;`,
    };

    const variantStyles: Record<string, string> = {
      primary:   `background:var(--nx-accent,#E89010); color:#000; border:none;`,
      secondary: `background:var(--nx-bg-elevated,#1C2128); color:var(--nx-text,#E6EDF3); border:1px solid var(--nx-border-strong,rgba(255,255,255,0.16));`,
      ghost:     `background:transparent; color:var(--nx-text,#E6EDF3); border:none;`,
      outline:   `background:transparent; color:var(--nx-text,#E6EDF3); border:1px solid var(--nx-border-strong,rgba(255,255,255,0.16));`,
      danger:    `background:var(--nx-error,#EF4444); color:#fff; border:none;`,
      accent:    `background:var(--nx-accent-dim,rgba(232,144,16,0.09)); color:var(--nx-accent-text,#F5B342); border:1px solid var(--nx-accent-border,rgba(232,144,16,0.22));`,
      live:      `background:var(--nx-live-dim,rgba(15,212,198,0.09)); color:var(--nx-live,#0FD4C6); border:1px solid var(--nx-live-border,rgba(15,212,198,0.22));`,
    };

    const hoverStyles: Record<string, string> = {
      primary:   `filter:brightness(1.1);`,
      secondary: `background:var(--nx-bg-overlay,#21262D);`,
      ghost:     `background:rgba(255,255,255,0.06);`,
      outline:   `background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.24);`,
      danger:    `filter:brightness(1.1);`,
      accent:    `background:rgba(232,144,16,0.14);`,
      live:      `background:rgba(15,212,198,0.14);`,
    };

    const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host {
          display: inline-block;
        }
        button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--nx-font-sans, system-ui, sans-serif);
          font-weight: 500;
          letter-spacing: 0.01em;
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          text-decoration: none;
          transition: background 150ms ease, color 150ms ease, border-color 150ms ease, filter 150ms ease, opacity 150ms ease, box-shadow 150ms ease;
          ${sizeStyles[size] ?? sizeStyles.md}
          ${variantStyles[variant] ?? variantStyles.primary}
          ${iconOnly ? `aspect-ratio: 1; padding: ${size === "sm" ? "5px" : size === "lg" ? "9px" : "7px"};` : ""}
        }
        button:hover:not(:disabled):not(.loading) {
          ${hoverStyles[variant] ?? ""}
        }
        button:active:not(:disabled):not(.loading) {
          transform: translateY(1px);
          filter: brightness(0.95);
        }
        button:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--nx-bg-base, #0D1117), 0 0 0 4px var(--nx-accent, #E89010);
        }
        button:disabled, button.loading {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .spinner {
          width: ${iconSize}px;
          height: ${iconSize}px;
          border: 1.5px solid transparent;
          border-top-color: currentColor;
          border-radius: 50%;
          animation: nx-spin 600ms linear infinite;
          flex-shrink: 0;
        }
        @keyframes nx-spin {
          to { transform: rotate(360deg); }
        }
        ::slotted(svg) {
          width: ${iconSize}px;
          height: ${iconSize}px;
          flex-shrink: 0;
        }
      </style>
      <button
        type="${type}"
        ${disabled ? "disabled" : ""}
        ${loading ? 'class="loading"' : ""}
        part="button"
      >
        ${loading ? '<span class="spinner" aria-hidden="true"></span>' : ""}
        <slot></slot>
      </button>
    `;
    this.btn = this.shadowRoot.querySelector("button");
  }
}
