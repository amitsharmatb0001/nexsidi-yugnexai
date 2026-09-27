import { describe, expect, test } from "bun:test";
import { findFreePort, isPortUsedByDocker, getRunningDeploymentPorts, ensureProjectRunning, buildAgentTask, queryDockerPublishedPorts, parsePublishedPorts, isPortFreeOnHost } from "./index.ts";
import { createServer, type Server } from "node:net";

// 2026-09-26 security fix: the deploy agent writes docker-compose.yml itself
// from this task text, so the text must spell out the localhost-only form.
// (execDockerCompose also enforces it, so a model that ignores this still
// can't publish on 0.0.0.0 — this just avoids the rewrite in the normal case.)
describe("buildAgentTask", () => {
  test("tells the deploy agent to publish every port on 127.0.0.1 only", () => {
    const task = buildAgentTask("proj1", "/tmp/proj1", 3202, 3303, 5437, "a".repeat(64));
    expect(task).toContain(`- "127.0.0.1:5437:5432"`);
    expect(task).toContain(`- "127.0.0.1:3303:3001"`);
    expect(task).toContain(`- "127.0.0.1:3202:3000"`);
  });
});

describe("isPortUsedByDocker", () => {
  test("reports a port in docker's PORTS column as used", () => {
    const dockerPsOutput = "0.0.0.0:5435->5432/tcp, [::]:5435->5432/tcp\n0.0.0.0:3300->3001/tcp\n";
    const used = isPortUsedByDocker(5435, () => dockerPsOutput);
    expect(used).toBe(true);
  });

  test("reports a port NOT in docker's PORTS column as free", () => {
    const dockerPsOutput = "0.0.0.0:5435->5432/tcp, [::]:5435->5432/tcp\n";
    const used = isPortUsedByDocker(5436, () => dockerPsOutput);
    expect(used).toBe(false);
  });

  test("recognizes a port published on 127.0.0.1 only (the form generated apps use since 2026-09-26)", () => {
    const dockerPsOutput = "127.0.0.1:3202->3000/tcp\n127.0.0.1:5437->5432/tcp\n";
    expect(isPortUsedByDocker(3202, () => dockerPsOutput)).toBe(true);
    expect(isPortUsedByDocker(3203, () => dockerPsOutput)).toBe(false);
  });

  // 2026-09-27: deliberately changed. This used to return false ("port
  // free") on ANY docker error, silently — the cause of a real collision
  // (Express Build picked 3206 while gthrdeploy45t held it). An unknown answer
  // is now reported as null and logged; findFreePort decides what to do.
  test("reports unknown (null), not free, when the docker CLI itself errors", () => {
    const used = isPortUsedByDocker(5435, () => {
      throw new Error("docker: command not found");
    }, { warn: () => {} });
    expect(used).toBeNull();
  });
});

describe("findFreePort", () => {
  test("skips a port docker reports as occupied even when a local socket bind would report it free", async () => {
    // 2026-08-10: real bug found live (freshtst1) — meridianbk4's postgres
    // container held 0.0.0.0:5435 via Docker Desktop's Windows port-forward
    // proxy, which a plain 127.0.0.1 socket-bind test does NOT reliably see
    // as occupied. findFreePort must consult docker directly, not just the
    // socket-bind fallback, or it silently hands out a colliding port.
    const port = await findFreePort(5435, 5437, {
      isPortUsedByDocker: (p) => p === 5435,
      isPortFreeOnHost: async () => true,
    });
    expect(port).toBe(5436);
  });

  test("still uses the plain socket-bind check for ports docker doesn't know about", async () => {
    const port = await findFreePort(3200, 3202, {
      isPortUsedByDocker: () => false,
      isPortFreeOnHost: async (p) => p !== 3200,
    });
    expect(port).toBe(3201);
  });
});

// 2026-08-17: real bug found live (fulfillio1-deploy-resume-2) — run()
// always scanned for FRESH free ports, even when the project was already
// deployed and running. findFreePort correctly saw the existing containers'
// ports as occupied and picked different ones for this run, but the agent
// (seeing an already-healthy deployment) didn't redeploy — leaving the OLD
// containers as the only thing actually listening, and every verification
// check hit a port nothing was bound to ("Unable to connect"). See index.ts's
// registerAndLoginTestUser fix for how that specific crash was also closed —
// this fix addresses the root cause (wrong ports computed in the first place).
describe("getRunningDeploymentPorts", () => {
  const REAL_FULFILLIO1_COMPOSE = `services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5436:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build:
      context: ./backend
    ports:
      - "3301:3001"
    depends_on:
      postgres:
        condition: service_healthy

  frontend:
    build:
      context: ./frontend
    ports:
      - "3201:3000"
    depends_on:
      - backend

volumes:
  postgres_data:
`;

  test("returns the real ports from an existing compose file whose containers are currently up", () => {
    const result = getRunningDeploymentPorts("/fake/build/dir", {
      readComposeFile: () => REAL_FULFILLIO1_COMPOSE,
      isPortUsedByDocker: (p) => p === 3201 || p === 3301,
    });
    expect(result).toEqual({ frontendPort: 3201, backendPort: 3301, dbPort: 5436 });
  });

  // 2026-09-26 security fix: new deploys publish "127.0.0.1:HOST:CONTAINER".
  // The old "HOST:CONTAINER"-only regex returned null for this form, which
  // made "open app" and the clone health check report running apps as down.
  test("reads 127.0.0.1-bound ports — the form new deploys write", () => {
    const bound = REAL_FULFILLIO1_COMPOSE.replace(/"(\d+):(\d+)"/g, `"127.0.0.1:$1:$2"`);
    expect(bound).toContain(`"127.0.0.1:3201:3000"`);
    const result = getRunningDeploymentPorts("/fake/build/dir", {
      readComposeFile: () => bound,
      isPortUsedByDocker: (p) => p === 3201 || p === 3301,
    });
    expect(result).toEqual({ frontendPort: 3201, backendPort: 3301, dbPort: 5436 });
  });

  test("returns null when no docker-compose.yml exists yet (first-ever deploy)", () => {
    const result = getRunningDeploymentPorts("/fake/build/dir", {
      readComposeFile: () => null,
      isPortUsedByDocker: () => true,
    });
    expect(result).toBeNull();
  });

  test("returns null for a stale compose file whose containers are NOT actually running — must not trust config that doesn't reflect reality", () => {
    const result = getRunningDeploymentPorts("/fake/build/dir", {
      readComposeFile: () => REAL_FULFILLIO1_COMPOSE,
      isPortUsedByDocker: () => false, // torn down / crashed — nothing actually listening
    });
    expect(result).toBeNull();
  });

  test("returns null when the compose file doesn't match the expected service/port shape", () => {
    const result = getRunningDeploymentPorts("/fake/build/dir", {
      readComposeFile: () => "services:\n  weird:\n    ports:\n      - \"9999:9999\"\n",
      isPortUsedByDocker: () => true,
    });
    expect(result).toBeNull();
  });
});

// 2026-08-31: real gap found live — apps/web's "Open app" link and preview
// iframe point straight at the stored appUrl with no check the project's
// containers are actually up. This closes it by reusing the already-tested
// getRunningDeploymentPorts (docker-verified, not just "the compose file
// exists") and only running a real `docker compose up -d` when needed.
describe("ensureProjectRunning", () => {
  const PORTS = { frontendPort: 3200, backendPort: 3300, dbPort: 5435 };

  test("does nothing and reports running=true when the project is already up", async () => {
    let execCalls = 0;
    const result = await ensureProjectRunning("/fake/build/dir", {
      getRunningDeploymentPorts: () => PORTS,
      execFn: () => { execCalls++; return ""; },
    });
    expect(result).toEqual({ running: true, started: false, ports: PORTS });
    expect(execCalls).toBe(0); // never pays for `docker compose up` when already running
  });

  test("starts the project and reports success when it was down but comes up cleanly", async () => {
    let checkCount = 0;
    const execCommands: string[] = [];
    const result = await ensureProjectRunning("/fake/build/dir", {
      // First call (before start): not running. Second call (after `up`): running.
      getRunningDeploymentPorts: () => { checkCount++; return checkCount === 1 ? null : PORTS; },
      execFn: (cmd) => { execCommands.push(cmd); return ""; },
      existsFn: () => true,
    });
    expect(result).toEqual({ running: true, started: true, ports: PORTS });
    expect(execCommands).toHaveLength(1);
    expect(execCommands[0]).toContain("docker compose");
    expect(execCommands[0]).toContain("up -d");
  });

  test("reports the real error when `docker compose up` itself throws (docker not running, etc.)", async () => {
    const result = await ensureProjectRunning("/fake/build/dir", {
      getRunningDeploymentPorts: () => null,
      execFn: () => { throw new Error("Cannot connect to the Docker daemon"); },
      existsFn: () => true,
    });
    expect(result.running).toBe(false);
    expect(result.started).toBe(false);
    expect(result.error).toContain("Cannot connect to the Docker daemon");
  });

  test("reports a clear error (not a crash) when `up` exits clean but containers still aren't reachable — a real false-success shape, not hypothetical", async () => {
    const result = await ensureProjectRunning("/fake/build/dir", {
      getRunningDeploymentPorts: () => null, // never comes up, before OR after `up`
      execFn: () => "",
      existsFn: () => true,
    });
    expect(result.running).toBe(false);
    expect(result.started).toBe(true); // `up` itself did not throw
    expect(result.error).toContain("still not reachable");
  });

  test("fails cleanly (not a crash) when there's no docker-compose.yml at all for this project", async () => {
    const result = await ensureProjectRunning("/fake/build/dir", {
      getRunningDeploymentPorts: () => null,
      existsFn: () => false,
    });
    expect(result).toEqual({ running: false, started: false, ports: null, error: "no docker-compose.yml found for this project" });
  });
});

// ── Port finder hardening (2026-09-27) ───────────────────────────────────
// Real collision: an Express Build picked frontend 3206 although
// gthrdeploy45t-frontend-1 published 0.0.0.0:3206. The first `docker ps`
// failed (fits the documented Windows "spawnSync cmd.exe ETIMEDOUT" glitch),
// the error was swallowed as "port free", and the socket fallback (127.0.0.1
// only) cannot see Docker Desktop's 0.0.0.0 publishes. Measured on this PC:
// those are visible only as a listener on ::1 (wslrelay).

const transient = () => {
  throw new Error("Error: spawnSync C:\WINDOWS\system32\cmd.exe ETIMEDOUT");
};

describe("queryDockerPublishedPorts", () => {
  test("parses every published host port, IPv4 and IPv6, into one snapshot", () => {
    const out = "0.0.0.0:3202->3000/tcp, [::]:3202->3000/tcp\n127.0.0.1:3204->3000/tcp\n\n5432/tcp\n";
    expect([...parsePublishedPorts(out)].sort()).toEqual([3202, 3204]);
  });

  test("retries once after a transient spawn failure, logs it, and returns the snapshot", () => {
    const warnings: string[] = [];
    let calls = 0;
    const snap = queryDockerPublishedPorts((cmd) => {
      calls++;
      if (calls === 1) transient();
      return "127.0.0.1:3206->3000/tcp\n";
    }, { warn: (m) => warnings.push(m) });
    expect(calls).toBe(2);
    expect(snap && [...snap]).toEqual([3206]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("ETIMEDOUT");
  });

  test("does not retry a non-transient error; returns null (unknown) and logs", () => {
    const warnings: string[] = [];
    let calls = 0;
    const snap = queryDockerPublishedPorts(() => {
      calls++;
      throw new Error("docker: command not found");
    }, { warn: (m) => warnings.push(m) });
    expect(calls).toBe(1);
    expect(snap).toBeNull();
    expect(warnings[0]).toContain("docker: command not found");
  });

  test("gives up after the retry also fails", () => {
    let calls = 0;
    const snap = queryDockerPublishedPorts(() => { calls++; return transient(); }, { warn: () => {} });
    expect(calls).toBe(2);
    expect(snap).toBeNull();
  });
});

describe("findFreePort (hardened)", () => {
  test("asks docker once per search, not once per candidate port", async () => {
    let dockerCalls = 0;
    const port = await findFreePort(3201, 3210, {
      dockerPorts: () => { dockerCalls++; return new Set([3201, 3202, 3203, 3204, 3205, 3206]); },
      isPortFreeOnHost: async () => true,
    });
    expect(port).toBe(3207);
    expect(dockerCalls).toBe(1);
  });

  test("when docker can't be asked, relies on the socket check and warns once", async () => {
    const warnings: string[] = [];
    const port = await findFreePort(3201, 3210, {
      dockerPorts: () => null,
      isPortFreeOnHost: async (p) => p >= 3207,
      warn: (m) => warnings.push(m),
    });
    expect(port).toBe(3207);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("socket check");
  });

  test("throws when every port in the range is in use, instead of handing out a taken one", async () => {
    await expect(findFreePort(3201, 3203, {
      dockerPorts: () => new Set([3201, 3202]),
      isPortFreeOnHost: async (p) => p !== 3203,
    })).rejects.toThrow("no free port in 3201-3203");
  });
});

describe("isPortFreeOnHost (real sockets)", () => {
  async function holdPort(host: string): Promise<{ port: number; server: Server } | null> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(null)); // e.g. no IPv6 on this machine
      server.listen({ port: 0, host, ipv6Only: host.includes(":") }, () => {
        resolve({ port: (server.address() as { port: number }).port, server });
      });
    });
  }

  test("sees a port held on ::1 — how Docker Desktop's 0.0.0.0 publishes appear on Windows", async () => {
    const held = await holdPort("::1");
    if (!held) return; // no IPv6 loopback available here; nothing to check
    try {
      expect(await isPortFreeOnHost(held.port)).toBe(false);
    } finally {
      held.server.close();
    }
  });

  test("sees a port held on 127.0.0.1, and reports a truly free port as free", async () => {
    const held = await holdPort("127.0.0.1");
    try {
      expect(await isPortFreeOnHost(held!.port)).toBe(false);
    } finally {
      held!.server.close();
    }
    const probe = await holdPort("127.0.0.1");
    const freePort = probe!.port;
    await new Promise((r) => probe!.server.close(r));
    expect(await isPortFreeOnHost(freePort)).toBe(true);
  });
});

describe("getRunningDeploymentPorts (hardened)", () => {
  const compose = `services:\n  postgres:\n    ports:\n      - "127.0.0.1:5436:5432"\n  backend:\n    ports:\n      - "127.0.0.1:3301:3001"\n  frontend:\n    ports:\n      - "127.0.0.1:3201:3000"\n`;

  test("uses one docker snapshot and returns the ports when they are published", () => {
    let calls = 0;
    const result = getRunningDeploymentPorts("/fake", { readComposeFile: () => compose, dockerPorts: () => { calls++; return new Set([3201, 3301, 5436]); } });
    expect(result).toEqual({ frontendPort: 3201, backendPort: 3301, dbPort: 5436 });
    expect(calls).toBe(1);
  });

  test("returns null (not running) when docker can't be asked — only docker can confirm the containers are ours", () => {
    const result = getRunningDeploymentPorts("/fake", { readComposeFile: () => compose, dockerPorts: () => null });
    expect(result).toBeNull();
  });
});
