// Isolated, ephemeral execution of generated code (patent claim 5).
//
// Every layer the claim names is applied to one `docker run`:
//   (a) namespaces  — PID, network, mount, UTS and IPC are private; the process is an unprivileged user (65534) with
//                     every capability dropped and no way to gain more. (A kernel user-namespace *remap* is a daemon
//                     setting, not a per-container one; see describeIsolation in the tests/docs.)
//   (b) cgroup v2   — CPU quota in microseconds, memory in bytes (no swap), process count, and disk read/write bandwidth
//                     (io.max, for a block device the daemon accepts — see detectIoDevice); the kernel's own values are
//                     read back from inside the container by the tests.
//   (c) seccomp     — Docker's built-in profile, which is a syscall WHITELIST (everything not listed fails with EPERM),
//                     plus no-new-privileges. The tests show mount and a new user namespace are refused.
//   (d) network     — none: the container has a loopback interface and nothing else, so nothing gets in or out.
//   (e) destruction — --rm removes the container the moment it ends. The time limit is enforced INSIDE the container by
//                     `timeout -s KILL` (a kernel interval timer, not a timer in our own process; run as a child of a shell,
//                     see TIMER_WRAP); the host keeps a second,
//                     later timer as a backstop and kills the container by name if even that fails.
// hostIsolationReport() says honestly which layers the host Docker daemon provides (user-namespace remap is a daemon
// setting and is usually off on a developer machine).
// The root filesystem is read-only; writes go to a size-limited tmpfs, or to a folder the caller mounts read-write.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

export interface SandboxLimits {
  cpus: number;
  memoryMb: number;
  pids: number;
  timeoutSec: number;
  /** Disk read and write bandwidth cap in MB/s. Needs a block device (ioDevice); with none, the run goes ahead unlimited and says so. */
  ioMbPerSec?: number;
  ioDevice?: string;
  /** Wrap the command in the container's own `timeout`. On by default; off for an image that has no `timeout`. */
  kernelTimer?: boolean;
}

export const DEFAULT_LIMITS: SandboxLimits = { cpus: 1, memoryMb: 512, pids: 256, timeoutSec: 120, ioMbPerSec: 200 };

// `timeout` cannot be the container's first process: the kernel ignores the signals a PID 1 process has no handler for,
// so the limit would never fire. A shell is PID 1 and `timeout` its child. The seconds travel as $0 and the command as "$@",
// so nothing from the command is ever parsed as shell text.
const TIMER_WRAP = (seconds: number) => ["sh", "-c", 'timeout -s KILL "$0" "$@"; exit $?', String(seconds)];

/** Milliseconds the host waits beyond the in-container timer before it kills the container itself. */
const HOST_GRACE_MS = 5_000;

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
  if (limits.ioMbPerSec && limits.ioDevice) {
    args.push("--device-read-bps", `${limits.ioDevice}:${limits.ioMbPerSec}mb`, "--device-write-bps", `${limits.ioDevice}:${limits.ioMbPerSec}mb`);
  }
  for (const m of spec.mounts ?? []) args.push("-v", `${m.host}:${m.container}${m.readOnly === false ? "" : ":ro"}`);
  if (spec.workdir) args.push("-w", spec.workdir);
  for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
  const wrap = limits.kernelTimer === false ? [] : TIMER_WRAP(Math.max(1, Math.ceil(limits.timeoutSec)));
  args.push(spec.image, ...wrap, ...spec.command);
  return args;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  containerName: string;
  /** "applied", or "unavailable" when no block device the daemon accepts was found, or "off". */
  ioLimit: "applied" | "unavailable" | "off";
  /** "in-container" when the command ran under its own kernel timer; "host-only" otherwise. */
  timer: "in-container" | "host-only";
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

const IO_DEVICE_CANDIDATES = ["/dev/sda", "/dev/vda", "/dev/nvme0n1", "/dev/xvda", "/dev/sdb"];
let cachedIoDevice: string | null | undefined;

/**
 * Finds a block device the Docker daemon accepts for a bandwidth limit. The device lives wherever the daemon runs
 * (inside Docker Desktop's VM on Windows), so the host's own /dev cannot be consulted: each candidate is tried with a
 * throwaway `docker run`. The answer is cached for the life of the process.
 */
export async function detectIoDevice(image: string, opts: { exec?: Exec; candidates?: string[]; cache?: boolean } = {}): Promise<string | null> {
  const useCache = opts.cache !== false;
  if (useCache && cachedIoDevice !== undefined) return cachedIoDevice;
  const exec = opts.exec ?? dockerExec;
  let found: string | null = null;
  for (const dev of opts.candidates ?? IO_DEVICE_CANDIDATES) {
    const r = await exec(["run", "--rm", "--network", "none", "--device-write-bps", `${dev}:100mb`, image, "true"], { timeoutMs: 60_000 });
    if (r.exitCode === 0) {
      found = dev;
      break;
    }
  }
  if (useCache) cachedIoDevice = found;
  return found;
}

/** Runs a command in a throwaway locked-down container and returns what it printed. The container never outlives the call. */
export async function runInSandbox(spec: SandboxSpec, deps: { exec?: Exec; hostGraceMs?: number } = {}): Promise<SandboxResult> {
  const exec = deps.exec ?? dockerExec;
  let limits = { ...DEFAULT_LIMITS, ...spec.limits };
  let ioLimit: SandboxResult["ioLimit"] = "off";
  if (limits.ioMbPerSec) {
    const device = limits.ioDevice ?? (await detectIoDevice(spec.image, { exec }));
    if (device) {
      limits = { ...limits, ioDevice: device };
      ioLimit = "applied";
    } else {
      ioLimit = "unavailable";
    }
  }
  const containerName = `nexsidi-sbx-${randomBytes(5).toString("hex")}`;
  const started = Date.now();
  const inContainerTimer = limits.kernelTimer !== false;
  const hostTimeoutMs = Math.round(limits.timeoutSec * 1000) + (inContainerTimer ? (deps.hostGraceMs ?? HOST_GRACE_MS) : 0);
  const result = await exec(buildSandboxArgs({ ...spec, limits }, containerName), { timeoutMs: hostTimeoutMs });
  const durationMs = Date.now() - started;
  let timedOut = result.timedOut;
  if (result.timedOut) {
    // Even the in-container timer did not end it: stop it by name, and make sure nothing of it remains.
    await exec(["kill", containerName], {}).catch(() => {});
    await exec(["rm", "-f", containerName], {}).catch(() => {});
  } else if (inContainerTimer && result.exitCode === 137 && durationMs >= Math.ceil(limits.timeoutSec) * 1000 - 500) {
    // Killed by the in-container timer at its limit (a memory kill is also 137, but arrives long before the limit).
    timedOut = true;
  }
  return { ...result, timedOut, durationMs, containerName, ioLimit, timer: inContainerTimer ? "in-container" : "host-only" };
}

// ── what the host actually provides ─────────────────────────────────────────

export interface DockerInfoFacts {
  cgroupV2: boolean;
  seccomp: boolean;
  userNamespaceRemap: boolean;
  rootless: boolean;
  os: string;
}

export function parseDockerInfo(json: string): DockerInfoFacts {
  const info = JSON.parse(json) as { SecurityOptions?: string[]; CgroupVersion?: string; OperatingSystem?: string };
  const opts = info.SecurityOptions ?? [];
  return {
    cgroupV2: String(info.CgroupVersion) === "2",
    seccomp: opts.some((o) => o.includes("name=seccomp")),
    userNamespaceRemap: opts.some((o) => o.includes("name=userns")),
    rootless: opts.some((o) => o.includes("name=rootless")),
    os: info.OperatingSystem ?? "unknown",
  };
}

export interface HostIsolationReport {
  reachable: boolean;
  os: string;
  layers: Array<{ name: string; active: boolean; note: string }>;
  missing: string[];
}

/** Which of the claimed isolation layers this machine's Docker daemon really provides. */
export async function hostIsolationReport(deps: { exec?: Exec } = {}): Promise<HostIsolationReport> {
  const exec = deps.exec ?? dockerExec;
  const r = await exec(["info", "--format", "{{json .}}"], { timeoutMs: 30_000 });
  if (r.exitCode !== 0) return { reachable: false, os: "unknown", layers: [], missing: ["docker not reachable"] };
  const f = parseDockerInfo(r.stdout);
  const layers = [
    { name: "cgroup v2", active: f.cgroupV2, note: "CPU, memory, process and I/O limits are kernel cgroup v2 values" },
    { name: "seccomp whitelist", active: f.seccomp, note: "Docker's default profile allows only listed system calls" },
    { name: "user-namespace remap", active: f.userNamespaceRemap, note: "a daemon setting (userns-remap in daemon.json); see docs/sandbox-linux-server.md" },
    { name: "per-container namespaces", active: true, note: "PID, network, mount, UTS and IPC are private in every run (not host settings)" },
  ];
  return { reachable: true, os: f.os, layers, missing: layers.filter((l) => !l.active).map((l) => l.name) };
}

/** The sandbox is on by default on a Linux server, off elsewhere (builds are far slower in a container on Windows), unless set explicitly. */
export function sandboxDefault(env: Record<string, string | undefined>, platform: string): boolean {
  if (env.NEXSIDI_SANDBOX_BUILDS === "on") return true;
  if (env.NEXSIDI_SANDBOX_BUILDS === "off") return false;
  return platform === "linux";
}
