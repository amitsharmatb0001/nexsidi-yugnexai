// @yugnex/nexui — NexAvatar Web Component
// User avatar: image with initials fallback + optional status indicator.
// Attributes:
//   src:     image URL
//   name:    full name — used for initials and alt text
//   size:    xs | sm | md | lg | xl (default: md)
//   status:  online | away | busy | offline (optional)
//   shape:   circle | square (default: circle)

import { nexui_compiler } from "../core/compiler";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic hue from name string for initials background
function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export class NexAvatar extends HTMLElement {
  static get observedAttributes() {
    return ["src", "name", "size", "status", "shape"];
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

    const src     = this.getAttribute("src") ?? "";
    const name    = this.getAttribute("name") ?? "";
    const size    = this.getAttribute("size") ?? "md";
    const status  = this.getAttribute("status") ?? "";
    const shape   = this.getAttribute("shape") ?? "circle";
    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const sizeMap: Record<string, { px: number; fs: number; dot: number; }> = {
      xs: { px: 20, fs: 8,  dot: 5  },
      sm: { px: 28, fs: 11, dot: 7  },
      md: { px: 36, fs: 14, dot: 9  },
      lg: { px: 48, fs: 18, dot: 11 },
      xl: { px: 64, fs: 24, dot: 13 },
    };
    const s = sizeMap[size] ?? sizeMap.md;

    const borderRadius = shape === "square"
      ? `${Math.round(s.px * 0.2)}px`
      : "50%";

    const initials = name ? getInitials(name) : "?";
    const hue      = nameToHue(name || "?");
    const fallbackBg = `hsl(${hue}, 35%, 22%)`;
    const fallbackFg = `hsl(${hue}, 70%, 72%)`;

    const statusColor: Record<string, string> = {
      online:  "#22C55E",
      away:    "#EAB308",
      busy:    "#EF4444",
      offline: "#484F58",
    };

    const dotColor = statusColor[status] ?? "";
    const dotBorder = size === "xs" ? "1px" : "2px";

    const imgContent = src
      ? `<img src="${src}" alt="${name ? `Avatar of ${name}` : "User avatar"}" loading="lazy" />`
      : `<span class="initials" aria-hidden="true">${initials}</span>`;

    this.shadowRoot.innerHTML = `
      <style>
        ${themeCSS}
        :host {
          display: inline-block;
          position: relative;
          width: ${s.px}px;
          height: ${s.px}px;
          flex-shrink: 0;
        }
        .avatar {
          width: ${s.px}px;
          height: ${s.px}px;
          border-radius: ${borderRadius};
          background: ${fallbackBg};
          border: 1px solid var(--nx-border, rgba(255,255,255,0.08));
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          user-select: none;
        }
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .initials {
          font-family: var(--nx-font-sans, system-ui, sans-serif);
          font-size: ${s.fs}px;
          font-weight: 600;
          color: ${fallbackFg};
          line-height: 1;
          letter-spacing: 0.02em;
        }
        ${status ? `.dot {
          position: absolute;
          bottom: 0;
          right: 0;
          width: ${s.dot}px;
          height: ${s.dot}px;
          border-radius: 50%;
          background: ${dotColor};
          border: ${dotBorder} solid var(--nx-bg-base, #0D1117);
        }` : ""}
      </style>
      <div class="avatar" role="img" aria-label="${name ? `Avatar of ${name}` : "User avatar"}" part="avatar">
        ${imgContent}
      </div>
      ${status ? `<span class="dot" aria-label="${status}" title="${status}"></span>` : ""}
    `;

    // Hide initials when image loads successfully
    if (src) {
      const img = this.shadowRoot.querySelector<HTMLImageElement>("img");
      const initialsEl = this.shadowRoot.querySelector<HTMLSpanElement>(".initials");
      if (img && initialsEl) {
        img.addEventListener("error", () => {
          img.style.display = "none";
          // Create and append initials span if image fails
          const span = document.createElement("span");
          span.className = "initials";
          span.setAttribute("aria-hidden", "true");
          span.textContent = initials;
          span.style.cssText = `font-family:var(--nx-font-sans,system-ui,sans-serif);font-size:${s.fs}px;font-weight:600;color:${fallbackFg};line-height:1;letter-spacing:0.02em;`;
          img.parentElement?.appendChild(span);
        });
      }
    }
  }
}
