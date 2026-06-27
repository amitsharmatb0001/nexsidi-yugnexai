// @yugnex/nexui — NexSwitch Web Component
// Toggle switch with label and ARIA.
// Attributes:
//   checked:  boolean
//   disabled: boolean
//   label:    string
//   size:     sm | md | lg
//   color:    accent | live | success (default: accent)

import { nexui_compiler } from "../core/compiler";

export class NexSwitch extends HTMLElement {
  private _checked = false;

  static get observedAttributes() {
    return ["checked", "disabled", "label", "size", "color"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._checked = this.hasAttribute("checked");
    this.render();
    this.shadowRoot?.querySelector(".track")?.addEventListener("click", () => this.toggle());
    this.shadowRoot?.querySelector(".track")?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === " " || (e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  attributeChangedCallback(name: string, _old: string, val: string) {
    if (name === "checked") this._checked = val !== null;
    this.render();
  }

  get checked() { return this._checked; }
  set checked(v: boolean) {
    this._checked = v;
    v ? this.setAttribute("checked", "") : this.removeAttribute("checked");
    this.render();
  }

  private toggle() {
    if (this.hasAttribute("disabled")) return;
    this.checked = !this._checked;
    this.dispatchEvent(new CustomEvent("change", { detail: { checked: this._checked }, bubbles: true }));
  }

  private render() {
    if (!this.shadowRoot) return;

    const size     = this.getAttribute("size") ?? "md";
    const color    = this.getAttribute("color") ?? "accent";
    const label    = this.getAttribute("label") ?? "";
    const disabled = this.hasAttribute("disabled");
    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const colorMap: Record<string, string> = {
      accent:  "var(--nx-accent, #E89010)",
      live:    "var(--nx-live, #0FD4C6)",
      success: "var(--nx-success, #22C55E)",
    };
    const activeColor = colorMap[color] ?? colorMap.accent;

    const dims = {
      sm: { w: 28, h: 16, thumb: 12, fs: "11px" },
      md: { w: 36, h: 20, thumb: 16, fs: "12px" },
      lg: { w: 44, h: 24, thumb: 20, fs: "13px" },
    };
    const d = dims[size as keyof typeof dims] ?? dims.md;
    const thumbTravel = d.w - d.thumb - 4;

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host { display: inline-flex; align-items: center; gap: 8px; }
        .track {
          position: relative;
          width: ${d.w}px;
          height: ${d.h}px;
          border-radius: 9999px;
          background: ${this._checked ? activeColor : "var(--nx-bg-elevated, #1C2128)"};
          border: 1px solid ${this._checked ? "transparent" : "var(--nx-border-strong, rgba(255,255,255,0.16))"};
          cursor: ${disabled ? "not-allowed" : "pointer"};
          opacity: ${disabled ? 0.45 : 1};
          transition: background 150ms ease, border-color 150ms ease;
          outline: none;
          flex-shrink: 0;
        }
        .track:focus-visible {
          box-shadow: 0 0 0 2px var(--nx-bg-base, #0D1117), 0 0 0 4px ${activeColor};
        }
        .thumb {
          position: absolute;
          top: 50%;
          left: 2px;
          transform: translateY(-50%) translateX(${this._checked ? `${thumbTravel}px` : "0"});
          width: ${d.thumb}px;
          height: ${d.thumb}px;
          border-radius: 50%;
          background: ${this._checked ? "var(--nx-bg-base, #0D1117)" : "var(--nx-text-4, #484F58)"};
          transition: transform 150ms cubic-bezier(0.34,1.56,0.64,1), background 150ms ease;
          pointer-events: none;
        }
        .label {
          font-family: var(--nx-font-sans, system-ui, sans-serif);
          font-size: ${d.fs};
          color: ${disabled ? "var(--nx-text-4, #484F58)" : "var(--nx-text-2, #8B949E)"};
          user-select: none;
          cursor: ${disabled ? "not-allowed" : "pointer"};
        }
      </style>
      <div class="track" role="switch" aria-checked="${this._checked}" tabindex="${disabled ? -1 : 0}" part="track">
        <div class="thumb" part="thumb"></div>
      </div>
      ${label ? `<span class="label" part="label">${label}</span>` : ""}
    `;

    // Re-attach events after innerHTML reset
    const track = this.shadowRoot.querySelector(".track");
    track?.addEventListener("click", () => this.toggle());
    track?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === " " || (e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        this.toggle();
      }
    });
  }
}
