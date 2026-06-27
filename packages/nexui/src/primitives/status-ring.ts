// @yugnex/nexui — NexStatusRing Web Component
// Circular progress ring with animated entry.
// Attributes: score (0-100), label, color, size

import { nexui_compiler } from "../core/compiler";

export class NexStatusRing extends HTMLElement {
  static get observedAttributes() {
    return ["score", "label", "color", "size"];
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

    const score  = Math.min(100, Math.max(0, parseInt(this.getAttribute("score") ?? "0", 10)));
    const label  = this.getAttribute("label") ?? "METRIC";
    const color  = this.getAttribute("color") ?? "var(--nx-accent, #E89010)";
    const size   = Math.max(40, parseInt(this.getAttribute("size") ?? "80", 10));

    const cx = size / 2;
    const cy = size / 2;
    const radius = (size / 2) - (size * 0.075);
    const sw     = size * 0.075;
    const circumference = 2 * Math.PI * radius;
    const targetOffset  = circumference - (score / 100) * circumference;
    const fontSize      = Math.round(size * 0.175);
    const labelSize     = Math.round(size * 0.08);
    const themeCSS      = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    // Key technique: render at full offset (empty ring), then in the next frame
    // update to the target offset so the CSS transition actually fires.
    // Without this two-frame approach the element starts at the final value
    // and the transition is never observed.
    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          font-family: var(--nx-font-mono, 'JetBrains Mono', monospace);
        }
        .ring-arc {
          transition: stroke-dashoffset 700ms cubic-bezier(0, 0, 0.2, 1);
          transform-origin: center;
          transform: rotate(-90deg);
        }
        .label {
          font-size: ${labelSize}px;
          color: var(--nx-text-3, #6E7681);
          margin-top: ${Math.round(size * 0.04)}px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          user-select: none;
        }
      </style>
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="${label}: ${score}%" role="img">
        <circle
          cx="${cx}" cy="${cy}" r="${radius}"
          fill="none"
          stroke="var(--nx-border, rgba(255,255,255,0.08))"
          stroke-width="${sw}"
        />
        <circle
          class="ring-arc"
          cx="${cx}" cy="${cy}" r="${radius}"
          fill="none"
          stroke="${color}"
          stroke-width="${sw}"
          stroke-linecap="round"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${circumference}"
        />
        <text
          x="${cx}" y="${cy + fontSize * 0.35}"
          text-anchor="middle"
          fill="var(--nx-text, #E6EDF3)"
          font-size="${fontSize}"
          font-weight="600"
          font-family="inherit"
        >${score}</text>
      </svg>
      <div class="label">${label}</div>
    `;

    // Two-frame update triggers the CSS transition
    const arc = this.shadowRoot.querySelector<SVGCircleElement>(".ring-arc");
    if (arc) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          arc.style.strokeDashoffset = String(targetOffset);
        });
      });
    }
  }
}
