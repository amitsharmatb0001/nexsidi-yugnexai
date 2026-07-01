// @yugnex/nexui — NexCheckbox Web Component
// Checkbox with indeterminate state support.
// Attributes:
//   checked:       boolean
//   indeterminate: boolean
//   disabled:      boolean
//   label:         string
//   size:          sm | md | lg

import { nexui_compiler } from "../core/compiler";
import { NexuiIcons } from "../assets/geometry";

export class NexCheckbox extends HTMLElement {
  private _checked = false;
  private _indeterminate = false;

  static get observedAttributes() {
    return ["checked", "indeterminate", "disabled", "label", "size"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._checked = this.hasAttribute("checked");
    this._indeterminate = this.hasAttribute("indeterminate");
    this.render();
  }

  attributeChangedCallback(name: string) {
    if (name === "checked")       this._checked = this.hasAttribute("checked");
    if (name === "indeterminate") this._indeterminate = this.hasAttribute("indeterminate");
    this.render();
  }

  get checked() { return this._checked; }
  set checked(v: boolean) {
    this._checked = v;
    this._indeterminate = false;
    v ? this.setAttribute("checked", "") : this.removeAttribute("checked");
    this.removeAttribute("indeterminate");
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
    const label    = this.getAttribute("label") ?? "";
    const disabled = this.hasAttribute("disabled");
    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const szMap = { sm: 14, md: 16, lg: 20 };
    const sz = szMap[size as keyof typeof szMap] ?? 16;
    const iconSz = Math.round(sz * 0.7);
    const fs = size === "sm" ? "11px" : size === "lg" ? "13px" : "12px";

    const isActive = this._checked || this._indeterminate;
    const icon = this._indeterminate
      ? `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14"/></svg>`
      : `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${NexuiIcons.check}"/></svg>`;

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host { display: inline-flex; align-items: center; gap: 8px; cursor: ${disabled ? "not-allowed" : "pointer"}; }
        .box {
          width: ${sz}px;
          height: ${sz}px;
          border-radius: 4px;
          border: 1.5px solid ${isActive ? "var(--nx-accent, #E89010)" : "var(--nx-border-strong, rgba(255,255,255,0.16))"};
          background: ${isActive ? "var(--nx-accent, #E89010)" : "var(--nx-bg-elevated, #1C2128)"};
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
          opacity: ${disabled ? 0.45 : 1};
          transition: background 120ms ease, border-color 120ms ease;
          flex-shrink: 0;
          outline: none;
        }
        .box:focus-visible {
          box-shadow: 0 0 0 2px var(--nx-bg-base, #0D1117), 0 0 0 4px var(--nx-accent, #E89010);
        }
        .icon { display: ${isActive ? "flex" : "none"}; pointer-events: none; }
        label {
          font-family: var(--nx-font-sans, system-ui, sans-serif);
          font-size: ${fs};
          color: ${disabled ? "var(--nx-text-4, #484F58)" : "var(--nx-text-2, #8B949E)"};
          user-select: none;
        }
      </style>
      <div class="box" role="checkbox" aria-checked="${this._indeterminate ? "mixed" : this._checked}" tabindex="${disabled ? -1 : 0}" part="box">
        <span class="icon" aria-hidden="true">${icon}</span>
      </div>
      ${label ? `<label part="label">${label}</label>` : ""}
    `;

    const box = this.shadowRoot.querySelector(".box");
    box?.addEventListener("click", () => this.toggle());
    box?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === " ") { e.preventDefault(); this.toggle(); }
    });
  }
}
