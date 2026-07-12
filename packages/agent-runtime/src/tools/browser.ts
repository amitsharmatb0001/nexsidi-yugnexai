// Interactive browser QA tools — the capability that lets a review agent
// actually DRIVE a deployed app (navigate, click, fill, read rendered text,
// catch console/network errors, inspect computed layout) instead of only
// eyeballing one static screenshot.
//
// 2026-07-11: all browser work runs in a Node subprocess (browser/worker.mjs)
// because Playwright does not work under Bun (proven — see worker.mjs header).
// One BrowserSession (= one Node worker + one Chromium) is created lazily per
// agent run and shared across every browser tool call in that run, so the
// agent can navigate then click then screenshot the *result* — real
// interaction, not disconnected one-shots.
import { resolve, sep } from "path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { BrowserSession } from "../browser/client.ts";

function guardLocalhost(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `invalid URL: ${url}`; }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return `blocked: only localhost URLs allowed for QA, got '${parsed.hostname}'`;
  }
  return null;
}

function guardOutputPath(outputPath: string): { abs: string } | { error: string } {
  const abs = resolve(outputPath);
  const cwdAbs = resolve(process.cwd());
  if (abs !== cwdAbs && !abs.startsWith(cwdAbs + sep)) {
    return { error: "outputPath escapes the working directory" };
  }
  return { abs };
}

// A per-run holder: the session (and its Node worker + Chromium) is only
// spawned on the first browser tool call, so agents that never touch the
// browser pay nothing.
export class BrowserToolset {
  private session: BrowserSession | null = null;

  private ensure(): BrowserSession {
    if (!this.session) this.session = new BrowserSession();
    return this.session;
  }

  async exec(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case "browser_navigate": {
          const url = String(args.url ?? "");
          const bad = guardLocalhost(url);
          if (bad) return { status: "error", summary: bad };
          const r = (await this.ensure().send("navigate", { url })) as { status: number | null; finalUrl: string };
          const redirected = r.finalUrl !== url && r.finalUrl.replace(/\/$/, "") !== url.replace(/\/$/, "");
          return {
            status: "success",
            summary: `Loaded ${url} — HTTP ${r.status}${redirected ? `, REDIRECTED to ${r.finalUrl}` : ""}`,
            output: JSON.stringify(r),
          };
        }
        case "browser_screenshot": {
          const g = guardOutputPath(String(args.outputPath ?? ""));
          if ("error" in g) return { status: "error", summary: g.error };
          await this.ensure().send("screenshot", { path: g.abs, fullPage: args.fullPage ?? true });
          return { status: "success", summary: `Screenshot saved to ${args.outputPath}`, output: g.abs };
        }
        case "browser_click": {
          const r = await this.ensure().send("click", { selector: String(args.selector ?? "") });
          return { status: "success", summary: `Clicked ${args.selector}`, output: JSON.stringify(r) };
        }
        case "browser_fill": {
          await this.ensure().send("fill", { selector: String(args.selector ?? ""), value: String(args.value ?? "") });
          return { status: "success", summary: `Filled ${args.selector}` };
        }
        case "browser_get_text": {
          const r = (await this.ensure().send("getVisibleText", { limit: args.limit ?? 8000 })) as { text: string };
          return { status: "success", summary: `Visible text of current page (${r.text.length} chars)`, output: r.text };
        }
        case "browser_console_errors": {
          const r = (await this.ensure().send("consoleErrors")) as { consoleErrors: string[]; pageErrors: string[] };
          const total = r.consoleErrors.length + r.pageErrors.length;
          return {
            status: "success",
            summary: total === 0 ? "No console or page errors" : `${total} console/page error(s) detected`,
            output: JSON.stringify(r),
          };
        }
        case "browser_computed_style": {
          const r = (await this.ensure().send("getComputedStyle", { selector: String(args.selector ?? ""), props: args.props })) as { styles: unknown };
          if (r.styles === null) return { status: "error", summary: `Selector not found: ${args.selector}` };
          return { status: "success", summary: `Computed style for ${args.selector}`, output: JSON.stringify(r.styles) };
        }
        case "browser_element_exists": {
          const r = (await this.ensure().send("exists", { selector: String(args.selector ?? "") })) as { exists: boolean; count: number };
          return { status: "success", summary: `${args.selector}: ${r.exists ? `found (${r.count})` : "NOT found"}`, output: JSON.stringify(r) };
        }
        case "browser_current_url": {
          const r = (await this.ensure().send("currentUrl")) as { url: string };
          return { status: "success", summary: `Current URL: ${r.url}`, output: r.url };
        }
        default:
          return { status: "error", summary: `unknown browser tool: ${name}` };
      }
    } catch (err) {
      return { status: "error", summary: `${name} failed: ${String(err instanceof Error ? err.message : err)}` };
    }
  }

  async close(): Promise<void> {
    if (this.session) { await this.session.close().catch(() => {}); this.session = null; }
  }
}

export const BROWSER_TOOL_NAMES = new Set([
  "browser_navigate", "browser_screenshot", "browser_click", "browser_fill",
  "browser_get_text", "browser_console_errors", "browser_computed_style",
  "browser_element_exists", "browser_current_url",
]);

const strParam = (description: string) => ({ type: "string", description });

export const BROWSER_TOOL_DEFS: NimToolDef[] = [
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description: "Open a localhost URL in a real browser. Returns the HTTP status and the FINAL url — if it differs from the requested url the app redirected (e.g. an unauthenticated page redirecting to /sign-in). Call this before any other browser tool.",
      parameters: { type: "object", properties: { url: strParam("localhost URL, e.g. http://localhost:3201") }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_screenshot",
      description: "Screenshot the CURRENT page (after navigate/click/fill) to a relative PNG path. Use to visually judge layout, spacing, and whether the page renders correctly.",
      parameters: { type: "object", properties: { outputPath: strParam("relative path, e.g. review/dashboard.png") }, required: ["outputPath"] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description: "Click an element on the current page by CSS selector or text selector (Playwright syntax, e.g. \"button:has-text('Add Task')\"). Use to exercise buttons, links, and navigation.",
      parameters: { type: "object", properties: { selector: strParam("CSS or Playwright text selector") }, required: ["selector"] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_fill",
      description: "Fill a form input/textarea on the current page by selector with a value. Use to test forms before submitting.",
      parameters: { type: "object", properties: { selector: strParam("input selector"), value: strParam("value to type") }, required: ["selector", "value"] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_get_text",
      description: "Return the visible text of the current page (body innerText). Use to confirm the page shows what it should, find placeholder/lorem text, or read error messages.",
      parameters: { type: "object", properties: { limit: { type: "number", description: "max chars (default 8000)" } }, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_console_errors",
      description: "Return JavaScript console errors and failed network requests (e.g. 404s) captured on the current page since navigation. A production-quality app should have none. Always check this after loading a page.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_computed_style",
      description: "Return the computed CSS (color, background, margin, padding, font-size, display by default) and bounding rectangle of the first element matching a selector. Use to verify spacing/typography/contrast concretely instead of guessing from a screenshot.",
      parameters: { type: "object", properties: { selector: strParam("CSS selector"), props: { type: "array", items: { type: "string" }, description: "CSS properties to read (optional)" } }, required: ["selector"] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_element_exists",
      description: "Check whether at least one element matches a selector on the current page (and how many). Use to assert required UI (header, footer, primary buttons) is actually present.",
      parameters: { type: "object", properties: { selector: strParam("CSS selector, e.g. 'header', 'footer', \"button:has-text('Add')\"") }, required: ["selector"] },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_current_url",
      description: "Return the current page URL. Use after a click to confirm navigation/redirect went where expected and there is no 404.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];
