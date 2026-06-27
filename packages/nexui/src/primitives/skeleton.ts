// @yugnex/nexui — NexSkeleton Web Component
// Loading placeholder with shimmer animation.
// Attributes:
//   variant: text | circle | rect (default: rect)
//   width:   CSS value (default: 100%)
//   height:  CSS value (default: 16px for text, 40px for rect)
//   lines:   number — for text variant, renders N stacked lines
//   animate: boolean (default: true)

import { nexui_compiler } from "../core/compiler";

export class NexSkeleton extends HTMLElement {
  static get observedAttributes() {
    return ["variant", "width", "height", "lines", "animate"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  private render() {
    if (!this.shadowRoot) return;

    const variant = this.getAttribute("variant") ?? "rect";
    const width   = this.getAttribute("width") ?? "100%";
    const animate = this.getAttribute("animate") !== "false";
    const lines   = Math.max(1, parseInt(this.getAttribute("lines") ?? "1", 10));
    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    let height = this.getAttribute("height");
    if (!height) {
      height = variant === "text" ? "12px" : variant === "circle" ? width : "40px";
    }

    const baseStyle = `
      background: linear-gradient(
        90deg,
        var(--nx-bg-elevated, #1C2128) 25%,
        var(--nx-bg-overlay,  #21262D) 50%,
        var(--nx-bg-elevated, #1C2128) 75%
      );
      background-size: 200% 100%;
      ${animate ? "animation: nx-shimmer 1.8s ease-in-out infinite;" : ""}
      border-radius: ${variant === "circle" ? "50%" : variant === "text" ? "4px" : "6px"};
    `;

    if (variant === "text" && lines > 1) {
      const lineEls = Array.from({ length: lines }, (_, i) => {
        const w = i === lines - 1 ? "65%" : "100%";
        return `<div style="${baseStyle} width:${w}; height:${height}; margin-bottom:${i < lines - 1 ? "8px" : "0"};"></div>`;
      }).join("");

      this.shadowRoot.innerHTML = `
        <style>${themeCSS} :host{display:block;} @keyframes nx-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>
        <div role="status" aria-label="Loading..." style="width:${width};">${lineEls}</div>
      `;
    } else {
      this.shadowRoot.innerHTML = `
        <style>${themeCSS} :host{display:block;} @keyframes nx-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>
        <div role="status" aria-label="Loading..." style="${baseStyle} width:${width}; height:${height};"></div>
      `;
    }
  }
}
