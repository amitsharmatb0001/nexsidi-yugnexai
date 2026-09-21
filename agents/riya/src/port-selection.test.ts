import { describe, expect, test } from "bun:test";
import { findFreePort, isPortUsedByDocker, getRunningDeploymentPorts, ensureProjectRunning } from "./index.ts";

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

  test("fails closed (treats as used=false, not a crash) when docker CLI itself errors", () => {
    const used = isPortUsedByDocker(5435, () => {
      throw new Error("docker: command not found");
    });
    expect(used).toBe(false);
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
