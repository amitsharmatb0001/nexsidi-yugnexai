import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redeployRunningApp, existingJwtSecret } from "./index.ts";

// 2026-10-24 (Brewline root cause): every redeploy after a fix round ran the deploy agent again — 19 model calls that
// re-read the same Dockerfiles and compose file — and generated a NEW JWT secret that the agent then wrote into the
// compose file (the value ended up in the logs six times, and on a real app it would sign every user out). Now a running
// app is redeployed by the system: same secret, `docker compose up -d --build`, then health checks. The agent runs only
// if that fails, or for a first deploy.

let dir = "";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const COMPOSE = `services:
  backend:
    build: ./backend
    ports:
      - "127.0.0.1:3300:3001"
    environment:
      JWT_SECRET: "abc123secret"
  frontend:
    build: ./frontend
    ports:
      - "127.0.0.1:3200:3000"
`;

test("the existing JWT secret is read from the compose file and kept", () => {
  expect(existingJwtSecret(COMPOSE)).toBe("abc123secret");
  expect(existingJwtSecret("services: {}")).toBeNull();
});

test("a running app is rebuilt and health-checked by the system, without the agent", async () => {
  dir = mkdtempSync(join(tmpdir(), "redeploy-"));
  writeFileSync(join(dir, "docker-compose.yml"), COMPOSE);
  const commands: string[] = [];
  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
  const r = await redeployRunningApp(dir, "http://localhost:3200", "http://localhost:3300", { exec: (c) => { commands.push(c); return ""; }, pollMs: 1 });
  expect(r).toEqual({ ok: true });
  expect(commands.some((c) => c.includes("up -d --build"))).toBe(true);
  expect(readFileSync(join(dir, "docker-compose.yml"), "utf-8")).toContain("abc123secret");
});

test("if the rebuild or health check fails, it says why (the agent then takes over)", async () => {
  dir = mkdtempSync(join(tmpdir(), "redeploy-"));
  writeFileSync(join(dir, "docker-compose.yml"), COMPOSE);
  const failedBuild = await redeployRunningApp(dir, "http://localhost:3200", "http://localhost:3300", { exec: () => { throw new Error("build failed: npm ERR"); }, pollMs: 1 });
  expect(failedBuild).toEqual({ ok: false, reason: expect.stringContaining("build failed") });
  globalThis.fetch = (async () => new Response("down", { status: 502 })) as unknown as typeof fetch;
  const unhealthy = await redeployRunningApp(dir, "http://localhost:3200", "http://localhost:3300", { exec: () => "", pollMs: 1, waitMs: 20 });
  expect(unhealthy).toEqual({ ok: false, reason: expect.stringContaining("did not answer") });
});

test("the deploy step uses the fast path for a running app and keeps the secret for the agent path too", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toContain("await redeployRunningApp(buildDir, appUrl, backendUrl)");
  expect(src).toContain("existingJwtSecret(");
});

// 2026-10-30 (team plan, stage 4): the acceptance gate rebuilds the app after every fix. The rebuild ran with execSync,
// which blocks the activity for the whole image build, so its heartbeat could not fire (the failure docker.ts documents
// for the docker tool). The command now runs without blocking, and an exec that answers later is awaited.
test("a rebuild that finishes later is waited for, and one that fails later is reported", async () => {
  dir = mkdtempSync(join(tmpdir(), "redeploy-"));
  writeFileSync(join(dir, "docker-compose.yml"), COMPOSE);
  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
  let finished = false;
  const later = await redeployRunningApp(dir, "http://localhost:3200", "http://localhost:3300", {
    exec: () => new Promise<string>((r) => setTimeout(() => { finished = true; r(""); }, 20)),
    pollMs: 1,
  });
  expect(later).toEqual({ ok: true });
  expect(finished).toBe(true);
  const failedLater = await redeployRunningApp(dir, "http://localhost:3200", "http://localhost:3300", { exec: () => Promise.reject(new Error("build failed: TS2304")), pollMs: 1 });
  expect(failedLater).toEqual({ ok: false, reason: expect.stringContaining("TS2304") });
});

test("the default rebuild command does not block the process", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("export async function redeployRunningApp("), src.indexOf("export async function redeployRunningApp(") + 1_500);
  expect(fn).not.toContain("execSync(");
  expect(fn).toContain("await exec(");
});
