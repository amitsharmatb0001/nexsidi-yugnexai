import { describe, expect, test } from "bun:test";
import { findFreePort, isPortUsedByDocker, getRunningDeploymentPorts } from "./index.ts";

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
