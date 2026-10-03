import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInsideDir, outsidePathArgs, guardCommand, composePathsOutside } from "./ownership.ts";
import { execRunCommand } from "./tools/command.ts";
import { execReadFile } from "./tools/file.ts";
import { execDockerCompose } from "./tools/docker.ts";

// 2026-10-02 (Ledgerly benchmark run 2, approved by Amit): every agent does
// only its own work. The frontend builder read ../backend and ../db with
// its own node scripts, and its compose file built ../backend and mounted
// ../db/migrations. Earlier runs had restart_backend.js and fix_cors.js.
// These checks enforce the folder boundary in code, not in prompts.

const build = () => {
  const root = mkdtempSync(join(tmpdir(), "nexsidi-ownership-"));
  mkdirSync(join(root, "frontend"));
  mkdirSync(join(root, "backend"));
  writeFileSync(join(root, "backend", "secret.txt"), "backend work");
  return { root, frontend: join(root, "frontend"), backend: join(root, "backend") };
};

test("isInsideDir needs a real folder boundary: backend-old is not inside backend", () => {
  expect(isInsideDir("/b/backend", "/b/backend/src/a.ts")).toBe(true);
  expect(isInsideDir("/b/backend", "/b/backend")).toBe(true);
  expect(isInsideDir("/b/backend", "/b/backend-old/a.ts")).toBe(false);
  expect(isInsideDir("/b/backend", "/b/frontend/a.ts")).toBe(false);
});

test("file tools refuse a sibling folder whose name starts with the agent's folder name", () => {
  const { root } = build();
  try {
    mkdirSync(join(root, "frontend-old"));
    writeFileSync(join(root, "frontend-old", "x.txt"), "not yours");
    const r = execReadFile(join(root, "frontend"), { path: "../frontend-old/x.txt" });
    expect(r.status).toBe("error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outsidePathArgs finds path arguments that leave the folder and ignores flags, code and URLs", () => {
  const cwd = "/b/frontend";
  expect(outsidePathArgs(cwd, ["../backend"])).toEqual(["../backend"]);
  expect(outsidePathArgs(cwd, ["src/../../db/x.sql"])).toEqual(["src/../../db/x.sql"]);
  expect(outsidePathArgs(cwd, ["next", "build", "--noEmit", "app/page.tsx", "./lib/x.ts"])).toEqual([]);
  expect(outsidePathArgs(cwd, ["http://localhost:3001/api", "console.log('a/b')"])).toEqual([]);
});

test("guardCommand refuses another folder, limits bun, and refuses script runners other than node", () => {
  const cwd = "/b/frontend";
  expect(guardCommand("cat", ["../backend/docker-compose.yml"], cwd).error).toContain("outside your folder");
  expect(guardCommand("bun", ["list_db.js"], cwd).error).toBeDefined();
  expect(guardCommand("bun", ["install"], cwd).error).toBeUndefined();
  expect(guardCommand("npx", ["tsx", "fix_cors.ts"], cwd).error).toBeDefined();
  expect(guardCommand("npx", ["next", "build"], cwd).error).toBeUndefined();
});

test("guardCommand runs node locked to the agent's own folder", () => {
  const g = guardCommand("node", ["verify.js"], "/b/frontend");
  expect(g.error).toBeUndefined();
  expect(g.args[0]).toBe("--permission");
  expect(g.args.some((a) => a.startsWith("--allow-fs-read=") && a.includes("frontend"))).toBe(true);
  expect(g.args.some((a) => a.startsWith("--allow-fs-write=") && a.includes("frontend"))).toBe(true);
  expect(g.args[g.args.length - 1]).toBe("verify.js");
});

test("a node script cannot read another agent's folder (real run)", async () => {
  const { root, frontend } = build();
  try {
    writeFileSync(join(frontend, "peek.js"), "console.log(require('fs').readFileSync('../backend/secret.txt','utf8'))");
    const r = await execRunCommand(frontend, { command: "node peek.js" });
    expect(String(r.output ?? "")).not.toContain("backend work");
    expect(String(r.output ?? "")).toContain("ERR_ACCESS_DENIED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a node script still works inside its own folder (real run)", async () => {
  const { root, frontend } = build();
  try {
    writeFileSync(join(frontend, "own.js"), "require('fs').writeFileSync('out.txt','ok'); console.log(require('fs').readFileSync('out.txt','utf8'))");
    const r = await execRunCommand(frontend, { command: "node own.js" });
    expect(r.status).toBe("success");
    expect(String(r.output)).toContain("ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("composePathsOutside finds build contexts and writable mounts outside the folder; read-only mounts are allowed", () => {
  const compose = `services:\n  postgres:\n    image: postgres:16\n    volumes:\n      - ../db/migrations:/docker-entrypoint-initdb.d:ro\n      - ../db/data:/var/lib/postgresql/data\n      - pgdata:/var/lib/postgresql/data\n  backend:\n    build: ../backend\n  web:\n    build:\n      context: .\n  api:\n    build:\n      context: ../api\n`;
  expect(composePathsOutside(compose, "/b/frontend").sort()).toEqual(["../api", "../backend", "../db/data"]);
  expect(composePathsOutside(`services:\n  web:\n    build: ./frontend\n    volumes:\n      - ./data:/data\n`, "/b")).toEqual([]);
});

test("docker_compose up refuses a compose file that runs another agent's folder, and never starts docker", async () => {
  const { root, frontend } = build();
  try {
    writeFileSync(join(frontend, "docker-compose.yml"), `services:\n  backend:\n    build: ../backend\n  frontend:\n    build: .\n    ports:\n      - "3005:3000"\n`);
    let spawned = false;
    const spawnFn = (() => { spawned = true; throw new Error("must not run"); }) as never;
    const r = await execDockerCompose(frontend, { action: "up" }, { spawnFn });
    expect(r.status).toBe("error");
    expect(r.summary).toContain("../backend");
    expect(spawned).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 2026-10-03 (Ledgerly benchmark run 4): the frontend builder ran
// `node --allow-fs-read=* --allow-fs-write=* -e "…copyFileSync('C:\Windows\System32…"`.
// Node adds repeated allow flags together, so its own `*` cancelled the lock
// that keeps scripts in the agent's folder. Only the system sets these flags.
test("node refuses permission flags passed by the agent", () => {
  for (const flag of ["--allow-fs-read=*", "--allow-fs-write=*", "--allow-child-process", "--permission", "--experimental-permission", "--allow-addons", "--allow-wasi", "--allow-worker"]) {
    const g = guardCommand("node", [flag, "-e", "1"], "/b/frontend");
    expect({ flag, refused: Boolean(g.error) }).toEqual({ flag, refused: true });
  }
  expect(guardCommand("node", ["--version"], "/b/frontend").error).toBeUndefined();
});

test("an agent's own allow-all flag cannot read another folder (real run)", async () => {
  const { root, frontend } = build();
  try {
    const r = await execRunCommand(frontend, { command: `node --allow-fs-read=* -e "console.log(require('fs').readFileSync('../backend/secret.txt','utf8'))"` });
    expect(String(r.output ?? "")).not.toContain("backend work");
    expect(r.status).toBe("error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
