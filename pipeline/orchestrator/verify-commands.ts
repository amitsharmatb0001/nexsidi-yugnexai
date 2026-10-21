// Runs a pass's own checks (type-check, build) from outside the agent, so a failure is found now with its real
// output instead of minutes later. Asynchronous on purpose: a synchronous spawn would stop the whole API from
// answering while it runs (seen in Shopbill runs 2 and 3).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runInSandbox, sandboxDefault, type SandboxResult, type SandboxSpec } from "../../packages/agent-runtime/src/sandbox/container-sandbox.ts";

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

export interface VerifyDeps {
  /** Run the commands in an isolated throwaway container instead of on the host. Default: the NEXSIDI_SANDBOX_BUILDS=on switch. */
  sandbox?: boolean;
  sandboxRun?: (spec: SandboxSpec) => Promise<SandboxResult>;
  shell?: typeof runShell;
}

// Building generated code runs its build scripts, so the commands can run where generated code is meant to run: in a
// container with private namespaces, cgroup limits, a seccomp whitelist, no network and nothing left behind (patent
// claim 5). Off by default on this machine: on Windows the folder is shared into the container through a slow layer
// (measured: backend tsc 19s against 2.5s on the host, frontend tsc 95s against 2.6s), which a Linux server does not have.
const sandboxImage = () => process.env.NEXSIDI_SANDBOX_IMAGE ?? "node:22-alpine";
const forwardSlashes = (p: string) => p.split(String.fromCharCode(92)).join("/");

async function runInContainer(command: string, dir: string, timeoutMs: number, run: NonNullable<VerifyDeps["sandboxRun"]>): Promise<{ code: number | null; output: string }> {
  const r = await run({
    image: sandboxImage(),
    command: ["sh", "-c", command],
    mounts: [{ host: forwardSlashes(dir), container: "/work", readOnly: false }],
    workdir: "/work",
    env: { HOME: "/tmp", npm_config_cache: "/tmp/.npm", NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
    limits: { memoryMb: 2048, cpus: 2, pids: 1024, timeoutSec: Math.round(timeoutMs / 1000) },
  });
  if (r.timedOut) return { code: null, output: `${r.stdout}${r.stderr}
(timed out after ${Math.round(timeoutMs / 1000)}s)` };
  return { code: r.exitCode, output: `${r.stdout}${r.stderr}` };
}

/** Runs each command in order; stops at the first that fails. Needs the folder's dependencies installed. */
export async function verifyDir(dir: string, commands: { command: string; timeoutMs: number }[], deps: VerifyDeps = {}): Promise<VerifyResult> {
  if (!existsSync(join(dir, "package.json")) || !existsSync(join(dir, "node_modules"))) {
    return { ran: false, ok: false, output: "" };
  }
  const useSandbox = deps.sandbox ?? sandboxDefault(process.env, process.platform);
  const shell = deps.shell ?? runShell;
  const sandboxRun = deps.sandboxRun ?? runInSandbox;
  for (const c of commands) {
    const r = useSandbox ? await runInContainer(c.command, dir, c.timeoutMs, sandboxRun) : await shell(c.command, dir, c.timeoutMs);
    if (r.code !== 0) return { ran: r.code !== null, ok: false, output: tail(r.output) };
  }
  return { ran: true, ok: true, output: "" };
}
