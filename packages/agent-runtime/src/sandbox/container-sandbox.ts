// Isolated, ephemeral execution of generated code (patent claim 5).
//
// Every layer the claim names is applied to one `docker run`:
//   (a) namespaces  — PID, network, mount, UTS and IPC are private; the process is an unprivileged user (65534) with
//                     every capability dropped and no way to gain more. (A kernel user-namespace *remap* is a daemon
//                     setting, not a per-container one; see describeIsolation in the tests/docs.)
//   (b) cgroup v2   — CPU quota in microseconds, memory in bytes (no swap), process count; the kernel's own values are
//                     read back from inside the container by the tests.
//   (c) seccomp     — Docker's built-in profile, which is a syscall WHITELIST (everything not listed fails with EPERM),
//                     plus no-new-privileges. The tests show mount and a new user namespace are refused.
//   (d) network     — none: the container has a loopback interface and nothing else, so nothing gets in or out.
//   (e) destruction — --rm removes the container the moment it ends; a run past its time limit is killed by name and
//                     removed.
// The root filesystem is read-only; writes go to a size-limited tmpfs, or to a folder the caller mounts read-write.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

export interface SandboxLimits {
  cpus: number;
  memoryMb: number;
  pids: number;
  timeoutSec: number;
}

export const DEFAULT_LIMITS: SandboxLimits = { cpus: 1, memoryMb: 512, pids: 256, timeoutSec: 120 };

export interface SandboxSpec {
  image: string;
  command: string[];
  mounts?: Array<{ host: string; container: string; readOnly?: boolean }>;
  workdir?: string;
  env?: Record<string, string>;
  limits?: Partial<SandboxLimits>;
  /** "none" unless the caller explicitly allows a network (a dependency install, for example). */
  network?: "none" | "bridge";
}

const CPU_PERIOD_US = 100_000;

/** The `docker` arguments for one sandboxed run. */
export function buildSandboxArgs(spec: SandboxSpec, name: string): string[] {
  const limits = { ...DEFAULT_LIMITS, ...spec.limits };
  const args = [
    "run",
    "--rm",
    "--name", name,
    "--network", spec.network ?? "none",
    "--ipc", "private",
    "--user", "65534:65534",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--cpu-period", String(CPU_PERIOD_US),
    "--cpu-quota", String(Math.round(limits.cpus * CPU_PERIOD_US)),
    "--memory", `${limits.memoryMb}m`,
    "--memory-swap", `${limits.memoryMb}m`,
    "--pids-limit", String(limits.pids),
    "--read-only",
    "--tmpfs", "/tmp:rw,size=64m,mode=1777",
  ];
  for (const m of spec.mounts ?? []) args.push("-v", `${m.host}:${m.container}${m.readOnly === false ? "" : ":ro"}`);
  if (spec.workdir) args.push("-w", spec.workdir);
  for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
  args.push(spec.image, ...spec.command);
  return args;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  containerName: string;
}

interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type Exec = (argv: string[], opts: { timeoutMs?: number }) => Promise<ExecResult>;

const dockerExec: Exec = (argv, opts) =>
  new Promise((resolve) => {
    const proc = spawn("docker", argv, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; proc.kill(); }, opts.timeoutMs) : null;
    proc.stdout.on("data", (c) => { stdout += c; });
    proc.stderr.on("data", (c) => { stderr += c; });
    proc.on("error", (err) => { if (timer) clearTimeout(timer); resolve({ exitCode: null, stdout, stderr: stderr + String(err), timedOut }); });
    proc.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ exitCode: code, stdout, stderr, timedOut }); });
  });

/** Runs a command in a throwaway locked-down container and returns what it printed. The container never outlives the call. */
export async function runInSandbox(spec: SandboxSpec, deps: { exec?: Exec } = {}): Promise<SandboxResult> {
  const exec = deps.exec ?? dockerExec;
  const limits = { ...DEFAULT_LIMITS, ...spec.limits };
  const containerName = `nexsidi-sbx-${randomBytes(5).toString("hex")}`;
  const started = Date.now();
  const result = await exec(buildSandboxArgs(spec, containerName), { timeoutMs: Math.round(limits.timeoutSec * 1000) });
  if (result.timedOut) {
    // The run outlasted its limit: stop it by name, and make sure nothing of it remains.
    await exec(["kill", containerName], {}).catch(() => {});
    await exec(["rm", "-f", containerName], {}).catch(() => {});
  }
  return { ...result, durationMs: Date.now() - started, containerName };
}
