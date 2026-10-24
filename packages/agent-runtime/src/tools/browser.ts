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
import { resolveEvidencePath } from "./screenshot.ts";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { BrowserSession } from "../browser/client.ts";
import type { EvidenceLedger } from "../enforce/evidence.ts";

function guardLocalhost(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `invalid URL: ${url}`; }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return `blocked: only localhost URLs allowed for QA, got '${parsed.hostname}'`;
  }
  return null;
}


// A per-run holder: the session (and its Node worker + Chromium) is only
// spawned on the first browser tool call, so agents that never touch the
// browser pay nothing.
// 2026-10-24 (Brewline): the live reviewers drove the app one browser action per model call (~16 min a round), each call
// resending the whole conversation. browser_steps runs a list of these in one call, in order, on the same page.
const STEP_ACTIONS = new Set(["navigate", "click", "fill", "screenshot", "get_text", "console_errors", "computed_style", "element_exists", "current_url"]);
const MAX_STEPS = 20;

export class BrowserToolset {
  private session: BrowserSession | null = null;

  // The agent's own workspace — screenshots go under its evidence folder
  // (see screenshot.ts's resolveEvidencePath), never the worker's cwd.
  constructor(
    private readonly workspace: string = process.cwd(),
    private readonly makeSession: () => BrowserSession = () => new BrowserSession(),
  ) {}

  private ensure(): BrowserSession {
    if (!this.session) this.session = this.makeSession();
    return this.session;
  }

  private async runSteps(args: Record<string, unknown>, ledger?: EvidenceLedger): Promise<ToolResult> {
    const steps = Array.isArray(args.steps) ? (args.steps as Array<Record<string, unknown>>) : [];
    if (steps.length === 0) return { status: "error", summary: "browser_steps needs a non-empty steps list" };
    if (steps.length > MAX_STEPS) return { status: "error", summary: `browser_steps takes at most ${MAX_STEPS} steps; got ${steps.length}` };
    const unknown = steps.findIndex((s) => !STEP_ACTIONS.has(String(s?.action ?? "")));
    if (unknown >= 0) {
      return { status: "error", summary: `step ${unknown + 1}: unknown action "${String(steps[unknown]?.action)}"; use one of ${[...STEP_ACTIONS].join(", ")}` };
    }
    const lines: string[] = [];
    const images: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const { action, ...stepArgs } = steps[i]!;
      const r = await this.exec(`browser_${String(action)}`, stepArgs, ledger);
      const shown = action === "screenshot" || action === "navigate" ? "" : r.output ? `\n${r.output}` : "";
      lines.push(`${i + 1}. ${String(action)}: ${r.summary}${shown}`);
      if (action === "screenshot" && r.status === "success" && r.output) images.push(r.output);
      if (r.status === "error") {
        return {
          status: "error",
          summary: `step ${i + 1} (${String(action)}) failed: ${r.summary}; steps after it did not run`,
          output: lines.join("\n\n"),
          ...(images.length > 0 ? { images } : {}),
        };
      }
    }
    return { status: "success", summary: `${steps.length} browser step(s) done`, output: lines.join("\n\n"), ...(images.length > 0 ? { images } : {}) };
  }

  async exec(name: string, args: Record<string, unknown>, ledger?: EvidenceLedger): Promise<ToolResult> {
    try {
      switch (name) {
        case "browser_steps":
          return await this.runSteps(args, ledger);
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
          const g = resolveEvidencePath(this.workspace, String(args.outputPath ?? ""));
          if ("error" in g) return { status: "error", summary: g.error };
          await this.ensure().send("screenshot", { path: g.abs, fullPage: args.fullPage ?? true });
          // 2026-08-10: records "visual_check" evidence — see evidence.ts's
          // header comment and screenshot.ts's identical convention for the
          // standalone tool. Interactive browser_screenshot is the one
          // Aanya's own required workflow actually calls (after navigate),
          // so this is the real enforcement point for her visual-QA gate.
          ledger?.record("visual_check", `browser_screenshot -> ${args.outputPath}`);
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
  "browser_element_exists", "browser_current_url", "browser_steps",
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
  {
    type: "function",
    function: {
      name: "browser_steps",
      description: `Run several browser actions in ONE call, in order, on the same page (at most ${MAX_STEPS}). Each step is {action, ...that action's fields}: navigate {url}, click {selector}, fill {selector, value}, screenshot {outputPath}, get_text {limit}, console_errors, computed_style {selector, props}, element_exists {selector}, current_url. Returns every step's result and attaches every screenshot. Stops at the first step that fails and says which. Use it whenever you know the next few actions, e.g. navigate + console_errors + get_text + screenshot for one page, or fill + fill + click + current_url for a form.`,
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: [...STEP_ACTIONS] },
                url: strParam("navigate: localhost URL"),
                selector: strParam("click / fill / computed_style / element_exists: CSS or Playwright text selector"),
                value: strParam("fill: value to type"),
                outputPath: strParam("screenshot: relative PNG path"),
                limit: { type: "number", description: "get_text: max chars (default 8000)" },
                props: { type: "array", items: { type: "string" }, description: "computed_style: CSS properties to read" },
              },
              required: ["action"],
            },
          },
        },
        required: ["steps"],
      },
    },
  },
];
