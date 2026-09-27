import { join, resolve, sep } from "path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { BrowserSession } from "../browser/client.ts";
import type { EvidenceLedger } from "../enforce/evidence.ts";

// 2026-07-11: the entire multi-session screenshot saga (host GPU crashes,
// connectOverCDP hangs, the Docker/CDP-proxy apparatus) had ONE root cause,
// proven with a controlled experiment: Playwright's browser layer does not
// work under Bun, only under Node (see browser/worker.mjs header). This tool
// now delegates to the Node browser worker (one-shot: navigate + screenshot),
// same as the interactive browser_* tools. No container, no proxy — plain
// chromium.launch() under Node works on the host.
//
// Superseded for interactive review by tools/browser.ts's browser_screenshot
// (which screenshots the CURRENT page after navigate/click/fill). This
// standalone {url,outputPath} form is kept for any caller that just wants a
// one-shot screenshot of a single URL.

// 2026-09-28: screenshots used to resolve against the WORKER's cwd (the
// NexSidi repo) — screenshot.png and review/*.png landed in our own repo.
// They now go under the agent's own workspace, in a hidden evidence folder
// that the delivery .gitignore (tools/git.ts) and the IDE file tree
// (pipeline-files.ts) both exclude, so QA evidence never ships to a customer.
export const EVIDENCE_DIR = ".nexsidi-evidence";

export function resolveEvidencePath(workspace: string, outputPath: string): { abs: string } | { error: string } {
  const base = resolve(join(workspace, EVIDENCE_DIR));
  const abs = resolve(base, outputPath);
  if (abs !== base && !abs.startsWith(base + sep)) {
    return { error: "outputPath escapes the working directory" };
  }
  return { abs };
}

export async function execScreenshot(
  args: { url: string; outputPath: string },
  ledger?: EvidenceLedger,
  workspace: string = process.cwd(),
): Promise<ToolResult> {
  let parsed: URL;
  try { parsed = new URL(args.url); } catch { return { status: "error", summary: `screenshot: invalid URL '${args.url}'` }; }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return { status: "error", summary: `screenshot blocked: only localhost allowed, got '${parsed.hostname}'` };
  }
  const target = resolveEvidencePath(workspace, args.outputPath);
  if ("error" in target) {
    return { status: "error", summary: "screenshot outputPath escapes the working directory" };
  }
  const outAbs = target.abs;

  const session = new BrowserSession();
  try {
    await session.send("navigate", { url: args.url });
    await session.send("screenshot", { path: outAbs, fullPage: true });
    // 2026-08-10: records "visual_check" evidence — see evidence.ts's header
    // comment. Only on real success (guard clauses above and a thrown
    // browser error both skip this), same convention as http_check.
    ledger?.record("visual_check", `screenshot ${args.url} -> ${args.outputPath}`);
    return { status: "success", summary: `Screenshot saved to ${args.outputPath}`, output: outAbs };
  } catch (err) {
    return { status: "error", summary: `screenshot failed: ${String(err instanceof Error ? err.message : err)}` };
  } finally {
    await session.close();
  }
}

export const SCREENSHOT_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "screenshot",
    description: "Take a screenshot of a running localhost app for visual QA review (padding, layout, broken CSS). Use before judging any visual claim.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Localhost URL to screenshot" },
        outputPath: { type: "string", description: "Relative path to save the PNG" },
      },
      required: ["url", "outputPath"],
    },
  },
};
