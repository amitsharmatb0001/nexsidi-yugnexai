// A plain check that the SQL a backend change runs matches the schema the migrations build.
// 2026-10-13 (Shopbill Express Build): the backend editor changed an INSERT to write po_reference, passed
// `tsc` and `npm run build`, and never wrote the migration, so every invoice failed with a 500. Types cannot
// see a database column. This reads the migrations (CREATE TABLE and ALTER TABLE ... ADD COLUMN) and the
// INSERT statements in the code, and names any column or table that is written but never created.

export type Schema = Map<string, Set<string>>; // table -> columns, all lower case

const unquote = (s: string) => s.replace(/"/g, "").trim().toLowerCase();
const tableName = (raw: string) => unquote(raw).split(".").pop()!;

const CONSTRAINT_START = /^(primary|foreign|unique|constraint|check|exclude|like)\b/i;

function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export function schemaFromSql(sqlTexts: string[]): Schema {
  const schema: Schema = new Map();
  const add = (table: string, column: string) => {
    if (!schema.has(table)) schema.set(table, new Set());
    schema.get(table)!.add(column);
  };

  for (const sql of sqlTexts) {
    const text = sql.replace(/--[^\n]*/g, "");

    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi;
    for (const m of text.matchAll(createRe)) {
      const table = tableName(m[1]!);
      let depth = 1;
      let i = m.index! + m[0].length;
      const start = i;
      while (i < text.length && depth > 0) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        i++;
      }
      const body = text.slice(start, i - 1);
      if (!schema.has(table)) schema.set(table, new Set());
      for (const part of topLevelParts(body)) {
        const trimmed = part.trim();
        if (!trimmed || CONSTRAINT_START.test(trimmed)) continue;
        const col = unquote(trimmed.split(/\s+/)[0]!);
        if (col) add(table, col);
      }
    }

    const alterRe = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)([^;]*)/gi;
    for (const m of text.matchAll(alterRe)) {
      const table = tableName(m[1]!);
      const addRe = /add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?!constraint\b|primary\b|foreign\b|unique\b|check\b)([\w"]+)/gi;
      for (const a of m[2]!.matchAll(addRe)) add(table, unquote(a[1]!));
    }
  }
  return schema;
}

export interface InsertedColumns {
  table: string;
  columns: string[];
}

export function insertedColumns(code: string): InsertedColumns[] {
  const out: InsertedColumns[] = [];
  const re = /insert\s+into\s+([\w."]+)\s*\(([^)]*)\)/gi;
  for (const m of code.matchAll(re)) {
    const raw = m[2]!;
    if (raw.includes("${")) continue; // a dynamic list is not a column name
    const columns = raw.split(",").map(unquote).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
    if (columns.length > 0) out.push({ table: tableName(m[1]!), columns });
  }
  return out;
}

export interface MissingColumn {
  table: string;
  column: string;
}

/** Columns the code writes that no migration creates. An unreadable schema reports nothing. */
export function missingColumns(code: string, schema: Schema): MissingColumn[] {
  if (schema.size === 0) return [];
  const missing: MissingColumn[] = [];
  for (const { table, columns } of insertedColumns(code)) {
    const known = schema.get(table);
    for (const column of columns) {
      if (!known || !known.has(column)) {
        if (!missing.some((x) => x.table === table && x.column === column)) missing.push({ table, column });
      }
    }
  }
  return missing;
}
