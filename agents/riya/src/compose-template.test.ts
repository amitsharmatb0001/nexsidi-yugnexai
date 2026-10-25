import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderComposeFile, composeFromTemplate, backendEnvNames, buildAgentTask, existingJwtSecret } from "./index.ts";

// 2026-10-24 (final plan item 5; Brewline measured): the deploy agent's first compose file already had the structure of
// the final one, and all 5 later edits changed only the JWT secret. The file is fully determined by the app name, three
// ports and the secret, so the system writes it; the agent runs only when the system's own start-and-health-check fails.

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

function app(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "compose-"));
  for (const [rel, body] of Object.entries({ "backend/Dockerfile": "FROM node", "frontend/Dockerfile": "FROM node", "db/migrations/0000_initial.sql": "SELECT 1;", ...files })) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
const ports = { frontendPort: 3200, backendPort: 3300, dbPort: 5435 };

test("the template has Brewline's proven shape: loopback-only ports, the same secret on the backend, migrations as the init directory", () => {
  const yml = renderComposeFile({ dbName: "brewline", ...ports, jwtSecret: "s3cret" });
  expect(yml).toContain('"127.0.0.1:5435:5432"');
  expect(yml).toContain('"127.0.0.1:3300:3001"');
  expect(yml).toContain('"127.0.0.1:3200:3000"');
  expect(yml).toContain("DATABASE_URL: postgresql://postgres:postgres@postgres:5432/brewline");
  expect(yml).toContain("CORS_ORIGIN: http://localhost:3200");
  expect(yml).toContain("JWT_SECRET: s3cret");
  expect(yml).toContain("NEXT_PUBLIC_API_URL: http://localhost:3300");
  expect(yml).toContain("./db/migrations:/docker-entrypoint-initdb.d:ro");
  expect(yml).not.toMatch(/restart:/);
  expect(existingJwtSecret(yml)).toBe("s3cret"); // a later redeploy keeps it
});

test("the database name is a safe identifier made from the app's name", () => {
  expect(renderComposeFile({ dbName: "Trailhead Gear Rentals #2!", ...ports, jwtSecret: "x" })).toContain("/trailhead_gear_rentals_2\n");
  expect(renderComposeFile({ dbName: "9lives", ...ports, jwtSecret: "x" })).toContain("/app_9lives\n");
  expect(renderComposeFile({ dbName: "", ...ports, jwtSecret: "x" })).toContain("/app\n");
});

test("backendEnvNames lists the variables the backend reads, and marks those with no default", () => {
  const d = app({ "backend/src/index.ts": 'const port = Number(process.env.PORT) || 3001;\nif (!process.env.JWT_SECRET) throw 1;\nconst k = process.env.STRIPE_KEY;\nconst o = process.env.SENTRY_DSN ?? "";\n' });
  expect(backendEnvNames(d)).toEqual({ all: ["JWT_SECRET", "PORT", "SENTRY_DSN", "STRIPE_KEY"], needsValue: ["STRIPE_KEY"] });
});

test("seed-account variables are optional by the backend rules (a missing password is generated), so they do not stop the template", () => {
  const d = app({ "backend/src/db/seedStaff.ts": ["const e = process.env.STAFF_EMAIL || 'staff@x.com';", "let p = process.env.STAFF_PASSWORD;", "const a = process.env.ADMIN_PASSWORD;", ""].join("\n") });
  expect(backendEnvNames(d).needsValue).toEqual([]);
});

test("composeFromTemplate writes the file for a standard app, and declines when it cannot be sure", () => {
  const d = app({ "backend/src/index.ts": 'const p = process.env.PORT || 3001; const j = process.env.JWT_SECRET; const d = process.env.DATABASE_URL; const c = process.env.CORS_ORIGIN || "x";\n' });
  const r = composeFromTemplate(d, "brewline", { ...ports, jwtSecret: "abc" });
  expect(r.written).toBe(true);
  expect(readFileSync(join(d, "docker-compose.yml"), "utf-8")).toContain("JWT_SECRET: abc");

  const needsKey = app({ "backend/src/index.ts": "const k = process.env.STRIPE_KEY;\n" });
  expect(composeFromTemplate(needsKey, "shop", { ...ports, jwtSecret: "abc" })).toEqual({ written: false, reason: "the backend reads STRIPE_KEY, which the standard compose file does not set" });
  expect(existsSync(join(needsKey, "docker-compose.yml"))).toBe(false);

  const noDockerfile = app({});
  rmSync(join(noDockerfile, "frontend", "Dockerfile"));
  expect(composeFromTemplate(noDockerfile, "shop", { ...ports, jwtSecret: "abc" }).written).toBe(false);

  const already = app({ "docker-compose.yml": "services: {}\n" });
  expect(composeFromTemplate(already, "shop", { ...ports, jwtSecret: "abc" })).toEqual({ written: false, reason: "a docker-compose.yml already exists" });
});

test("a first deploy starts from the template and the system's own start-and-check; the agent is told the file is written", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toContain("composeFromTemplate(buildDir");
  expect(src).toMatch(/const fastPath = [^\n]*redeployRunningApp/);
  const task = buildAgentTask("p", "/b", 3200, 3300, 5435, "s", true);
  expect(task).toContain("docker-compose.yml is already written");
  expect(task).not.toContain("Start by writing docker-compose.yml");
  expect(buildAgentTask("p", "/b", 3200, 3300, 5435, "s")).toContain("Start by writing docker-compose.yml");
});
