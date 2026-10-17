import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneProject, rewriteHostPortsInText } from "./clone-project.ts";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const OLD = { frontendPort: 3200, backendPort: 3301, dbPort: 5437 };
const NEW = { frontendPort: 3201, backendPort: 3302, dbPort: 5438 };

// 2026-10-18 (Leafkeeper run): the clone's frontend/.env.production still named the source's backend port, so the
// delivered app's sign-up said "Failed to fetch". Only the compose file had its ports rewritten.
test("rewriteHostPortsInText moves the source's host ports, for localhost and 127.0.0.1, on whole numbers only", () => {
  const text = [
    "NEXT_PUBLIC_API_URL=http://localhost:3301",
    "CORS_ORIGIN=http://127.0.0.1:3200",
    "const API = process.env.X || 'http://localhost:3301/api';",
    "DATABASE_URL=postgresql://u:p@localhost:5437/db",
    "other=http://localhost:33010",
    "container=http://backend:3001",
  ].join("\n");
  expect(rewriteHostPortsInText(text, OLD, NEW).split("\n")).toEqual([
    "NEXT_PUBLIC_API_URL=http://localhost:3302",
    "CORS_ORIGIN=http://127.0.0.1:3201",
    "const API = process.env.X || 'http://localhost:3302/api';",
    "DATABASE_URL=postgresql://u:p@localhost:5438/db",
    "other=http://localhost:33010",
    "container=http://backend:3001",
  ]);
});

test("rewriteHostPortsInText does not chain: a new port equal to another old port is not rewritten twice", () => {
  const swapped = { frontendPort: 3301, backendPort: 3200, dbPort: 5437 };
  const text = "a=http://localhost:3200 b=http://localhost:3301";
  expect(rewriteHostPortsInText(text, OLD, swapped)).toBe("a=http://localhost:3301 b=http://localhost:3200");
});

test("a clone's .env files and source files name the clone's own ports, not the source's", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-ports-"));
  const s = join(dir, "srcaaa000001");
  mkdirSync(join(s, "frontend", "lib"), { recursive: true });
  mkdirSync(join(s, "frontend", "app"), { recursive: true });
  mkdirSync(join(s, "backend"), { recursive: true });
  writeFileSync(join(s, "frontend", "app", "page.tsx"), "export default function P() { return null; }\n");
  writeFileSync(join(s, "frontend", ".env"), "NEXT_PUBLIC_API_URL=http://localhost:3301\n");
  writeFileSync(join(s, "frontend", ".env.production"), "NEXT_PUBLIC_API_URL=http://localhost:3301\n");
  writeFileSync(join(s, "frontend", "lib", "api.ts"), 'export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3301";\n');
  writeFileSync(join(s, "backend", ".env"), "PORT=3001\nCORS_ORIGIN=http://localhost:3200\n");
  writeFileSync(join(s, "docker-compose.yml"), `services:\n  postgres:\n    ports:\n      - "5437:5432"\n  backend:\n    ports:\n      - "3301:3001"\n  frontend:\n    ports:\n      - "3200:3000"\n`);
  writeFileSync(join(s, "spec.json"), JSON.stringify({ projectId: "srcaaa000001", name: "Acme Co", description: "d" }));
  const r = await cloneProject(
    { sourceProjectId: "srcaaa000001", newProjectId: "newbbb000002", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: OLD, buildDir: dir },
    { findFreePort: async (start) => start },
  );
  const d = join(dir, "newbbb000002");
  expect(r.ports).toEqual(NEW);
  expect(readFileSync(join(d, "frontend", ".env"), "utf-8")).toBe("NEXT_PUBLIC_API_URL=http://localhost:3302\n");
  expect(readFileSync(join(d, "frontend", ".env.production"), "utf-8")).toBe("NEXT_PUBLIC_API_URL=http://localhost:3302\n");
  expect(readFileSync(join(d, "frontend", "lib", "api.ts"), "utf-8")).toContain('"http://localhost:3302"');
  expect(readFileSync(join(d, "backend", ".env"), "utf-8")).toBe("PORT=3001\nCORS_ORIGIN=http://localhost:3201\n");
  // the source is untouched
  expect(readFileSync(join(s, "frontend", ".env"), "utf-8")).toBe("NEXT_PUBLIC_API_URL=http://localhost:3301\n");
});

// 2026-10-18 (Leafkeeper run): the frontend's Dockerfile carried `ARG NEXT_PUBLIC_API_URL=http://localhost:<source port>`,
// which Next bakes into the bundle at build time. A file with no extension was never looked at.
test("a clone's Dockerfile build defaults name the clone's own ports", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-ports-"));
  const s = join(dir, "srcaaa000001");
  mkdirSync(join(s, "frontend", "app"), { recursive: true });
  writeFileSync(join(s, "frontend", "app", "page.tsx"), "export default function P() { return null; }\n");
  writeFileSync(join(s, "frontend", "Dockerfile"), "FROM node:20-alpine\nARG NEXT_PUBLIC_API_URL=http://localhost:3301\nENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL\n");
  writeFileSync(join(s, "docker-compose.yml"), `services:\n  postgres:\n    ports:\n      - "5437:5432"\n  backend:\n    ports:\n      - "3301:3001"\n  frontend:\n    ports:\n      - "3200:3000"\n`);
  writeFileSync(join(s, "spec.json"), JSON.stringify({ projectId: "srcaaa000001", name: "Acme Co", description: "d" }));
  await cloneProject(
    { sourceProjectId: "srcaaa000001", newProjectId: "newbbb000002", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: OLD, buildDir: dir },
    { findFreePort: async (start) => start },
  );
  expect(readFileSync(join(dir, "newbbb000002", "frontend", "Dockerfile"), "utf-8")).toContain("ARG NEXT_PUBLIC_API_URL=http://localhost:3302");
});
