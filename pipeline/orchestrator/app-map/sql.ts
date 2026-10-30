// The app map's SQL reader (2026-10-30, understanding plan step 2). The database the app really has is read from its
// migrations, applied in order; what each query really does is read from its SQL text: which tables (with aliases and
// join types), which columns it reads, writes and filters on, which columns an output comes from (a COALESCE fallback
// included), and whether the SQL is built from values. Code, no model. A statement it does not understand is listed in
// `unread`, never guessed. It covers the SQL the generated apps write (PostgreSQL DDL in migrations; pg queries with $n
// parameters); a WITH query or a subquery is read as a whole, and what cannot be placed is listed in `unresolved`.

export interface ColumnFacts {
  type: string;
  notNull: boolean;
  default?: string;
  references?: { table: string; column: string; onDelete: string };
  addedIn: string;
}

export interface TableFacts {
  columns: Record<string, ColumnFacts>;
  createdIn: string;
}

export interface DatabaseFacts {
  tables: Record<string, TableFacts>;
  /** statements the reader did not understand, as written */
  unread: Array<{ file: string; statement: string }>;
}

export interface QueryFacts {
  kind: "select" | "insert" | "update" | "delete" | "transaction" | "other";
  /** BEGIN / COMMIT / ROLLBACK */
  transaction?: "begin" | "commit" | "rollback";
  /** the rows read are locked (FOR UPDATE / FOR SHARE): a check-then-write inside a transaction */
  locks: boolean;
  tables: Array<{ table: string; alias: string; join: "from" | "inner" | "left" | "right" | "full" | "cross" | "into" | "update" | "delete" }>;
  /** table.column read in the output */
  reads: string[];
  /** table.column written (INSERT columns, UPDATE SET columns) */
  writes: string[];
  /** tables rows are deleted from */
  deletes: string[];
  /** table.column used in ON / WHERE / GROUP BY / ORDER BY */
  filters: string[];
  /** each output column and the table columns it comes from */
  outputs: Array<{ as: string; from: string[] }>;
  /** the SQL text is built from values (a template with substitutions), not parameters */
  builtFromValues: boolean;
  /** references the reader could not place on a table */
  unresolved: string[];
  /** names a WITH clause defines: tables of this query only, not of the database */
  ctes: string[];
}

// ── Text helpers ────────────────────────────────────────────────────────────

/** The end of a dollar-quoted block ($$ … $$ or $tag$ … $tag$) that starts at `i`, or -1 when none starts there. */
function dollarEnd(text: string, i: number): number {
  const m = text.slice(i).match(/^\$([A-Za-z_]\w*)?\$/);
  if (!m) return -1;
  const close = text.indexOf(m[0], i + m[0].length);
  return close < 0 ? text.length - 1 : close + m[0].length - 1;
}

/** Comments removed, strings and dollar-quoted blocks kept (as one token each), whitespace collapsed. */
function clean(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (c === "$" && !/\d/.test(sql[i + 1] ?? "")) {
      const end = dollarEnd(sql, i);
      if (end >= 0) {
        out += sql.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i = sql.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
      out += " ";
      continue;
    }
    if (c === "'") {
      const end = sql.indexOf("'", i + 1);
      out += sql.slice(i, end < 0 ? sql.length : end + 1);
      i = end < 0 ? sql.length : end;
      continue;
    }
    out += c;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Splits at `sep` where not inside parentheses or strings. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") inStr = !inStr;
    if (inStr) continue;
    if (c === "$" && !/\d/.test(text[i + 1] ?? "")) {
      const end = dollarEnd(text, i);
      if (end >= 0) {
        i = end;
        continue;
      }
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Index of a keyword at paren depth 0 (outside strings), or -1. */
function topIndexOf(text: string, re: RegExp, from = 0): number {
  let depth = 0;
  let inStr = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") inStr = !inStr;
    if (inStr) continue;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (i === 0 || /[\s(,]/.test(text[i - 1]!))) {
      const m = text.slice(i).match(re);
      if (m && m.index === 0) return i;
    }
  }
  return -1;
}

const unquote = (id: string) => id.trim().replace(/^"(.*)"$/, "$1").replace(/^.*\./, "");
const IDENT = `"[^"]+"|[A-Za-z_][\\w$]*(?:\\.(?:"[^"]+"|[A-Za-z_][\\w$]*))?`;

// ── Migrations ──────────────────────────────────────────────────────────────

const COLUMN_STOP = /^(NOT|NULL|DEFAULT|PRIMARY|REFERENCES|UNIQUE|CHECK|CONSTRAINT|GENERATED|COLLATE)$/i;

function parseColumnDef(def: string, file: string): [string, ColumnFacts] | null {
  const m = def.match(new RegExp(`^(${IDENT})\\s+(.*)$`, "s"));
  if (!m) return null;
  const name = unquote(m[1]!);
  const words = m[2]!.split(/\s+/);
  const typeWords: string[] = [];
  for (const w of words) {
    if (COLUMN_STOP.test(w)) break;
    typeWords.push(w);
  }
  const rest = m[2]!;
  const ref = rest.match(new RegExp(`REFERENCES\\s+(${IDENT})\\s*\\(\\s*(${IDENT})\\s*\\)(?:\\s+ON\\s+DELETE\\s+(CASCADE|RESTRICT|SET\\s+NULL|SET\\s+DEFAULT|NO\\s+ACTION))?`, "i"));
  const dflt = rest.match(/\bDEFAULT\s+('(?:[^']*)'|[^\s,]+(?:\([^)]*\))?)/i);
  const col: ColumnFacts = {
    type: typeWords.join(" ").toLowerCase(),
    notNull: /\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(rest),
    addedIn: file,
  };
  if (dflt) col.default = dflt[1]!;
  if (ref) col.references = { table: unquote(ref[1]!), column: unquote(ref[2]!), onDelete: (ref[3] ?? "NO ACTION").toUpperCase().replace(/\s+/g, " ") };
  return [name, col];
}

/** The database as the migrations leave it, applied in the order given. */
export function applyMigrations(files: Array<{ file: string; sql: string }>): DatabaseFacts {
  const db: DatabaseFacts = { tables: {}, unread: [] };
  const fkNames = new Map<string, { table: string; column: string }>();
  for (const { file, sql } of files) {
    for (const stmt of splitTop(clean(sql), ";")) {
      const create = stmt.match(new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s*\\((.*)\\)$`, "is"));
      if (create) {
        const table = unquote(create[1]!);
        const t: TableFacts = { columns: {}, createdIn: file };
        for (const def of splitTop(create[2]!, ",")) {
          const fk = def.match(new RegExp(`^(?:CONSTRAINT\\s+(${IDENT})\\s+)?FOREIGN\\s+KEY\\s*\\(\\s*(${IDENT})\\s*\\)\\s*REFERENCES\\s+(${IDENT})\\s*\\(\\s*(${IDENT})\\s*\\)(?:\\s+ON\\s+DELETE\\s+(CASCADE|RESTRICT|SET\\s+NULL|SET\\s+DEFAULT|NO\\s+ACTION))?`, "i"));
          if (fk) {
            const col = t.columns[unquote(fk[2]!)];
            if (col) col.references = { table: unquote(fk[3]!), column: unquote(fk[4]!), onDelete: (fk[5] ?? "NO ACTION").toUpperCase().replace(/\s+/g, " ") };
            fkNames.set((fk[1] ? unquote(fk[1]) : `${table}_${unquote(fk[2]!)}_fkey`).toLowerCase(), { table, column: unquote(fk[2]!) });
            continue;
          }
          if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/i.test(def)) continue;
          const parsed = parseColumnDef(def, file);
          if (!parsed) continue;
          t.columns[parsed[0]] = parsed[1];
          if (parsed[1].references) fkNames.set(`${table}_${parsed[0]}_fkey`.toLowerCase(), { table, column: parsed[0] });
        }
        db.tables[table] = t;
        continue;
      }
      const alter = stmt.match(new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${IDENT})\\s+(.*)$`, "is"));
      if (alter) {
        const table = unquote(alter[1]!);
        const t = db.tables[table];
        let understood = !!t;
        for (const action of t ? splitTop(alter[2]!, ",") : []) {
          let m: RegExpMatchArray | null;
          if ((m = action.match(new RegExp(`^ADD\\s+CONSTRAINT\\s+(${IDENT})\\s+FOREIGN\\s+KEY\\s*\\(\\s*(${IDENT})\\s*\\)\\s*REFERENCES\\s+(${IDENT})\\s*\\(\\s*(${IDENT})\\s*\\)(?:\\s+ON\\s+DELETE\\s+(CASCADE|RESTRICT|SET\\s+NULL|SET\\s+DEFAULT|NO\\s+ACTION))?`, "i")))) {
            const col = t!.columns[unquote(m[2]!)];
            if (col) col.references = { table: unquote(m[3]!), column: unquote(m[4]!), onDelete: (m[5] ?? "NO ACTION").toUpperCase().replace(/\s+/g, " ") };
            fkNames.set(unquote(m[1]!).toLowerCase(), { table, column: unquote(m[2]!) });
          } else if ((m = action.match(new RegExp(`^DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT})`, "i")))) {
            const fk = fkNames.get(unquote(m[1]!).toLowerCase());
            if (fk && db.tables[fk.table]?.columns[fk.column]) delete db.tables[fk.table]!.columns[fk.column]!.references;
          } else if (/^ADD\s+CONSTRAINT\b/i.test(action) || /^ADD\s+(PRIMARY\s+KEY|UNIQUE|CHECK)\b/i.test(action)) {
            // a unique / check / primary-key constraint: no column facts change
          } else if ((m = action.match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(.*)$/is))) {
            const parsed = parseColumnDef(m[1]!, file);
            if (parsed) t!.columns[parsed[0]] = parsed[1];
            else understood = false;
          } else if ((m = action.match(new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(${IDENT})`, "i")))) {
            delete t!.columns[unquote(m[1]!)];
          } else if ((m = action.match(new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?(${IDENT})\\s+(.*)$`, "is")))) {
            const col = t!.columns[unquote(m[1]!)];
            const what = m[2]!;
            if (!col) understood = false;
            else if (/^DROP\s+NOT\s+NULL/i.test(what)) col.notNull = false;
            else if (/^SET\s+NOT\s+NULL/i.test(what)) col.notNull = true;
            else if (/^SET\s+DEFAULT\s+/i.test(what)) col.default = what.replace(/^SET\s+DEFAULT\s+/i, "");
            else if (/^DROP\s+DEFAULT/i.test(what)) delete col.default;
            else if (/^(SET\s+DATA\s+)?TYPE\s+/i.test(what)) col.type = what.replace(/^(SET\s+DATA\s+)?TYPE\s+/i, "").split(/\s+USING\s+/i)[0]!.toLowerCase();
            else understood = false;
          } else if ((m = action.match(new RegExp(`^RENAME\\s+(?:COLUMN\\s+)?(${IDENT})\\s+TO\\s+(${IDENT})`, "i")))) {
            const from = unquote(m[1]!);
            if (t!.columns[from]) {
              t!.columns[unquote(m[2]!)] = t!.columns[from]!;
              delete t!.columns[from];
            }
          } else {
            understood = false;
          }
        }
        if (!understood) db.unread.push({ file, statement: stmt.slice(0, 300) });
        continue;
      }
      const drop = stmt.match(new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT})`, "i"));
      if (drop) {
        delete db.tables[unquote(drop[1]!)];
        continue;
      }
      // Statements that change no table or column facts.
      // Data changes (UPDATE, DELETE, a WITH … DELETE) move rows, not columns.
      if (/^(CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX|CREATE\s+EXTENSION|COMMENT\s+ON|INSERT\s+INTO|UPDATE\s|DELETE\s+FROM|WITH\s|BEGIN|COMMIT|SET\s+)/i.test(stmt)) continue;
      db.unread.push({ file, statement: stmt.slice(0, 300) });
    }
  }
  return db;
}

// ── Queries ─────────────────────────────────────────────────────────────────

const KEYWORDS = new Set(
  "select from where and or not null is in as on join left right inner outer full cross group by order having limit offset distinct case when then else end true false like ilike between exists any all asc desc nulls first last returning set values into update delete insert interval with union except intersect current_date current_timestamp now coalesce nullif lower upper count sum avg min max cast using lateral filter over partition for share nowait skip locked key no"
    .split(" "),
);

type Alias = Map<string, string>;

/** Every column reference in a piece of SQL, placed on its table. Function names, keywords and types are skipped. */
function columnRefs(text: string, aliases: Alias, tables: string[], unresolved: string[]): string[] {
  const out: string[] = [];
  // Strings, casts, AT TIME ZONE and the date part of EXTRACT(… FROM x) are not columns.
  const noStrings = text
    .replace(/'[^']*'/g, "''")
    .replace(/::\s*[\w\[\]]+/g, " ")
    .replace(/\bAT\s+TIME\s+ZONE\b/gi, " ")
    .replace(/\bEXTRACT\s*\(\s*\w+\s+FROM\b/gi, "(");
  for (const m of noStrings.matchAll(/("?[A-Za-z_][\w$]*"?)\s*\.\s*("?[A-Za-z_][\w$]*"?|\*)/g)) {
    const alias = unquote(m[1]!).toLowerCase();
    const table = aliases.get(alias);
    if (table) out.push(`${table}.${unquote(m[2]!)}`);
    else unresolved.push(`${unquote(m[1]!)}.${unquote(m[2]!)}`);
  }
  const bare = noStrings.replace(/("?[A-Za-z_][\w$]*"?)\s*\.\s*("?[A-Za-z_][\w$]*"?|\*)/g, " ");
  for (const m of bare.matchAll(/(?<![\w$.])("?[A-Za-z_][\w$]*"?)(?!\s*\()(?![\w$])/g)) {
    const name = unquote(m[1]!);
    if (KEYWORDS.has(name.toLowerCase()) || /^\d/.test(name)) continue;
    if (tables.length === 1) out.push(`${tables[0]}.${name}`);
    else unresolved.push(name);
  }
  return out;
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** What one SQL statement does. `dynamic`: the text came from a template with substitutions. */
export function queryFacts(sql: string, opts: { dynamic?: boolean } = {}): QueryFacts {
  const text = clean(sql).replace(/;$/, "");
  const facts: QueryFacts = { kind: "other", locks: false, tables: [], reads: [], writes: [], deletes: [], filters: [], outputs: [], builtFromValues: !!opts.dynamic, unresolved: [], ctes: [] };
  if (/^WITH\b/i.test(text)) {
    for (const m of text.matchAll(/(?:^WITH\s+(?:RECURSIVE\s+)?|,\s*)("?[A-Za-z_][\w$]*"?)\s+AS\s*\(/gi)) facts.ctes.push(unquote(m[1]!));
  }
  const tx = text.match(/^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\b/i);
  if (tx) {
    facts.kind = "transaction";
    facts.transaction = /^ROLLBACK/i.test(tx[1]!) ? "rollback" : /^(COMMIT|END)/i.test(tx[1]!) ? "commit" : "begin";
    return facts;
  }
  facts.locks = topIndexOf(text, /^FOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE)\b/i) >= 0;
  const aliases: Alias = new Map();
  const addTable = (name: string, alias: string | undefined, join: QueryFacts["tables"][number]["join"]) => {
    const table = unquote(name);
    const a = alias && !KEYWORDS.has(alias.toLowerCase()) ? unquote(alias) : table;
    facts.tables.push({ table, alias: a, join });
    aliases.set(a.toLowerCase(), table);
    aliases.set(table.toLowerCase(), table);
  };
  const tableNames = () => uniq(facts.tables.map((t) => t.table));

  // Every table named after FROM / JOIN, with its alias and the kind of join.
  const scanTables = (body: string) => {
    const re = new RegExp(`\\b(FROM|(?:LEFT|RIGHT|FULL)(?:\\s+OUTER)?\\s+JOIN|INNER\\s+JOIN|CROSS\\s+JOIN|JOIN)\\s+(${IDENT})(?:\\s+(?:AS\\s+)?("?[A-Za-z_][\\w$]*"?))?`, "gi");
    for (const m of body.replace(/'[^']*'/g, "''").matchAll(re)) {
      const word = m[1]!.toUpperCase();
      const join = word === "FROM" ? "from" : word.startsWith("LEFT") ? "left" : word.startsWith("RIGHT") ? "right" : word.startsWith("FULL") ? "full" : word.startsWith("CROSS") ? "cross" : "inner";
      addTable(m[2]!, m[3], join);
    }
  };

  const clause = (body: string, start: RegExp, ends: RegExp[]): string => {
    const i = topIndexOf(body, start);
    if (i < 0) return "";
    const from = i + (body.slice(i).match(start)?.[0].length ?? 0);
    const end = Math.min(...ends.map((e) => topIndexOf(body, e, from)).filter((x) => x >= 0), body.length);
    return body.slice(from, end);
  };
  const filterText = (body: string) =>
    [
      ...[...body.matchAll(/\bON\s+(.+?)(?=\b(?:LEFT|RIGHT|FULL|INNER|CROSS|JOIN|WHERE|GROUP|ORDER|LIMIT|RETURNING)\b|$)/gi)].map((m) => m[1]!),
      clause(body, /^WHERE\b/i, [/^GROUP\s+BY\b/i, /^ORDER\s+BY\b/i, /^LIMIT\b/i, /^RETURNING\b/i, /^HAVING\b/i]),
      clause(body, /^GROUP\s+BY\b/i, [/^ORDER\s+BY\b/i, /^LIMIT\b/i, /^HAVING\b/i]),
      clause(body, /^ORDER\s+BY\b/i, [/^LIMIT\b/i, /^OFFSET\b/i]),
    ].join(" ");

  let m: RegExpMatchArray | null;
  if ((m = text.match(new RegExp(`^INSERT\\s+INTO\\s+(${IDENT})(?:\\s+(?:AS\\s+)?([A-Za-z_]\\w*))?\\s*\\(([^)]*)\\)`, "i")))) {
    facts.kind = "insert";
    addTable(m[1]!, m[2], "into");
    facts.writes = splitTop(m[3]!, ",").map((c) => `${unquote(m![1]!)}.${unquote(c)}`);
  } else if ((m = text.match(new RegExp(`^UPDATE\\s+(${IDENT})(?:\\s+(?:AS\\s+)?([A-Za-z_]\\w*))?\\s+SET\\s+`, "i")))) {
    facts.kind = "update";
    addTable(m[1]!, m[2] && m[2].toUpperCase() !== "SET" ? m[2] : undefined, "update");
    const set = clause(text, /^SET\b/i, [/^WHERE\b/i, /^RETURNING\b/i, /^FROM\b/i]);
    scanTables(text.slice(topIndexOf(text, /^SET\b/i)));
    const t = unquote(m[1]!);
    for (const a of splitTop(set, ",")) {
      const left = a.split("=")[0]!.trim();
      facts.writes.push(`${t}.${unquote(left)}`);
      facts.reads.push(...columnRefs(a.slice(a.indexOf("=") + 1), aliases, tableNames(), facts.unresolved));
    }
    facts.filters = columnRefs(filterText(text), aliases, tableNames(), facts.unresolved);
  } else if ((m = text.match(new RegExp(`^DELETE\\s+FROM\\s+(${IDENT})(?:\\s+(?:AS\\s+)?([A-Za-z_]\\w*))?`, "i")))) {
    facts.kind = "delete";
    addTable(m[1]!, m[2] && !/^(WHERE|USING|RETURNING)$/i.test(m[2]) ? m[2] : undefined, "delete");
    facts.deletes = [unquote(m[1]!)];
    facts.filters = columnRefs(filterText(text), aliases, tableNames(), facts.unresolved);
  } else if (/^(SELECT|WITH)\b/i.test(text)) {
    facts.kind = "select";
    scanTables(text);
    const selectAt = topIndexOf(text, /^SELECT\b/i);
    const fromAt = topIndexOf(text, /^FROM\b/i, selectAt);
    const list = selectAt >= 0 ? text.slice(selectAt + 6, fromAt < 0 ? text.length : fromAt).replace(/^\s*DISTINCT\s+/i, "") : "";
    for (const item of splitTop(list, ",")) {
      const asM = item.match(/\s+AS\s+("?[A-Za-z_][\w$]*"?)\s*$/i);
      const expr = asM ? item.slice(0, asM.index) : item;
      const from = uniq(columnRefs(expr, aliases, tableNames(), facts.unresolved));
      facts.reads.push(...from);
      const as = asM ? unquote(asM[1]!) : expr.trim().match(/(?:^|\.)("?[A-Za-z_][\w$]*"?|\*)\s*$/)?.[1];
      if (as) facts.outputs.push({ as: unquote(as), from });
    }
    facts.filters = columnRefs(filterText(text.slice(fromAt < 0 ? 0 : fromAt)), aliases, tableNames(), facts.unresolved);
  }
  facts.reads = uniq(facts.reads);
  facts.filters = uniq(facts.filters);
  facts.unresolved = uniq(facts.unresolved);
  return facts;
}
