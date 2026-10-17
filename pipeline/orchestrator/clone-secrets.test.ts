import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneProject } from "./clone-project.ts";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function allFiles(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root)) {
    const full = join(root, e);
    if (statSync(full).isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

const OLD_COMPOSE_SECRET = "bfb1e5b0feb34c3a2ce9dfb3faf1afc466cd7e0339258b9fd13a72e1c1df4668";
const OLD_ENV_SECRET = "plantly-super-secret-jwt-key-houseplant-care-tracker-2026";

// 2026-10-18 (Leafkeeper run): a clone carried its source's JWT secret, so a token signed by one app opened the other,
// and every clone of one source shared it for good. Each Express Build must sign with its own.
function makeSource(buildDir: string, id: string): void {
  const d = join(buildDir, id);
  mkdirSync(join(d, "backend"), { recursive: true });
  mkdirSync(join(d, "frontend", "app"), { recursive: true });
  writeFileSync(join(d, "frontend", "app", "page.tsx"), "export default function P() { return null; }\n");
  writeFileSync(
    join(d, "docker-compose.yml"),
    `services:\n  postgres:\n    ports:\n      - "5437:5432"\n  backend:\n    ports:\n      - "3301:3001"\n    environment:\n      JWT_SECRET: ${OLD_COMPOSE_SECRET}\n  worker:\n    environment:\n      JWT_SECRET: ${OLD_COMPOSE_SECRET}\n  frontend:\n    ports:\n      - "3200:3000"\n`,
  );
  writeFileSync(join(d, "backend", ".env"), `PORT=3001\nJWT_SECRET=${OLD_ENV_SECRET}\n`);
  writeFileSync(join(d, "spec.json"), JSON.stringify({ projectId: id, name: "Acme Co", description: "d" }));
}

async function clone(buildDir: string, src: string, to: string) {
  return cloneProject(
    { sourceProjectId: src, newProjectId: to, oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir },
    { findFreePort: async (s) => s },
  );
}

test("a clone signs with its own JWT secret: the source's secrets appear nowhere in it", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-secrets-"));
  makeSource(dir, "srcaaa000001");
  await clone(dir, "srcaaa000001", "newbbb000002");
  const stale = allFiles(join(dir, "newbbb000002")).filter((f) => {
    const t = readFileSync(f, "utf-8");
    return t.includes(OLD_COMPOSE_SECRET) || t.includes(OLD_ENV_SECRET);
  });
  expect(stale).toEqual([]);
});

test("every service in the clone that shared the source's secret still shares one (new) secret, and it is strong", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-secrets-"));
  makeSource(dir, "srcaaa000001");
  await clone(dir, "srcaaa000001", "newbbb000002");
  const compose = readFileSync(join(dir, "newbbb000002", "docker-compose.yml"), "utf-8");
  const values = [...compose.matchAll(/JWT_SECRET:\s*(\S+)/g)].map((m) => m[1]!);
  expect(values.length).toBe(2);
  expect(values[0]).toBe(values[1]);
  expect(values[0]).toMatch(/^[0-9a-f]{64}$/);
  const env = readFileSync(join(dir, "newbbb000002", "backend", ".env"), "utf-8");
  expect(env).toMatch(/JWT_SECRET=[0-9a-f]{64}\n/);
});

test("two clones of the same source get different secrets, and the source itself is untouched", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-secrets-"));
  makeSource(dir, "srcaaa000001");
  await clone(dir, "srcaaa000001", "newbbb000002");
  await clone(dir, "srcaaa000001", "newccc000003");
  const secretOf = (id: string) => /JWT_SECRET:\s*(\S+)/.exec(readFileSync(join(dir!, id, "docker-compose.yml"), "utf-8"))![1];
  expect(secretOf("newbbb000002")).not.toBe(secretOf("newccc000003"));
  expect(secretOf("srcaaa000001")).toBe(OLD_COMPOSE_SECRET);
});

test("a source with no JWT secret clones as before", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-secrets-"));
  makeSource(dir, "srcaaa000001");
  writeFileSync(join(dir, "srcaaa000001", "docker-compose.yml"), `services:\n  backend:\n    ports:\n      - "3301:3001"\n  frontend:\n    ports:\n      - "3200:3000"\n  postgres:\n    ports:\n      - "5437:5432"\n`);
  writeFileSync(join(dir, "srcaaa000001", "backend", ".env"), "PORT=3001\n");
  await clone(dir, "srcaaa000001", "newbbb000002");
  expect(readFileSync(join(dir, "newbbb000002", "backend", ".env"), "utf-8")).toBe("PORT=3001\n");
});
