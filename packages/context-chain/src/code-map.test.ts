import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodeMap, dependentsOf, dependenciesOf, type CodeMap } from "./code-map.ts";
import { hashContext } from "./hash.ts";

// Patent claims 1 and 3: the context object handed between agents carries the code's abstract syntax structure, its
// dependency graph and metadata, so the receiver does not have to guess what depends on what.

let dir = "";
const put = (rel: string, text: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const FILES = [
  "backend/src/index.ts",
  "backend/src/routes.ts",
  "backend/src/db.ts",
  "frontend/app/page.tsx",
  "frontend/lib/api.ts",
  "db/migrations/0001_init.sql",
  "backend/src/broken.ts",
  "backend/src/orphan.ts",
  "package.json",
];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "codemap-"));
  put("backend/src/index.ts", `import express from "express";\nimport { router } from "./routes.js";\nexport const app = express();\napp.use(router);\n`);
  put("backend/src/routes.ts", `import { query } from "./db";\nexport function router() { return query("select 1"); }\nexport interface Row { id: number }\n`);
  put("backend/src/db.ts", `import { app } from "./index";\nexport const pool = {};\nexport async function query(sql: string) { return app && sql; }\nexport default class Db {}\n`);
  put("frontend/app/page.tsx", `import React from "react";\nimport { getUsers } from "../lib/api";\nexport default function Page() { return <div>{getUsers()}</div>; }\n`);
  put("frontend/lib/api.ts", `export const getUsers = () => fetch("/api/users");\n`);
  put("db/migrations/0001_init.sql", `CREATE TABLE users (id serial primary key);\nCREATE TABLE IF NOT EXISTS orders (id serial);\n`);
  put("backend/src/broken.ts", `export const a = ;\nimport { nope } from "./missing";\n`);
  put("backend/src/orphan.ts", `export const lonely = 1;\n`);
  put("package.json", `{"name":"x"}`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const map = (extra: Partial<Parameters<typeof buildCodeMap>[2]> = {}) => buildCodeMap(dir, FILES, extra);
const file = (m: CodeMap, p: string) => m.files.find((f) => f.path === p)!;

test("each source file gets a hash, a line count, its imports, exports and symbols", () => {
  const m = map();
  const routes = file(m, "backend/src/routes.ts");
  expect(routes.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(routes.lines).toBe(3);
  expect(routes.imports).toEqual(["./db"]);
  expect(routes.exports.sort()).toEqual(["Row", "router"]);
  expect(routes.symbols.map((s) => `${s.kind}:${s.name}`).sort()).toEqual(["function:router", "interface:Row"]);
  expect(file(m, "backend/src/db.ts").exports.sort()).toEqual(["Db", "default", "pool", "query"].sort());
});

test("the syntax structure is captured as a digest that ignores names, comments and spacing", () => {
  const a = buildCodeMap(dir, ["frontend/lib/api.ts"], {});
  put("frontend/lib/api2.ts", `// renamed and spaced out\nexport   const   fetchUsers   =   () =>   fetch("/api/users");\n`);
  const b = buildCodeMap(dir, ["frontend/lib/api2.ts"], {});
  expect(a.files[0]!.astDigest).toBe(b.files[0]!.astDigest);
  expect(a.files[0]!.nodeCount).toBeGreaterThan(5);
  expect(a.files[0]!.sha256).not.toBe(b.files[0]!.sha256); // the file hash still sees every change
  put("frontend/lib/api3.ts", `export const getUsers = () => { return fetch("/api/users"); };\n`);
  expect(buildCodeMap(dir, ["frontend/lib/api3.ts"], {}).files[0]!.astDigest).not.toBe(a.files[0]!.astDigest);
});

test("relative imports become edges between files, including .js specifiers for .ts files and bare folder/extension forms", () => {
  const m = map();
  const edges = m.graph.edges.map((e) => `${e.from} -> ${e.to}`).sort();
  expect(edges).toContain("backend/src/index.ts -> backend/src/routes.ts");
  expect(edges).toContain("backend/src/routes.ts -> backend/src/db.ts");
  expect(edges).toContain("frontend/app/page.tsx -> frontend/lib/api.ts");
});

test("packages are listed as external dependencies, with the files that use them", () => {
  const m = map();
  expect(m.graph.external.express).toEqual(["backend/src/index.ts"]);
  expect(m.graph.external.react).toEqual(["frontend/app/page.tsx"]);
});

test("an import cycle is found and reported", () => {
  const m = map();
  expect(m.graph.cycles).toEqual([["backend/src/db.ts", "backend/src/index.ts", "backend/src/routes.ts"]]);
});

test("error records: a syntax error and an import that points at nothing are recorded with file and line", () => {
  const m = map();
  const kinds = m.errorRecords.map((e) => `${e.kind}:${e.file}`);
  expect(kinds).toContain("syntax-error:backend/src/broken.ts");
  expect(kinds).toContain("unresolved-import:backend/src/broken.ts");
  const un = m.errorRecords.find((e) => e.kind === "unresolved-import")!;
  expect(un.detail).toContain("./missing");
  expect(un.line).toBe(2);
});

test("SQL files contribute the tables they create", () => {
  const sql = file(map(), "db/migrations/0001_init.sql");
  expect(sql.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(["table:users", "table:orders"]);
});

test("the rules to follow are carried in the object, in the order given", () => {
  const m = map({ rules: ["Every route requires a signed-in user", "No raw SQL strings"] });
  expect(m.rules).toEqual(["Every route requires a signed-in user", "No raw SQL strings"]);
});

test("metadata counts files, lines and languages", () => {
  const m = map();
  expect(m.metadata.fileCount).toBe(FILES.length);
  expect(m.metadata.languages.ts).toBeGreaterThanOrEqual(5);
  expect(m.metadata.languages.tsx).toBe(1);
  expect(m.metadata.languages.sql).toBe(1);
  expect(m.metadata.totalLines).toBeGreaterThan(15);
});

test("the map is deterministic: the same files give the same hash in any order, and any content change changes it", () => {
  const h1 = hashContext(buildCodeMap(dir, FILES, {}));
  const h2 = hashContext(buildCodeMap(dir, [...FILES].reverse(), {}));
  expect(h1).toBe(h2);
  put("backend/src/orphan.ts", `export const lonely = 2;\n`);
  expect(hashContext(buildCodeMap(dir, FILES, {}))).not.toBe(h1);
  put("backend/src/orphan.ts", `export const lonely = 1;\n`);
  expect(hashContext(buildCodeMap(dir, FILES, {}))).toBe(h1);
});

test("a listed file that is missing, or too large, is recorded rather than crashing the map", () => {
  const m = buildCodeMap(dir, ["backend/src/gone.ts", "backend/src/orphan.ts"], { maxFileBytes: 10 });
  expect(m.errorRecords.map((e) => e.kind).sort()).toEqual(["missing-file", "skipped-large-file"]);
  expect(m.files.map((f) => f.path)).toEqual(["backend/src/orphan.ts"]);
});

test("impact queries: what a change reaches, and what a file needs", () => {
  const m = map();
  expect(dependentsOf(m, "backend/src/db.ts")).toEqual(["backend/src/index.ts", "backend/src/routes.ts"]);
  expect(dependentsOf(m, "frontend/lib/api.ts")).toEqual(["frontend/app/page.tsx"]);
  expect(dependenciesOf(m, "frontend/app/page.tsx")).toEqual(["frontend/lib/api.ts"]);
  expect(dependentsOf(m, "backend/src/orphan.ts")).toEqual([]);
});

test("an @/ alias import resolves through the nearest tsconfig.json, even when tsconfig.json is not in the file list", () => {
  put("frontend/tsconfig.json", `{"compilerOptions":{"paths":{"@/*":["./*"]}}}`);
  put("frontend/components/Header.tsx", `export function Header() { return null; }\n`);
  put("frontend/app/layout.tsx", `import { Header } from "@/components/Header";\nimport { getUsers } from "@/lib/api";\nexport default function L() { return Header() && getUsers(); }\n`);
  const m = buildCodeMap(dir, ["frontend/app/layout.tsx", "frontend/components/Header.tsx", "frontend/lib/api.ts"], {});
  const edges = m.graph.edges.map((e) => `${e.from} -> ${e.to}`);
  expect(edges).toContain("frontend/app/layout.tsx -> frontend/components/Header.tsx");
  expect(edges).toContain("frontend/app/layout.tsx -> frontend/lib/api.ts");
  expect(m.errorRecords).toEqual([]);
});
