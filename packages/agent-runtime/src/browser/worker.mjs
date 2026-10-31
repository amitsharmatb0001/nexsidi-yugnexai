// Node-side persistent Playwright browser worker.
//
// 2026-07-11: ROOT CAUSE of the entire multi-session screenshot saga — proven
// with a controlled experiment (same script, same machine, same moment):
// Playwright's browser layer does NOT work under Bun (chromium.launch() AND
// chromium.connectOverCDP() both hang/timeout), but works perfectly under
// Node (launch in 0.4s, real screenshot in 4s). Playwright officially supports
// only Node. The pipeline runs under `bun run`, so ALL browser work must be
// delegated to a Node subprocess — this worker. No Docker container and no CDP
// proxy are needed: plain chromium.launch() under Node works on the host.
//
// Protocol: newline-delimited JSON on stdio. Each stdin line is a request
// {id, action, ...args}; each response is one stdout line {id, ok, result?,
// error?}. NOTHING else may be written to stdout (Chrome's dbus/gpu noise
// goes to stderr on its own) — the Bun-side client parses stdout line-by-line.
import { chromium } from "playwright";
import { valueForInputType } from "./input-value.mjs";

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (...a) => process.stderr.write(`[browser-worker] ${a.join(" ")}\n`);

let browser = null;
let context = null;
let page = null;
const consoleErrors = [];
const pageErrors = [];
// 2026-10-04: every non-GET request and what it returned, so a check can say
// what a form actually sent instead of inferring it from timing.
const requests = [];
// 2026-10-05: every request of ANY method that failed or answered 4xx/5xx, for the route sweep.
const failedRequests = [];

async function ensurePage() {
  if (!browser) {
    browser = await chromium.launch({ timeout: 30_000 });
  }
  if (!context) {
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  }
  if (!page) {
    page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("response", (res) => {
      const r = res.request();
      if (res.status() >= 400) failedRequests.push({ method: r.method(), url: r.url(), status: res.status() });
      if (r.method() !== "GET") requests.push({ method: r.method(), url: r.url(), status: res.status() });
    });
    page.on("requestfailed", (r) => {
      failedRequests.push({ method: r.method(), url: r.url(), status: 0, failure: r.failure()?.errorText ?? "failed" });
      if (r.method() !== "GET") requests.push({ method: r.method(), url: r.url(), status: 0, failure: r.failure()?.errorText ?? "failed" });
    });
  }
  return page;
}

// 2026-10-29 (acceptance tests, team plan stage 3): a test written before the code knows only what a person sees — a
// field's label or placeholder, a button's words — never a CSS selector. These find the element the way a person would,
// exact words first, and wait up to the timeout for it to appear. The first visible match is used.
async function firstVisible(candidates, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    for (const make of candidates) {
      const loc = make();
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const one = loc.nth(i);
        if (await one.isVisible().catch(() => false)) return one;
      }
    }
    if (Date.now() >= end) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const cssString = (s) => String(s).replace(/["\\]/g, "\\$&");

function fieldCandidates(p, field) {
  return [
    () => p.getByLabel(field, { exact: true }),
    () => p.getByPlaceholder(field, { exact: true }),
    () => p.getByLabel(field),
    () => p.getByPlaceholder(field),
    () => p.getByRole("textbox", { name: field }),
    () => p.getByRole("combobox", { name: field }),
    () => p.locator(`[name="${cssString(field)}" i], #${String(field).replace(/[^A-Za-z0-9_-]/g, "")}`),
  ];
}

async function handle(req) {
  const { action } = req;
  switch (action) {
    case "navigate": {
      const p = await ensurePage();
      const resp = await p.goto(req.url, {
        timeout: req.timeoutMs ?? 20_000,
        waitUntil: req.waitUntil ?? "networkidle",
      });
      return { status: resp?.status() ?? null, url: p.url(), finalUrl: p.url() };
    }
    case "screenshot": {
      const p = await ensurePage();
      await p.screenshot({ path: req.path, fullPage: req.fullPage ?? true });
      return { path: req.path };
    }
    case "click": {
      const p = await ensurePage();
      await p.click(req.selector, { timeout: req.timeoutMs ?? 10_000 });
      return { clicked: req.selector, url: p.url() };
    }
    case "fill": {
      const p = await ensurePage();
      await p.fill(req.selector, req.value, { timeout: req.timeoutMs ?? 10_000 });
      return { filled: req.selector };
    }
    case "fillField": {
      const p = await ensurePage();
      const el = await firstVisible(fieldCandidates(p, req.field), req.timeoutMs ?? 8_000);
      if (!el) throw new Error(`no field labelled "${req.field}" on the page`);
      // 2026-10-31 (Brewline 4): a date/time field takes its own form (input-value.mjs), not the test's full timestamp.
      const type = await el.getAttribute("type").catch(() => null);
      await el.fill(valueForInputType(type, String(req.value ?? "")), { timeout: 5_000 });
      return { filled: req.field };
    }
    case "chooseOption": {
      const p = await ensurePage();
      const option = String(req.option ?? "");
      const select = await firstVisible(fieldCandidates(p, req.field), Math.min(req.timeoutMs ?? 8_000, 4_000));
      if (select && (await select.evaluate((e) => e.tagName).catch(() => "")) === "SELECT") {
        await select.selectOption({ label: option }, { timeout: 5_000 }).catch(() => select.selectOption(option, { timeout: 5_000 }));
        return { chose: option };
      }
      const choice = await firstVisible([
        () => p.getByRole("radio", { name: option, exact: true }),
        () => p.getByRole("checkbox", { name: option, exact: true }),
        () => p.getByRole("option", { name: option, exact: true }),
        () => p.getByRole("radio", { name: option }),
        () => p.getByLabel(option, { exact: true }),
        () => p.getByRole("button", { name: option, exact: true }),
      ], req.timeoutMs ?? 8_000);
      if (!choice) throw new Error(`no choice "${option}" for "${req.field}" on the page`);
      await choice.click({ timeout: 5_000 });
      return { chose: option };
    }
    case "clickText": {
      const p = await ensurePage();
      const text = String(req.text ?? "");
      const el = await firstVisible([
        () => p.getByRole("button", { name: text, exact: true }),
        () => p.getByRole("link", { name: text, exact: true }),
        () => p.getByRole("button", { name: text }),
        () => p.getByRole("link", { name: text }),
        () => p.getByText(text, { exact: true }),
        () => p.getByText(text),
      ], req.timeoutMs ?? 8_000);
      if (!el) throw new Error(`nothing to click with the text "${text}" on the page`);
      await el.click({ timeout: 5_000 });
      await p.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      return { clicked: text, url: p.url() };
    }
    case "getText": {
      const p = await ensurePage();
      const text = await p.textContent(req.selector, { timeout: req.timeoutMs ?? 10_000 });
      return { text };
    }
    case "getVisibleText": {
      const p = await ensurePage();
      // Trimmed innerText of body — what a human actually sees on the page.
      const text = await p.evaluate(() => document.body?.innerText ?? "");
      return { text: text.slice(0, req.limit ?? 8000) };
    }
    case "getComputedStyle": {
      const p = await ensurePage();
      const styles = await p.evaluate(
        ({ selector, props }) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const out = {};
          for (const prop of props) out[prop] = cs.getPropertyValue(prop);
          const r = el.getBoundingClientRect();
          out.__rect = { x: r.x, y: r.y, width: r.width, height: r.height };
          return out;
        },
        { selector: req.selector, props: req.props ?? ["color", "background-color", "margin", "padding", "font-size", "display"] },
      );
      return { styles };
    }
    case "evaluate": {
      const p = await ensurePage();
      const value = await p.evaluate(req.expression);
      return { value };
    }
    case "currentUrl": {
      const p = await ensurePage();
      return { url: p.url() };
    }
    case "requests": {
      return { requests: [...requests] };
    }
    case "setViewport": {
      const p = await ensurePage();
      await p.setViewportSize({ width: Number(req.width), height: Number(req.height) });
      return { width: Number(req.width), height: Number(req.height) };
    }
    case "failedRequests": {
      return { failed: [...failedRequests] };
    }
    case "consoleErrors": {
      return { consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] };
    }
    case "exists": {
      const p = await ensurePage();
      const count = await p.locator(req.selector).count();
      return { exists: count > 0, count };
    }
    case "newSession": {
      // Fresh context/page (e.g. for the reality-checker's independent pass)
      // without paying the browser launch cost again.
      if (page) { await page.close().catch(() => {}); page = null; }
      if (context) { await context.close().catch(() => {}); context = null; }
      consoleErrors.length = 0;
      pageErrors.length = 0;
      requests.length = 0;
      failedRequests.length = 0;
      await ensurePage();
      return { reset: true };
    }
    case "close": {
      if (browser) await browser.close().catch(() => {});
      browser = context = page = null;
      return { closed: true };
    }
    default:
      throw new Error(`unknown action: ${action}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      send({ id: null, ok: false, error: `bad JSON request: ${String(e)}` });
      continue;
    }
    handle(req)
      .then((result) => send({ id: req.id, ok: true, result }))
      .catch((err) => send({ id: req.id, ok: false, error: String(err?.message ?? err).split("\n")[0] }));
  }
});

process.on("SIGTERM", async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});

log("ready");
send({ id: "ready", ok: true, result: { ready: true } });
