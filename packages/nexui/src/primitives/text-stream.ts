// @yugnex/nexui — NexTextStream Web Component
// Live log stream viewer with virtual tail rendering.
// XSS-safe: all user content set via textContent, never innerHTML.
// Performance: incremental DOM append, not full rebuild per message.

import { nexui_compiler } from "../core/compiler";

type LogFlag = "error" | "verify" | "system" | "warn" | "default";

function detectFlag(text: string): LogFlag {
  const lower = text.toLowerCase();
  if (text.includes("🚨") || lower.includes("error") || lower.includes("fatal")) return "error";
  if (text.includes("⚠") || lower.includes("warn"))                               return "warn";
  if (text.includes("✓") || lower.includes("verified") || lower.includes("pass")) return "verify";
  if (text.includes("✦") || lower.includes("system") || lower.includes("[sys]"))  return "system";
  return "default";
}

const FLAG_COLORS: Record<LogFlag, string> = {
  error:   "var(--nx-error,   #EF4444)",
  warn:    "var(--nx-warning, #EAB308)",
  verify:  "var(--nx-success, #22C55E)",
  system:  "var(--nx-accent,  #E89010)",
  default: "var(--nx-text,    #E6EDF3)",
};

export class NexTextStream extends HTMLElement {
  private logBuffer: string[]  = [];
  private lineElements: HTMLDivElement[] = [];
  private viewport: HTMLDivElement | null = null;
  private container: HTMLDivElement | null = null;
  private lineCount = 0;

  static readonly MAX_BUFFER   = 5000;
  static readonly VISIBLE_ROWS = 50;

  static get observedAttributes() {
    return ["max-rows", "show-numbers"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.setupLayout();
  }

  attributeChangedCallback() {
    // No re-render needed for these attrs — they affect future appends only
  }

  private setupLayout() {
    if (!this.shadowRoot) return;

    const themeCSS = nexui_compiler.getThemeCSS(nexui_compiler.getActiveTheme(), ":host");

    const style = document.createElement("style");
    style.textContent = `
      ${themeCSS}
      :host {
        display: block;
        background-color: var(--nx-bg-void, #040610);
        border: 1px solid var(--nx-border, #1e293b);
        border-radius: 6px;
        padding: 12px;
        font-family: var(--nx-font-mono, 'JetBrains Mono', monospace);
        font-size: 11px;
        line-height: 1.8;
        color: var(--nx-text, #E6EDF3);
        overflow: hidden;
      }
      .viewport {
        max-height: 400px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.12) transparent;
      }
      .viewport::-webkit-scrollbar       { width: 4px; }
      .viewport::-webkit-scrollbar-track { background: transparent; }
      .viewport::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
      .row {
        display: flex;
        gap: 10px;
        white-space: pre-wrap;
        word-break: break-all;
        padding: 1px 0;
      }
      .num {
        color: var(--nx-text-4, #484F58);
        user-select: none;
        min-width: 36px;
        text-align: right;
        flex-shrink: 0;
      }
      .text {
        flex: 1;
        min-width: 0;
      }
    `;

    const viewport = document.createElement("div");
    viewport.className = "viewport";

    const container = document.createElement("div");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-label", "Log stream");
    viewport.appendChild(container);

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(viewport);

    this.viewport  = viewport;
    this.container = container;
  }

  /** Push a single log line. Safe for high-frequency calls (e.g. SSE tokens). */
  public pushLogTrace(message: string) {
    // Enforce buffer ceiling
    if (this.logBuffer.length >= NexTextStream.MAX_BUFFER) {
      this.logBuffer.shift();
      // Remove the oldest visible row element
      const oldest = this.lineElements.shift();
      if (oldest && this.container) this.container.removeChild(oldest);
    }

    this.logBuffer.push(message);
    this.lineCount++;
    this.appendRow(message, this.lineCount);

    // Trim visible rows beyond the virtual window
    const maxVisible = parseInt(this.getAttribute("max-rows") ?? "50", 10);
    while (this.lineElements.length > maxVisible) {
      const old = this.lineElements.shift();
      if (old && this.container) this.container.removeChild(old);
    }

    this.scrollToBottom();
  }

  /** Push multiple lines at once (batch). More efficient than repeated pushLogTrace. */
  public pushBatch(messages: string[]) {
    for (const msg of messages) this.pushLogTrace(msg);
  }

  /** Clear all log content. */
  public clear() {
    this.logBuffer = [];
    this.lineElements = [];
    this.lineCount = 0;
    if (this.container) this.container.textContent = "";
  }

  private appendRow(text: string, lineNumber: number) {
    if (!this.container) return;

    const showNums = this.getAttribute("show-numbers") !== "false";
    const flag     = detectFlag(text);
    const color    = FLAG_COLORS[flag];

    const row = document.createElement("div");
    row.className = "row";

    if (showNums) {
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(lineNumber);
      row.appendChild(num);
    }

    const textSpan = document.createElement("span");
    textSpan.className = "text";
    textSpan.style.color = color;
    textSpan.textContent = text;   // textContent — never innerHTML
    row.appendChild(textSpan);

    this.container.appendChild(row);
    this.lineElements.push(row);
  }

  private scrollToBottom() {
    if (this.viewport) {
      this.viewport.scrollTop = this.viewport.scrollHeight;
    }
  }
}
