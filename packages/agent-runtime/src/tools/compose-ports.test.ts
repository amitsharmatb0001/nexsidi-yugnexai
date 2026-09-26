import { test, expect } from "bun:test";
import { join } from "node:path";
import { parseServiceHostPort, bindComposePortsToLoopback, prepareComposeForUp } from "./compose-ports.ts";

// Same shape as a real generated compose file: services literally named
// postgres/backend/frontend, 2-space service keys, 4-space nested keys.
const compose = (fe: string, be: string, db: string) =>
  `services:\n  postgres:\n    image: postgres:16\n    ports:\n      - ${db}\n  backend:\n    build: ./backend\n    ports:\n      - ${be}\n  frontend:\n    build: ./frontend\n    ports:\n      - ${fe}\n`;

test("parseServiceHostPort reads plain, loopback-bound, 0.0.0.0-bound, unquoted and /tcp forms", () => {
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`"127.0.0.1:3202:3000"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`"0.0.0.0:3202:3000"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`3202:3000`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`"127.0.0.1:3202:3000/tcp"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  // "image: postgres:16" sits in the same block but is not a port entry
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`), "postgres")).toBe(5437);
});

test("parseServiceHostPort handles CRLF files and returns null for a missing service", () => {
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`).replace(/\n/g, "\r\n"), "backend")).toBe(3303);
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`), "redis")).toBeNull();
});

test("bindComposePortsToLoopback binds plain and 0.0.0.0 entries, keeps indentation, always double-quotes", () => {
  const r = bindComposePortsToLoopback(compose(`3202:3000`, `"0.0.0.0:3303:3001"`, `'5437:5432'`));
  expect(r.changed).toBe(3);
  expect(r.unsupported).toEqual([]);
  expect(r.content).toContain(`      - "127.0.0.1:3202:3000"\n`);
  expect(r.content).toContain(`      - "127.0.0.1:3303:3001"\n`);
  expect(r.content).toContain(`      - "127.0.0.1:5437:5432"\n`);
  expect(r.content).toContain("    image: postgres:16\n"); // non-port lines untouched
});

test("bindComposePortsToLoopback preserves CRLF line endings", () => {
  const r = bindComposePortsToLoopback(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`).replace(/\n/g, "\r\n"));
  expect(r.changed).toBe(3);
  expect(r.content).toContain(`      - "127.0.0.1:3202:3000"\r\n`);
  expect(r.content).not.toMatch(/[^\r]\n/);
});

test("bindComposePortsToLoopback leaves volume mounts and other list items outside ports: alone", () => {
  const withVolumes = `services:\n  postgres:\n    ports:\n      - "5437:5432"\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n      - ./db/migrations:/docker-entrypoint-initdb.d:ro\n`;
  const r = bindComposePortsToLoopback(withVolumes);
  expect(r.changed).toBe(1);
  expect(r.unsupported).toEqual([]);
  expect(r.content).toContain("      - ./db/migrations:/docker-entrypoint-initdb.d:ro\n");
});

test("bindComposePortsToLoopback is idempotent and leaves already-bound entries alone", () => {
  const once = bindComposePortsToLoopback(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`)).content;
  const twice = bindComposePortsToLoopback(once);
  expect(twice.changed).toBe(0);
  expect(twice.content).toBe(once);
});

test("bindComposePortsToLoopback reports forms it cannot safely bind (deny by default)", () => {
  const weird = `services:\n  web:\n    ports:\n      - "3000-3005:3000-3005"\n      - "3000"\n      - "192.168.1.5:80:80"\n      - target: 80\n        published: 8080\n  api:\n    ports: ["4000:4000"]\n`;
  const r = bindComposePortsToLoopback(weird);
  expect(r.unsupported).toEqual([`"3000-3005:3000-3005"`, `"3000"`, `"192.168.1.5:80:80"`, `target: 80`, `ports: ["4000:4000"]`]);
});

test("prepareComposeForUp rewrites the file docker compose would pick, and refuses unsupported entries", () => {
  const key = join("/app", "docker-compose.yml"); // "\app\docker-compose.yml" on Windows
  const files: Record<string, string> = { [key]: compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`) };
  const fs = { exists: (p: string) => p in files, read: (p: string) => files[p]!, write: (p: string, s: string) => { files[p] = s; } };
  const ok = prepareComposeForUp("/app", fs);
  expect(ok).toEqual({ ok: true, file: key, changed: 3 });
  expect(files[key]).toContain(`"127.0.0.1:3202:3000"`);

  files[key] = `services:\n  web:\n    ports:\n      - "3000"\n`;
  const bad = prepareComposeForUp("/app", fs);
  expect(bad.ok).toBe(false);
  expect(bad.ok === false && bad.error).toContain(`"127.0.0.1:<host>:<container>"`);
});

test("prepareComposeForUp is a no-op when the directory has no compose file", () => {
  const fs = { exists: () => false, read: () => "", write: () => { throw new Error("must not write"); } };
  expect(prepareComposeForUp("/empty", fs)).toEqual({ ok: true, file: null, changed: 0 });
});
