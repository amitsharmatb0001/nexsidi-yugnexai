import { test, expect, describe } from "bun:test";
import { spawnSync } from "node:child_process";
import { buildSandboxArgs, runInSandbox, DEFAULT_LIMITS, detectIoDevice, hostIsolationReport, parseDockerInfo, sandboxDefault } from "./container-sandbox.ts";

// Patent claim 5: an isolated containerized execution environment — PID, network, mount, user, UTS and IPC namespace
// isolation; cgroup v2 CPU quotas, memory limits and I/O limits; a seccomp syscall whitelist; all network ingress and
// egress blocked; and automatic destruction of the container immediately after the run.

// ── the arguments (pure) ────────────────────────────────────────────────────
describe("buildSandboxArgs", () => {
  const args = buildSandboxArgs({ image: "node:22-alpine", command: ["echo", "hi"] }, "sbx-test");
  const has = (flag: string, value?: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && (value === undefined || args[i + 1] === value);
  };

  test("the container is destroyed when it ends, and has a name so it can be stopped", () => {
    expect(args[0]).toBe("run");
    expect(has("--rm")).toBe(true);
    expect(has("--name", "sbx-test")).toBe(true);
  });

  test("it has no network at all unless one is asked for", () => {
    expect(has("--network", "none")).toBe(true);
    expect(buildSandboxArgs({ image: "a", command: ["x"], network: "bridge" }, "n")).toContain("bridge");
  });

  test("it runs as an unprivileged user with every capability dropped and no way to gain more", () => {
    expect(has("--user", "65534:65534")).toBe(true);
    expect(has("--cap-drop", "ALL")).toBe(true);
    expect(has("--security-opt", "no-new-privileges")).toBe(true);
  });

  test("its namespaces are private, its root is read-only, and writes go to a size-limited tmpfs", () => {
    expect(has("--pid", undefined)).toBe(false); // the default private PID namespace is not replaced
    expect(has("--ipc", "private")).toBe(true);
    expect(has("--read-only")).toBe(true);
    expect(args.some((a) => a.startsWith("/tmp:") || a.includes("/tmp:rw"))).toBe(true);
  });

  test("CPU quota in microseconds, memory in bytes (no swap) and process count are set from the limits", () => {
    const a = buildSandboxArgs({ image: "a", command: ["x"], limits: { cpus: 0.5, memoryMb: 128, pids: 40 } }, "n");
    expect(a[a.indexOf("--cpu-quota") + 1]).toBe("50000");
    expect(a[a.indexOf("--cpu-period") + 1]).toBe("100000");
    expect(a[a.indexOf("--memory") + 1]).toBe("128m");
    expect(a[a.indexOf("--memory-swap") + 1]).toBe("128m");
    expect(a[a.indexOf("--pids-limit") + 1]).toBe("40");
  });

  test("the defaults are small and finite", () => {
    expect(DEFAULT_LIMITS.memoryMb).toBeLessThanOrEqual(1024);
    expect(DEFAULT_LIMITS.pids).toBeLessThanOrEqual(512);
    expect(DEFAULT_LIMITS.timeoutSec).toBeLessThanOrEqual(600);
  });

  test("mounts are read-only unless the caller says otherwise, and the command comes last", () => {
    const a = buildSandboxArgs({ image: "node:22-alpine", command: ["ls"], limits: { kernelTimer: false }, mounts: [{ host: "E:/x", container: "/work" }, { host: "E:/y", container: "/out", readOnly: false }] }, "n");
    expect(a).toContain("E:/x:/work:ro");
    expect(a).toContain("E:/y:/out");
    expect(a.slice(-2)).toEqual(["node:22-alpine", "ls"]);
  });
});

// ── gaps closed 2026-10-21: I/O limit, in-container (kernel) timer, host isolation report, default on Linux ──
describe("I/O bandwidth limit", () => {
  test("read and write bandwidth limits are passed for the chosen device", () => {
    const a = buildSandboxArgs({ image: "a", command: ["x"], limits: { ioMbPerSec: 20, ioDevice: "/dev/sda" } }, "n");
    expect(a[a.indexOf("--device-read-bps") + 1]).toBe("/dev/sda:20mb");
    expect(a[a.indexOf("--device-write-bps") + 1]).toBe("/dev/sda:20mb");
  });
  test("with no device known, no I/O flag is passed (the limit is reported as unavailable instead of failing the run)", () => {
    const a = buildSandboxArgs({ image: "a", command: ["x"], limits: { ioMbPerSec: 20 } }, "n");
    expect(a).not.toContain("--device-read-bps");
  });
  test("detectIoDevice returns the first candidate the daemon accepts, and null when none is accepted", async () => {
    const tried: string[] = [];
    const ok = async (argv: string[]) => {
      const dev = argv[argv.indexOf("--device-write-bps") + 1]!.split(":")[0]!;
      tried.push(dev);
      return { exitCode: dev === "/dev/vda" ? 0 : 125, stdout: "", stderr: "", timedOut: false };
    };
    expect(await detectIoDevice("img", { exec: ok, candidates: ["/dev/sda", "/dev/vda", "/dev/xvda"], cache: false })).toBe("/dev/vda");
    expect(tried).toEqual(["/dev/sda", "/dev/vda"]);
    const none = async () => ({ exitCode: 125, stdout: "", stderr: "", timedOut: false });
    expect(await detectIoDevice("img", { exec: none, candidates: ["/dev/sda"], cache: false })).toBeNull();
  });
});

describe("in-container timer", () => {
  test("the command is wrapped in the container's own timeout so the kernel timer ends it, with a host-side backstop", () => {
    const a = buildSandboxArgs({ image: "img", command: ["sleep", "9"], limits: { timeoutSec: 30 } }, "n");
    const i = a.indexOf("img");
    expect(a.slice(i)).toEqual(["img", "sh", "-c", 'timeout -s KILL "$0" "$@"; exit $?', "30", "sleep", "9"]);
  });
  test("a fractional limit is rounded up to a whole second", () => {
    const a = buildSandboxArgs({ image: "img", command: ["x"], limits: { timeoutSec: 0.05 } }, "n");
    expect(a.slice(a.indexOf("img")).slice(4)).toEqual(["1", "x"]);
  });
  test("it can be turned off for an image without a timeout command", () => {
    const a = buildSandboxArgs({ image: "img", command: ["x"], limits: { kernelTimer: false } }, "n");
    expect(a.slice(-2)).toEqual(["img", "x"]);
  });
});

describe("host isolation report", () => {
  const info = (over: object = {}) => JSON.stringify({ SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"], CgroupVersion: "2", OperatingSystem: "Docker Desktop", ...over });
  test("parseDockerInfo reads cgroup version, seccomp, and user-namespace remapping", () => {
    expect(parseDockerInfo(info())).toEqual({ cgroupV2: true, seccomp: true, userNamespaceRemap: false, rootless: false, os: "Docker Desktop" });
    expect(parseDockerInfo(info({ SecurityOptions: ["name=seccomp,profile=builtin", "name=userns", "name=rootless"] }))).toMatchObject({ userNamespaceRemap: true, rootless: true });
    expect(parseDockerInfo(info({ CgroupVersion: "1" })).cgroupV2).toBe(false);
  });
  test("hostIsolationReport says plainly which layers are missing on this host", async () => {
    const exec = async () => ({ exitCode: 0, stdout: info(), stderr: "", timedOut: false });
    const r = await hostIsolationReport({ exec });
    expect(r.layers.find((l) => l.name === "user-namespace remap")!.active).toBe(false);
    expect(r.layers.find((l) => l.name === "cgroup v2")!.active).toBe(true);
    expect(r.missing).toContain("user-namespace remap");
    expect(r.missing).not.toContain("cgroup v2");
  });
  test("if docker cannot be reached the report says so instead of throwing", async () => {
    const r = await hostIsolationReport({ exec: async () => ({ exitCode: 1, stdout: "", stderr: "no docker", timedOut: false }) });
    expect(r.reachable).toBe(false);
  });
});

describe("sandboxDefault", () => {
  test("an explicit on/off wins; otherwise it is on for a Linux server and off elsewhere", () => {
    expect(sandboxDefault({ NEXSIDI_SANDBOX_BUILDS: "on" }, "win32")).toBe(true);
    expect(sandboxDefault({ NEXSIDI_SANDBOX_BUILDS: "off" }, "linux")).toBe(false);
    expect(sandboxDefault({}, "linux")).toBe(true);
    expect(sandboxDefault({}, "win32")).toBe(false);
    expect(sandboxDefault({}, "darwin")).toBe(false);
  });
});

// ── a timeout kills the container (with a fake docker, so no real container is needed) ──
describe("runInSandbox timeout", () => {
  test("a run that outlasts its limit is killed by name and reported as timed out", async () => {
    const calls: string[][] = [];
    const exec = async (argv: string[], opts: { timeoutMs?: number }) => {
      calls.push(argv);
      if (argv[0] === "run") {
        await new Promise((r) => setTimeout(r, (opts.timeoutMs ?? 0) + 30));
        return { exitCode: null, stdout: "", stderr: "", timedOut: true };
      }
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sleep", "99"], limits: { timeoutSec: 0.05, ioMbPerSec: 0 } }, { exec, hostGraceMs: 0 });
    expect(r.timedOut).toBe(true);
    expect(calls.some((c) => c[0] === "kill")).toBe(true);
    expect(calls.some((c) => c[0] === "rm")).toBe(true);
  });
});

// ── against a real container: each layer is observed from INSIDE it ──────────
const dockerUp = (() => {
  try {
    return spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
})();
const real = dockerUp ? describe : describe.skip;

real("a real container", () => {
  const run = (command: string, over: Record<string, unknown> = {}) =>
    runInSandbox({ image: "node:22-alpine", command: ["sh", "-c", command], limits: { timeoutSec: 60, ...(over.limits as object) }, ...over });

  test("namespaces: it is PID 1 in its own process space, as an unprivileged user, with its own hostname", async () => {
    const r = await run("echo pid=$$ uid=$(id -u) host=$(hostname)");
    const pid = Number(/pid=(\d+) /.exec(r.stdout)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(pid).toBeLessThan(20); // a private PID namespace: host PIDs are far larger
    expect(r.stdout).toContain("uid=65534");
    expect(r.stdout).not.toContain(`host=${process.env.COMPUTERNAME ?? "__none__"}`);
  }, 90_000);

  test("cgroup v2: the CPU quota, the memory limit and the process limit are visible as the kernel's own values", async () => {
    const r = await run("echo cpu=$(cat /sys/fs/cgroup/cpu.max) mem=$(cat /sys/fs/cgroup/memory.max) pids=$(cat /sys/fs/cgroup/pids.max)", { limits: { cpus: 0.5, memoryMb: 128, pids: 40 } });
    expect(r.stdout).toContain("cpu=50000 100000");
    expect(r.stdout).toContain(`mem=${128 * 1024 * 1024}`);
    expect(r.stdout).toContain("pids=40");
  }, 90_000);

  test("seccomp: a syscall filter is active, and creating a new user namespace or mounting is refused", async () => {
    const r = await run("grep ^Seccomp: /proc/self/status; unshare -U true 2>&1 | head -1; echo mount-exit=$(mount -t tmpfs none /mnt >/dev/null 2>&1; echo $?)");
    expect(r.stdout).toMatch(/Seccomp:\s+2/);
    expect(r.stdout.toLowerCase()).toMatch(/operation not permitted|permission denied/);
    expect(r.stdout).toContain("mount-exit=1");
  }, 90_000);

  test("network: nothing gets in or out", async () => {
    const r = await run("wget -q -T 3 -O- http://1.1.1.1 >/dev/null 2>&1; echo wget-exit=$?; ls /sys/class/net | tr '\\n' ' '");
    expect(r.stdout).not.toContain("wget-exit=0");
    expect(r.stdout.trim().endsWith("lo")).toBe(true);
  }, 90_000);

  test("the root filesystem cannot be written to, but /tmp can", async () => {
    const r = await run("touch /x 2>/dev/null; echo root-write=$?; touch /tmp/ok; echo tmp-write=$?");
    expect(r.stdout).toContain("root-write=1");
    expect(r.stdout).toContain("tmp-write=0");
  }, 90_000);

  test("memory: a program that allocates more than its limit is killed by the kernel", async () => {
    const r = await runInSandbox({ image: "node:22-alpine", command: ["node", "-e", "const a=[];for(;;)a.push(Buffer.alloc(8e6,1))"], limits: { memoryMb: 64, timeoutSec: 60 } });
    expect(r.exitCode).toBe(137);
  }, 120_000);

  test("destruction: the container is gone as soon as the run ends", async () => {
    const r = await run("echo done");
    expect(r.exitCode).toBe(0);
    const left = spawnSync("docker", ["ps", "-a", "--filter", `name=${r.containerName}`, "--format", "{{.Names}}"], { encoding: "utf8" });
    expect(left.stdout.trim()).toBe("");
  }, 90_000);

  test("timeout: a run past its limit is stopped and the container removed", async () => {
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sleep", "60"], limits: { timeoutSec: 3 } });
    expect(r.timedOut).toBe(true);
    const left = spawnSync("docker", ["ps", "-a", "--filter", `name=${r.containerName}`, "--format", "{{.Names}}"], { encoding: "utf8" });
    expect(left.stdout.trim()).toBe("");
  }, 90_000);

  test("I/O limit: the kernel's own io.max shows the bandwidth cap for the detected device", async () => {
    const dev = await detectIoDevice("node:22-alpine", { cache: false });
    if (!dev) return; // no block device the daemon accepts on this host: reported as unavailable, nothing to observe
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sh", "-c", "cat /sys/fs/cgroup/io.max"], limits: { timeoutSec: 60, ioMbPerSec: 25, ioDevice: dev } });
    expect(r.stdout).toContain("rbps=26214400");
    expect(r.stdout).toContain("wbps=26214400");
  }, 120_000);

  test("kernel timer: the command ends itself at the limit, reported as timed out, container gone", async () => {
    const t0 = Date.now();
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sleep", "60"], limits: { timeoutSec: 2 } });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBe(137);
    expect(Date.now() - t0).toBeLessThan(30_000);
    const left = spawnSync("docker", ["ps", "-a", "--filter", `name=${r.containerName}`, "--format", "{{.Names}}"], { encoding: "utf8" });
    expect(left.stdout.trim()).toBe("");
  }, 90_000);

  test("a command that finishes inside its limit is not reported as timed out and keeps its exit code", async () => {
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sh", "-c", "exit 3"], limits: { timeoutSec: 30 } });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(3);
  }, 90_000);

  test("the host isolation report reads the real daemon", async () => {
    const r = await hostIsolationReport();
    expect(r.reachable).toBe(true);
    expect(r.layers.length).toBeGreaterThan(3);
  }, 60_000);

  test("a read-only mounted folder can be read but not changed", async () => {
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sh", "-c", "ls /work >/dev/null; echo read=$?; touch /work/new 2>/dev/null; echo write=$?"], mounts: [{ host: process.cwd().replace(/\\/g, "/"), container: "/work" }], limits: { timeoutSec: 60 } });
    expect(r.stdout).toContain("read=0");
    expect(r.stdout).toContain("write=1");
  }, 90_000);
});
