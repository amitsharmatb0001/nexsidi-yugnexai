import { describe, expect, test } from "bun:test";
import { findFreePort, isPortUsedByDocker } from "./index.ts";

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
