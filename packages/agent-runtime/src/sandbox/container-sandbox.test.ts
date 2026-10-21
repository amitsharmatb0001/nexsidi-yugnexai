import { test, expect, describe } from "bun:test";
import { spawnSync } from "node:child_process";
import { buildSandboxArgs, runInSandbox, DEFAULT_LIMITS } from "./container-sandbox.ts";

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
    const a = buildSandboxArgs({ image: "node:22-alpine", command: ["ls"], mounts: [{ host: "E:/x", container: "/work" }, { host: "E:/y", container: "/out", readOnly: false }] }, "n");
    expect(a).toContain("E:/x:/work:ro");
    expect(a).toContain("E:/y:/out");
    expect(a.slice(-2)).toEqual(["node:22-alpine", "ls"]);
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
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sleep", "99"], limits: { timeoutSec: 0.05 } }, { exec });
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
    expect(r.stdout).toContain("pid=1 ");
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

  test("a read-only mounted folder can be read but not changed", async () => {
    const r = await runInSandbox({ image: "node:22-alpine", command: ["sh", "-c", "ls /work >/dev/null; echo read=$?; touch /work/new 2>/dev/null; echo write=$?"], mounts: [{ host: process.cwd().replace(/\\/g, "/"), container: "/work" }], limits: { timeoutSec: 60 } });
    expect(r.stdout).toContain("read=0");
    expect(r.stdout).toContain("write=1");
  }, 90_000);
});
