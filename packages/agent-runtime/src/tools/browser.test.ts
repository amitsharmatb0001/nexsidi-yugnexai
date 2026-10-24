import { test, expect } from "bun:test";
import { BrowserToolset, BROWSER_TOOL_NAMES, BROWSER_TOOL_DEFS } from "./browser.ts";

// These hit the security guards, which run BEFORE the lazy session is spawned,
// so no Node worker / Chromium / running app is needed.

test("browser_navigate blocks non-localhost URLs (no worker spawned)", async () => {
  const ts = new BrowserToolset();
  const r = await ts.exec("browser_navigate", { url: "https://evil.example.com" });
  expect(r.status).toBe("error");
  expect(r.summary).toContain("localhost");
  await ts.close();
});

test("browser_navigate rejects a malformed URL", async () => {
  const ts = new BrowserToolset();
  const r = await ts.exec("browser_navigate", { url: "not a url" });
  expect(r.status).toBe("error");
  await ts.close();
});

test("browser_screenshot rejects an outputPath that escapes cwd", async () => {
  const ts = new BrowserToolset();
  const r = await ts.exec("browser_screenshot", { outputPath: "../../etc/x.png" });
  expect(r.status).toBe("error");
  expect(r.summary).toContain("escapes the working directory");
  await ts.close();
});

test("BROWSER_TOOL_NAMES matches the tool defs exactly", () => {
  const defNames = new Set(BROWSER_TOOL_DEFS.map((d) => d.function.name));
  expect(defNames).toEqual(BROWSER_TOOL_NAMES);
});

// 2026-10-24 (Brewline root cause): the live reviewers drove the app one browser action per model call (~16 min a round),
// each call resending the whole conversation. browser_steps runs a list of actions in ONE call, in order, on the same
// page, and returns every result (screenshots included); it stops at the first step that fails.
function fakeSession(failOn?: string) {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const session = {
    async send(action: string, args: Record<string, unknown> = {}) {
      calls.push({ action, args });
      if (action === failOn) throw new Error(`no element matches ${String(args.selector)}`);
      if (action === "navigate") return { status: 200, finalUrl: String(args.url) };
      if (action === "getVisibleText") return { text: "Menu  Oat Milk Cortado $5.00" };
      if (action === "consoleErrors") return { consoleErrors: [], pageErrors: [] };
      if (action === "currentUrl") return { url: "http://localhost:3200/menu" };
      return {};
    },
    async close() {},
  };
  return { calls, make: () => session as never };
}

test("browser_steps runs every action in order in one call and returns each result and screenshot", async () => {
  const f = fakeSession();
  const ts = new BrowserToolset(process.cwd(), f.make);
  const r = await ts.exec("browser_steps", { steps: [
    { action: "navigate", url: "http://localhost:3200/menu" },
    { action: "console_errors" },
    { action: "get_text" },
    { action: "screenshot", outputPath: "review/menu.png" },
    { action: "click", selector: "button:has-text('Order')" },
    { action: "current_url" },
  ] });
  expect(r.status).toBe("success");
  expect(f.calls.map((c) => c.action)).toEqual(["navigate", "consoleErrors", "getVisibleText", "screenshot", "click", "currentUrl"]);
  expect(r.output).toContain("Oat Milk Cortado");
  expect(r.output).toContain("No console or page errors");
  expect(r.output).toContain("http://localhost:3200/menu");
  expect(r.images?.length).toBe(1);
  expect(r.images![0]!.split("\\").join("/")).toContain("review/menu.png");
});

test("browser_steps stops at the first failed step, names it, and keeps what ran before it", async () => {
  const f = fakeSession("click");
  const ts = new BrowserToolset(process.cwd(), f.make);
  const r = await ts.exec("browser_steps", { steps: [
    { action: "navigate", url: "http://localhost:3200/" },
    { action: "screenshot", outputPath: "review/home.png" },
    { action: "click", selector: "#missing" },
    { action: "get_text" },
  ] });
  expect(r.status).toBe("error");
  expect(r.summary).toContain("step 3 (click) failed");
  expect(f.calls.map((c) => c.action)).toEqual(["navigate", "screenshot", "click"]);
  expect(r.images?.length).toBe(1);
});

test("browser_steps refuses an empty list, too many steps, an unknown action and an outside URL", async () => {
  const f = fakeSession();
  const ts = new BrowserToolset(process.cwd(), f.make);
  expect((await ts.exec("browser_steps", { steps: [] })).status).toBe("error");
  expect((await ts.exec("browser_steps", { steps: Array.from({ length: 21 }, () => ({ action: "current_url" })) })).status).toBe("error");
  expect((await ts.exec("browser_steps", { steps: [{ action: "evaluate", script: "1" }] })).summary).toContain("unknown action");
  const outside = await ts.exec("browser_steps", { steps: [{ action: "navigate", url: "https://evil.example.com" }] });
  expect(outside.status).toBe("error");
  expect(f.calls.length).toBe(0);
});

test("the reviewers are told to group browser actions into one browser_steps call", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../../../agents/tilotma/src/tier3-review.ts", import.meta.url), "utf-8");
  expect(src).toContain("browser_steps {steps}");
  expect((src.match(/browser_steps/g) ?? []).length).toBeGreaterThanOrEqual(3);
});
