// Runs a pass's own checks (type-check, build) from outside the agent, so a failure is found now with its real
// output instead of minutes later. Asynchronous on purpose: a synchronous spawn would stop the whole API from
// answering while it runs (seen in Shopbill runs 2 and 3).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface VerifyResult {
  ran: boolean; // false when the checks could not run at all (no install, timed out)
  ok: boolean;
  output: string; // the tail of what the failing command printed
}

export function runShell(command: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, output: `${out}\n(timed out after ${Math.round(timeoutMs / 1000)}s)` });
    }, timeoutMs);
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { out += String(d); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, output: String(e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output: out }); });
  });
}

const tail = (text: string, chars = 3500) => (text.length > chars ? `...${text.slice(-chars)}` : text);

/** Runs each command in order; stops at the first that fails. Needs the folder's dependencies installed. */
export async function verifyDir(dir: string, commands: { command: string; timeoutMs: number }[]): Promise<VerifyResult> {
  if (!existsSync(join(dir, "package.json")) || !existsSync(join(dir, "node_modules"))) {
    return { ran: false, ok: false, output: "" };
  }
  for (const c of commands) {
    const r = await runShell(c.command, dir, c.timeoutMs);
    if (r.code !== 0) return { ran: r.code !== null, ok: false, output: tail(r.output) };
  }
  return { ran: true, ok: true, output: "" };
}
