// The app map (2026-10-30, understanding plan step 2). The system's own understanding of the app it is building, read
// from the code by code — never from a model's description of it. YugNex's promise is software understood "as a system,
// not text": its tables and columns as the migrations leave them, every endpoint with the SQL it runs and the columns it
// reads and writes, every page with the API calls it makes, every file's owner, and every plan item with the parts of the
// app and the tests that carry it. Across those it checks what no single file shows: the schema file against the
// migrations, SQL against the database, the frontend's calls against the backend's endpoints. Kept in
// <build>/app-map.json and rebuilt after every build and fix step; what it could not read is listed in `notes`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, type DatabaseFacts } from "./sql.ts";
import { readBackend, readDrizzleSchema, readFrontend, type EndpointFacts, type PageFacts, type SqlUse } from "./code.ts";
import { pathFits, readAcceptanceTests } from "../acceptance-tests.ts";
import { planItemsFor } from "../chief-check.ts";

export type FileOwner = "shubham" | "aanya" | "pranav";
const OWNER_OF: Record<string, FileOwner> = { backend: "shubham", frontend: "aanya", db: "pranav" };

export interface AppMap {
  version: 1;
  builtAt: string;
  database: DatabaseFacts;
  /** tables and columns the Drizzle schema file declares; null when there is none */
  schemaFile: Record<string, string[]> | null;
  schemaDiff: Array<{ table: string; column: string; in: "migrations only" | "schema file only" }>;
  endpoints: EndpointFacts[];
  sql: SqlUse[];
  pages: PageFacts[];
  /** SQL that names a table or column the database does not have */
  unknownColumns: Array<{ ref: string; file: string; line: number; why: string }>;
  links: {
    unmatchedCalls: Array<{ method: string; path: string; page: string; file: string; line: number }>;
    uncalledEndpoints: string[];
  };
  owners: Record<string, FileOwner>;
  plan: Array<{ item: string; text: string; endpoints: string[]; pages: string[]; tables: string[]; tests: string[] }>;
  notes: string[];
}

function migrations(projectDir: string): Array<{ file: string; sql: string }> {
  const dir = join(projectDir, "db", "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => ({ file: `db/migrations/${n}`, sql: readFileSync(join(dir, n), "utf-8") }));
}

const ownerOf = (rel: string): FileOwner | undefined => OWNER_OF[rel.split("/")[0]!];

export function buildAppMap(projectDir: string): AppMap {
  const notes: string[] = [];
  const migs = migrations(projectDir);
  const database = applyMigrations(migs);
  if (migs.length === 0) notes.push("no migrations in db/migrations: the database is not known");
  for (const u of database.unread) notes.push(`${u.file}: a statement the map does not read: ${u.statement.slice(0, 120)}`);
  const schemaFile = existsSync(join(projectDir, "db")) ? readDrizzleSchema(join(projectDir, "db")) : null;
  const backend = existsSync(join(projectDir, "backend")) ? readBackend(join(projectDir, "backend")) : { endpoints: [], sql: [], notes: ["no backend folder"] };
  const frontend = existsSync(join(projectDir, "frontend")) ? readFrontend(join(projectDir, "frontend")) : { pages: [], handlers: [], notes: ["no frontend folder"] };
  notes.push(...backend.notes, ...frontend.notes);

  // The schema file against the migrations.
  const schemaDiff: AppMap["schemaDiff"] = [];
  if (schemaFile) {
    for (const [table, t] of Object.entries(database.tables)) {
      const declared = schemaFile[table];
      if (!declared) {
        schemaDiff.push({ table, column: "*", in: "migrations only" });
        continue;
      }
      for (const c of Object.keys(t.columns)) if (!declared.includes(c)) schemaDiff.push({ table, column: c, in: "migrations only" });
      for (const c of declared) if (!t.columns[c]) schemaDiff.push({ table, column: c, in: "schema file only" });
    }
    for (const table of Object.keys(schemaFile)) if (!database.tables[table]) schemaDiff.push({ table, column: "*", in: "schema file only" });
  }

  // SQL against the database.
  const unknownColumns: AppMap["unknownColumns"] = [];
  const seen = new Set<string>();
  if (migs.length > 0) {
    for (const q of backend.sql) {
      for (const ref of [...q.facts.writes, ...q.facts.reads, ...q.facts.filters]) {
        const [table, column] = ref.split(".") as [string, string];
        if (q.facts.ctes.includes(table)) continue; // a WITH name is this query's own table
        if (`${table}.${column}`.includes("${")) continue; // built in code from values: listed as SQL built from values
        // Postgres's own catalog (7e1ab88dc56a verify-db.ts: information_schema.columns) is not the app's database.
        if (/^pg_/.test(table) || new RegExp(`\\b(information_schema|pg_catalog)\\.${table}\\b`, "i").test(q.text)) continue;
        const t = database.tables[table];
        const why = !t ? `${table} is not a table of the database` : column !== "*" && !t.columns[column] ? `${table} has no column ${column}` : null;
        // A missing table is one fact per query, not one per column it names.
        const key = `${t ? ref : table}|${q.file}|${q.line}`;
        if (why && !seen.has(key)) {
          seen.add(key);
          unknownColumns.push({ ref, file: q.file, line: q.line, why });
        }
      }
    }
  }

  // The frontend's calls against the backend's endpoints.
  const called = new Set<string>();
  const unmatchedCalls: AppMap["links"]["unmatchedCalls"] = [];
  for (const page of frontend.pages) {
    for (const c of page.calls) {
      const e = backend.endpoints.find((x) => x.method === c.method && pathFits(x.path, c.path));
      if (e) called.add(`${e.method} ${e.path}`);
      else if (frontend.handlers.some((h) => h.method === c.method && pathFits(h.path, c.path))) continue; // served by the frontend itself
      else unmatchedCalls.push({ method: c.method, path: c.path, page: page.route, file: c.file, line: c.line });
    }
  }
  const uncalledEndpoints = backend.endpoints.map((e) => `${e.method} ${e.path}`).filter((k) => !called.has(k));

  const owners: Record<string, FileOwner> = {};
  for (const rel of [...migs.map((m) => m.file), ...backend.endpoints.flatMap((e) => [e.file, e.handlerFile]), ...backend.sql.map((q) => q.file), ...frontend.pages.flatMap((p) => [p.file, ...p.calls.map((c) => c.file)])]) {
    const o = ownerOf(rel);
    if (o) owners[rel] = o;
  }
  if (schemaFile) owners["db/src/schema.ts"] = "pranav";

  // Each plan item and the parts of the app that carry it.
  const tests = readAcceptanceTests(projectDir)?.tests ?? [];
  const plan = planItemsFor(projectDir).map((item) => {
    const methodPath = item.text.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/);
    const apiPaths = [...item.text.matchAll(/\/api\/[\w\-/:{}[\]]+/g)].map((m) => m[0]);
    const endpoints = backend.endpoints
      .filter((e) => (methodPath ? e.method === methodPath[1] && pathFits(e.path, methodPath[2]!) : apiPaths.some((p) => pathFits(e.path, p))))
      .map((e) => `${e.method} ${e.path}`);
    const pages = frontend.pages.filter((p) => p.route !== "/" && new RegExp(`(^|[\\s(])${p.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s).,;]|$)`).test(item.text)).map((p) => p.route);
    const tables = Object.keys(database.tables).filter((t) => new RegExp(`\\b${t}\\b`, "i").test(item.text));
    return { item: item.id, text: item.text, endpoints, pages, tables, tests: tests.filter((t) => t.planItem === item.id).map((t) => t.id) };
  });

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    database,
    schemaFile,
    schemaDiff,
    endpoints: backend.endpoints,
    sql: backend.sql,
    pages: frontend.pages,
    unknownColumns,
    links: { unmatchedCalls, uncalledEndpoints },
    owners,
    plan,
    notes,
  };
}

export function saveAppMap(projectDir: string, map: AppMap): void {
  writeFileSync(join(projectDir, "app-map.json"), JSON.stringify(map, null, 2));
}

export function readAppMap(projectDir: string): AppMap | null {
  try {
    return JSON.parse(readFileSync(join(projectDir, "app-map.json"), "utf-8")) as AppMap;
  } catch {
    return null;
  }
}

/** Builds, saves and returns the map; never throws (a map that cannot be built is reported, not fatal). */
export function refreshAppMap(projectDir: string): AppMap | null {
  try {
    const map = buildAppMap(projectDir);
    saveAppMap(projectDir, map);
    return map;
  } catch (err) {
    console.warn(`[app-map] the map could not be built: ${String(err).slice(0, 200)}`);
    return null;
  }
}

const JOIN_WORD: Record<string, string> = { inner: "INNER JOIN", left: "LEFT JOIN", right: "RIGHT JOIN", full: "FULL JOIN", cross: "CROSS JOIN" };

/** The map as plain facts, for a builder, a reviewer, the Chief AI or a person. */
export function renderAppMap(map: AppMap): string {
  const lines: string[] = ["THE APP MAP (read from the code by the system, not by a model)", "", "DATABASE (as the migrations leave it):"];
  for (const [table, t] of Object.entries(map.database.tables)) {
    const cols = Object.entries(t.columns).map(([c, f]) => `${c} ${f.type}${f.notNull ? "" : " (may be empty)"}${f.references ? ` → ${f.references.table}.${f.references.column} (on delete ${f.references.onDelete})` : ""}`);
    lines.push(`  ${table}: ${cols.join(", ")}`);
  }
  if (map.schemaDiff.length) {
    lines.push("", "SCHEMA FILE AGAINST THE MIGRATIONS:");
    for (const d of map.schemaDiff) lines.push(`  ${d.table}.${d.column} is in the ${d.in === "migrations only" ? "migrations but not in the schema file" : "schema file but not in the migrations"}`);
  }
  lines.push("", "ENDPOINTS:");
  for (const e of map.endpoints) {
    lines.push(`  ${e.method} ${e.path} — ${e.handler} (${e.handlerFile})${e.middleware.length ? ` [${e.middleware.join(", ")}]` : ""}`);
    for (const q of e.sql) {
      const parts: string[] = [];
      if (q.facts.transaction) parts.push(q.facts.transaction.toUpperCase());
      if (q.facts.writes.length) parts.push(`writes ${q.facts.writes.join(", ")}`);
      if (q.facts.deletes.length) parts.push(`deletes from ${q.facts.deletes.join(", ")}`);
      const outs = q.facts.outputs.map((o) => (o.from.length > 1 ? `${o.as} from ${o.from[0]}, else ${o.from.slice(1).join(", else ")}` : o.from[0] ? `${o.as} from ${o.from[0]}` : o.as));
      if (q.facts.kind === "select" && outs.length) parts.push(`reads ${outs.join(", ")}`);
      const joins = q.facts.tables.filter((t) => JOIN_WORD[t.join]).map((t) => `${JOIN_WORD[t.join]} ${t.table}`);
      if (joins.length) parts.push(joins.join(", "));
      if (q.facts.locks) parts.push("locks the rows it reads (FOR UPDATE)");
      if (q.facts.builtFromValues) parts.push("SQL BUILT FROM VALUES");
      lines.push(`      ${q.file}:${q.line} ${q.function}: ${parts.join("; ") || q.facts.kind}`);
    }
  }
  lines.push("", "PAGES:");
  for (const p of map.pages) lines.push(`  ${p.route} (${p.file})${p.calls.length ? ` → ${p.calls.map((c) => `${c.method} ${c.path}`).join(", ")}` : ""}`);
  const gaps = [
    ...map.unknownColumns.map((u) => `${u.file}:${u.line}: ${u.why}`),
    ...map.links.unmatchedCalls.map((c) => `${c.method} ${c.path} (from ${c.page}, ${c.file}:${c.line}) matches no endpoint`),
    ...map.sql.filter((q) => q.facts.builtFromValues).map((q) => `${q.file}:${q.line} ${q.function}: SQL built from values`),
  ];
  if (gaps.length) lines.push("", "WHAT DOES NOT FIT:", ...gaps.map((g) => `  ${g}`));
  if (map.links.uncalledEndpoints.length) lines.push("", `ENDPOINTS NO PAGE CALLS: ${map.links.uncalledEndpoints.join(", ")}`);
  if (map.notes.length) lines.push("", "NOT READ (the map does not guess these):", ...map.notes.map((n) => `  ${n}`));
  return lines.join("\n");
}
