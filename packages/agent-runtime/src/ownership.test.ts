import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInsideDir, outsidePathArgs, guardCommand, composePathsOutside } from "./ownership.ts";
import { execRunCommand } from "./tools/command.ts";
import { execReadFile, execListFiles, execWriteFile, execWriteFiles, execEditFile, execDeleteFile } from "./tools/file.ts";
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

// 2026-10-03 (Ledgerly benchmark run 4): the backend builder wrote
// `ON CONFLICT (user_id, financial_year)` while the database builder's
// migration had no such unique constraint — every invoice save failed with a
// 500. The backend builder could not read the migrations, so it tested
// against a schema it guessed. It may now read them; it still cannot change them.
test("an agent can read and list a folder it was given read-only, but not write it", () => {
  const { root, backend } = build();
  try {
    const migrations = join(root, "db", "migrations");
    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(migrations, "0000_initial.sql"), "CREATE TABLE invoice_sequences (user_id uuid);");
    const ro = [migrations];
    const read = execReadFile(backend, { path: "../db/migrations/0000_initial.sql" }, undefined, ro);
    expect(read.status).toBe("success");
    expect(String(read.output)).toContain("invoice_sequences");
    const list = execListFiles(backend, { dir: "../db/migrations" }, ro);
    expect(String(list.output)).toContain("0000_initial.sql");
    expect(execWriteFile(backend, { path: "../db/migrations/0000_initial.sql", content: "x" }).status).toBe("error");
    expect(execEditFile(backend, { path: "../db/migrations/0000_initial.sql", old_str: "uuid", new_str: "text" }).status).toBe("error");
    // only that folder: the rest of db/ stays closed
    writeFileSync(join(root, "db", "secret.ts"), "not yours");
    expect(execReadFile(backend, { path: "../db/secret.ts" }, undefined, ro).status).toBe("error");
    expect(execReadFile(backend, { path: "../frontend/x" }, undefined, ro).status).toBe("error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 2026-10-03 (Ledgerly benchmark run 4): the deploy agent found an app bug
// (a missing unique index) and edited the database builder's migration
// itself — then ran out of steps, so the deploy failed anyway, and the
// builder never learned of its own bug. An agent can now be limited to the
// files it owns inside its folder; anything else is refused with the way to
// report it.
test("an agent limited to some files cannot write, edit or delete others in its folder", () => {
  const { root } = build();
  try {
    mkdirSync(join(root, "db", "migrations"), { recursive: true });
    writeFileSync(join(root, "db", "migrations", "0000.sql"), "CREATE TABLE t (a int);");
    const deployFiles = (p: string) => /(^|\/)(docker-compose\.yml|Dockerfile)$/.test(p);
    expect(execWriteFile(root, { path: "docker-compose.yml", content: "services: {}" }, deployFiles).status).toBe("success");
    expect(execWriteFile(root, { path: "backend/Dockerfile", content: "FROM node:22" }, deployFiles).status).toBe("success");
    const edit = execEditFile(root, { path: "db/migrations/0000.sql", old_str: "a int", new_str: "a text" }, deployFiles);
    expect(edit.status).toBe("error");
    expect(edit.summary).toContain("report_blocked");
    expect(execWriteFile(root, { path: "check-db.js", content: "x" }, deployFiles).status).toBe("error");
    expect(execDeleteFile(root, { path: "db/migrations/0000.sql" }, deployFiles).status).toBe("error");
    expect(execWriteFiles(root, { files: [{ path: "backend/src/x.ts", content: "x" }] }, deployFiles).status).toBe("error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file-limited agent's node scripts cannot write, and cp or mkdir cannot reach other files", () => {
  const deployFiles = (p: string) => p === "docker-compose.yml";
  const g = guardCommand("node", ["check.js"], "/b/p", deployFiles);
  expect(g.error).toBeUndefined();
  expect(g.args.some((a) => a.startsWith("--allow-fs-write"))).toBe(false);
  expect(g.args.some((a) => a.startsWith("--allow-fs-read"))).toBe(true);
  expect(guardCommand("cp", ["x.sql", "db/migrations/0000.sql"], "/b/p", deployFiles).error).toContain("report_blocked");
  expect(guardCommand("mkdir", ["scripts"], "/b/p", deployFiles).error).toBeDefined();
  expect(guardCommand("cp", ["a.yml", "docker-compose.yml"], "/b/p", deployFiles).error).toBeUndefined();
});

// 2026-10-04 (Ledgerly run 4): the backend builder ran `git commit -am` and the
// commit swept in the frontend builder's deleted files and edits under a
// message about a GSTIN fix. Builders only read git; the system makes the
// checkpoints.
test("builders may read git but cannot commit, stage or rewrite history", () => {
  for (const args of [["status"], ["diff"], ["diff", "src/a.ts"], ["log", "--oneline"], ["show", "HEAD"]]) {
    expect({ args, refused: Boolean(guardCommand("git", args, "/b/backend").error) }).toEqual({ args, refused: false });
  }
  for (const args of [["commit", "-am", "x"], ["add", "."], ["push"], ["reset", "--hard"], ["checkout", "--", "."], ["stash"], ["rebase", "main"], ["clean", "-fd"], ["restore", "."]]) {
    const g = guardCommand("git", args, "/b/backend");
    expect({ args, refused: Boolean(g.error) }).toEqual({ args, refused: true });
    expect(g.error).toContain("system");
  }
});

// 2026-10-08 (Ledgerly 2, phone-layout fix): the frontend builder was asked to change a header and three tables. It
// also deleted frontend/Dockerfile, a deploy file that belongs to the deploy agent — found only because the whole source
// was diffed against a snapshot. In a fix round a builder may not change or delete deploy files.
test("isBuilderFixFile refuses deploy files and allows source files", async () => {
  const { isBuilderFixFile } = await import("./ownership.ts");
  for (const f of ["Dockerfile", "docker-compose.yml", "docker-compose.override.yaml", ".dockerignore", ".env", ".env.local", "sub/Dockerfile", "Dockerfile.prod"]) {
    expect(isBuilderFixFile(f)).toBe(false);
  }
  for (const f of ["components/layout/Header.tsx", "app/page.tsx", "src/controllers/invoiceController.ts", "package.json", "next.config.ts", "docs/Dockerfile-notes.md"]) {
    expect(isBuilderFixFile(f)).toBe(true);
  }
});

// 2026-10-29 (team plan, stage 1): builders read the whole project and change only their own folder. In Brewline 3 the backend
// builder tried `ls ../db/migrations` and list_files on `../db`, was refused both times, and reported the database column missing
// for an hour after it was added.
test("a builder given the whole project reads any folder with read-only commands (real run)", async () => {
  const { root, frontend } = build();
  try {
    const cat = await execRunCommand(frontend, { command: "cat ../backend/secret.txt" }, undefined, undefined, [root]);
    expect(cat.status).toBe("success");
    expect(String(cat.output)).toContain("backend work");
    expect((await execRunCommand(frontend, { command: "ls ../backend" }, undefined, undefined, [root])).status).toBe("success");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reading the whole project never lets a command run, copy or reach outside the project", () => {
  const cwd = "/b/frontend";
  const ro = ["/b"];
  expect(guardCommand("cat", ["../backend/x.ts"], cwd, undefined, ro).error).toBeUndefined();
  expect(guardCommand("grep", ["-rn", "name_at_time", "../db"], cwd, undefined, ro).error).toBeUndefined();
  expect(guardCommand("node", ["../backend/fix_cors.js"], cwd, undefined, ro).error).toContain("outside your folder");
  expect(guardCommand("cp", ["../backend/x.ts", "x.ts"], cwd, undefined, ro).error).toContain("outside your folder");
  expect(guardCommand("cat", ["../../etc/passwd"], cwd, undefined, ro).error).toContain("outside your folder");
});

test("a refusal tells the builder it may read other folders and how", () => {
  const err = guardCommand("node", ["../backend/fix_cors.js"], "/b/frontend", undefined, ["/b"]).error ?? "";
  expect(err).toContain("read");
  expect(err).toContain("report_blocked");
});

test("a builder given the whole project lists and reads every folder but writes only its own", () => {
  const { root, frontend } = build();
  try {
    const list = execListFiles(frontend, { dir: ".." }, [root]);
    expect(String(list.output)).toContain("backend");
    expect(execReadFile(frontend, { path: "../backend/secret.txt" }, undefined, [root]).status).toBe("success");
    expect(execWriteFile(frontend, { path: "../backend/secret.txt", content: "x" }).status).toBe("error");
    expect(execDeleteFile(frontend, { path: "../backend/secret.txt" }).status).toBe("error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
