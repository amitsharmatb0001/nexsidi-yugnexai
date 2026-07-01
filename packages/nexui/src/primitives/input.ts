// @yugnex/nexui — NexInput Web Component
// Full-featured input with label, helper text, error state, and prefix/suffix slots.
// Attributes:
//   type:        text | email | password | search | number | url (default: text)
//   label:       string
//   placeholder: string
//   helper:      string — helper text below input
//   error:       string — error message (replaces helper, sets error state)
//   size:        sm | md | lg
//   disabled:    boolean
//   required:    boolean
//   value:       initial value

import { nexui_compiler } from "../core/compiler";

export class NexInput extends HTMLElement {
  private input: HTMLInputElement | null = null;

  static get observedAttributes() {
    return ["type", "label", "placeholder", "helper", "error", "size", "disabled", "required", "value"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.setupProxy();
  }

  attributeChangedCallback() {
    this.render();
    this.setupProxy();
  }

  // Expose input value as a property on the custom element
  get value(): string {
    return this.input?.value ?? this.getAttribute("value") ?? "";
  }
  set value(v: string) {
    if (this.input) this.input.value = v;
    this.setAttribute("value", v);
  }

  focus() { this.input?.focus(); }
  blur()  { this.input?.blur(); }

  private setupProxy() {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>("input");
    if (!input) return;
    this.input = input;

    // Re-dispatch events from shadow root so they bubble out
    const forward = (e: Event) => this.dispatchEvent(new (e.constructor as typeof Event)(e.type, e));
    input.addEventListener("input",   forward);
    input.addEventListener("change",  forward);
    input.addEventListener("focus",   forward);
    input.addEventListener("blur",    forward);
    input.addEventListener("keydown", (e) => this.dispatchEvent(new KeyboardEvent("keydown", e)));
  }

  private render() {
    if (!this.shadowRoot) return;

    const type        = this.getAttribute("type") ?? "text";
    const label       = this.getAttribute("label") ?? "";
    const placeholder = this.getAttribute("placeholder") ?? "";
    const helper      = this.getAttribute("helper") ?? "";
    const error       = this.getAttribute("error") ?? "";
    const size        = this.getAttribute("size") ?? "md";
    const disabled    = this.hasAttribute("disabled");
    const required    = this.hasAttribute("required");
    const value       = this.getAttribute("value") ?? "";
    const inputId     = `nx-input-${Math.random().toString(36).slice(2, 7)}`;
    const themeCSS    = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");
    const hasError    = error.length > 0;

    const sizeVars: Record<string, { fs: string; ph: string; radius: string; }> = {
      sm: { fs: "12px", ph: "6px 10px",  radius: "5px" },
      md: { fs: "13px", ph: "8px 12px",  radius: "6px" },
      lg: { fs: "14px", ph: "10px 14px", radius: "7px" },
    };
    const sv = sizeVars[size] ?? sizeVars.md;

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host {
          display: block;
          font-family: var(--nx-font-sans, system-ui, sans-serif);
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        label {
          font-size: 12px;
          font-weight: 500;
          color: var(--nx-text-2, #8B949E);
          letter-spacing: 0.02em;
          user-select: none;
        }
        label .req {
          color: var(--nx-error, #EF4444);
          margin-left: 2px;
        }
        .input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        input {
          width: 100%;
          background: var(--nx-bg-elevated, #1C2128);
          border: 1px solid ${hasError ? "var(--nx-error,#EF4444)" : "var(--nx-border,rgba(255,255,255,0.08))"};
          border-radius: ${sv.radius};
          color: var(--nx-text, #E6EDF3);
          font-family: inherit;
          font-size: ${sv.fs};
          padding: ${sv.ph};
          line-height: 1.5;
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
          box-sizing: border-box;
          -webkit-appearance: none;
        }
        input::placeholder {
          color: var(--nx-text-4, #484F58);
        }
        input:hover:not(:disabled):not(:focus) {
          border-color: var(--nx-border-strong, rgba(255,255,255,0.16));
        }
        input:focus {
          border-color: ${hasError ? "var(--nx-error,#EF4444)" : "var(--nx-border-focus,rgba(232,144,16,0.60))"};
          box-shadow: 0 0 0 3px ${hasError ? "rgba(239,68,68,0.15)" : "rgba(232,144,16,0.12)"};
          background: var(--nx-bg-surface, #161B22);
        }
        input:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .prefix-slot, .suffix-slot {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          color: var(--nx-text-3, #6E7681);
          pointer-events: none;
        }
        .prefix-slot { left: 10px; }
        .suffix-slot { right: 10px; }
        :host([has-prefix]) input { padding-left: 34px; }
        :host([has-suffix]) input { padding-right: 34px; }
        .help {
          font-size: 11px;
          color: ${hasError ? "var(--nx-error,#EF4444)" : "var(--nx-text-3,#6E7681)"};
          line-height: 1.4;
        }
      </style>
      <div class="field" part="field">
        ${label ? `<label for="${inputId}">${label}${required ? '<span class="req" aria-hidden="true">*</span>' : ""}</label>` : ""}
        <div class="input-wrap">
          <span class="prefix-slot" aria-hidden="true"><slot name="prefix"></slot></span>
          <input
            id="${inputId}"
            type="${type}"
            placeholder="${placeholder}"
            ${value ? `value="${value}"` : ""}
            ${disabled ? "disabled" : ""}
            ${required ? "required" : ""}
            ${hasError ? `aria-invalid="true" aria-describedby="${inputId}-help"` : ""}
            part="input"
          />
          <span class="suffix-slot" aria-hidden="true"><slot name="suffix"></slot></span>
        </div>
        ${error || helper
          ? `<span class="help" id="${inputId}-help" role="${hasError ? "alert" : ""}">${error || helper}</span>`
          : ""}
      </div>
    `;

    this.input = this.shadowRoot.querySelector("input");
    if (this.input && value) this.input.value = value;
  }
}
