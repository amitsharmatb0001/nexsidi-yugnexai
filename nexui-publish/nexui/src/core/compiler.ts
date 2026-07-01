// @yugnex/nexui — Style Compiler
// Converts LayoutMatrix bitmasks to CSS, manages theme injection,
// and provides shadow-DOM-safe CSS text output.

import {
  NEXUI_THEMES,
  type NexuiTheme,
  MATRIX_PAD_MAP,
  MATRIX_DISPLAY_MAP,
  MATRIX_RADIUS_MAP,
  MATRIX_GAP_MAP,
  MATRIX_WIDTH_MAP,
  MATRIX_OVERFLOW_MAP,
} from "./matrix";

const SELECTOR_PREFIX = "nx-m-";

// Bitmask masks for each field
const MASK_PAD      = 0x00000F;
const MASK_DISPLAY  = 0x0000F0;
const MASK_RADIUS   = 0x000F00;
const MASK_GAP      = 0x00F000;
const MASK_WIDTH    = 0x0F0000;
const MASK_OVERFLOW = 0xF00000;

function bitmaskToCSSBody(mask: number): string {
  let css = "";
  const pad      = mask & MASK_PAD;
  const display  = mask & MASK_DISPLAY;
  const radius   = mask & MASK_RADIUS;
  const gap      = mask & MASK_GAP;
  const width    = mask & MASK_WIDTH;
  const overflow = mask & MASK_OVERFLOW;

  if (MATRIX_PAD_MAP[pad])          css += MATRIX_PAD_MAP[pad];
  if (MATRIX_DISPLAY_MAP[display])   css += MATRIX_DISPLAY_MAP[display];
  if (MATRIX_RADIUS_MAP[radius])     css += MATRIX_RADIUS_MAP[radius];
  if (MATRIX_GAP_MAP[gap])           css += MATRIX_GAP_MAP[gap];
  if (MATRIX_WIDTH_MAP[width])       css += MATRIX_WIDTH_MAP[width];
  if (MATRIX_OVERFLOW_MAP[overflow]) css += MATRIX_OVERFLOW_MAP[overflow];

  return css;
}

export class NexuiStyleCompiler {
  private sheet: CSSStyleSheet | null = null;
  private cache = new Map<number, string>();   // mask → className
  private currentTheme: NexuiTheme = "void";

  // ─── Global document stylesheet ───────────────────────────────────────────

  private getSheet(): CSSStyleSheet {
    if (this.sheet) return this.sheet;
    const style = document.createElement("style");
    style.id = "yugnex-nexui-engine";
    document.head.appendChild(style);
    this.sheet = style.sheet as CSSStyleSheet;
    return this.sheet;
  }

  /** Inject a bitmask class into the global document stylesheet.
   *  Returns the class name. Safe for light-DOM components only.
   *  For shadow DOM components, use compileBitmaskToString(). */
  public compileBitmask(mask: number): string {
    if (this.cache.has(mask)) return this.cache.get(mask)!;
    const selector = `${SELECTOR_PREFIX}${mask.toString(16).toUpperCase()}`;
    const body = bitmaskToCSSBody(mask);
    if (body) {
      try {
        const sheet = this.getSheet();
        sheet.insertRule(`.${selector}{${body}}`, sheet.cssRules.length);
      } catch {
        // CSSOM insertRule can fail in sandboxed frames — ignore silently
      }
    }
    this.cache.set(mask, selector);
    return selector;
  }

  /** Returns a complete `<style>` text block for use inside a shadow root.
   *  Shadow DOM cannot see global document styles, so call this inside
   *  connectedCallback() and inject the result into shadowRoot. */
  public compileBitmaskToString(mask: number): string {
    const selector = `${SELECTOR_PREFIX}${mask.toString(16).toUpperCase()}`;
    const body = bitmaskToCSSBody(mask);
    return body ? `.${selector}{${body}}` : "";
  }

  /** Returns CSS text for all currently compiled bitmask rules.
   *  Useful for SSR, test snapshots, or shadow root bulk-injection. */
  public dumpCompiledCSS(): string {
    let out = "";
    for (const [mask] of this.cache) {
      out += this.compileBitmaskToString(mask) + "\n";
    }
    return out;
  }

  // ─── Theme management ──────────────────────────────────────────────────────

  /** Returns a CSS custom property block for the given theme.
   *  Inject into :root for global use, or into :host for shadow DOM. */
  public getThemeCSS(theme: NexuiTheme, selector = ":root"): string {
    const tokens = NEXUI_THEMES[theme];
    const rules = Object.entries(tokens)
      .map(([k, v]) => `  ${k}:${v};`)
      .join("\n");
    return `${selector}{\n${rules}\n}`;
  }

  /** Mounts theme custom properties on :root and stores active theme.
   *  Safe to call multiple times — replaces the previous theme block. */
  public mountGlobalTheme(theme: NexuiTheme = "void"): void {
    this.currentTheme = theme;
    const existing = document.getElementById("yugnex-nexui-theme");
    const style = (existing as HTMLStyleElement | null) ?? document.createElement("style");
    style.id = "yugnex-nexui-theme";
    style.textContent = this.getThemeCSS(theme, ":root");
    if (!existing) document.head.appendChild(style);
  }

  public switchTheme(theme: NexuiTheme): void {
    this.mountGlobalTheme(theme);
  }

  public getActiveTheme(): NexuiTheme {
    return this.currentTheme;
  }

  /** Returns the full CSS needed for a shadow root: theme vars + compiled bitmasks. */
  public getShadowRootCSS(masks: number[], theme?: NexuiTheme): string {
    const t = theme ?? this.currentTheme;
    const themeBlock = this.getThemeCSS(t, ":host");
    const matrixBlock = masks.map(m => this.compileBitmaskToString(m)).join("\n");
    return themeBlock + "\n" + matrixBlock;
  }
}

export const nexui_compiler = new NexuiStyleCompiler();
