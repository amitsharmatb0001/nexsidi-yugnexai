// The rules every app keeps, checked on the app map (2026-10-30, understanding plan step 3). The one rulebook
// (baseline-rules.ts) was text the builders read and the reviewers judged; a broken rule surfaced, if at all, rounds later in
// a model's words. Here each rule is a check on facts the map read from the code — no model — and a broken rule names the
// fact, the file and line, and the owner, when the builder says "done" (builder-exit-checks.ts) and before the review.
//   INT1  an order line keeps the item's name and price; deleting or editing the item neither deletes nor hides the line
//   INT2  a stock check followed by a write locks the rows in a transaction
//   SEC1  no SQL is built from request values
//   SEC2  an endpoint the contract marks as signed-in checks sign-in before its handler; a role-limited one checks the role
//   SEC9  no endpoint lets the caller choose a role for themselves
//   MAP   the map's own gaps: SQL naming a missing column, a call with no endpoint, the schema file against the migrations
// What a rule cannot see (SEC3 "own records only" is checked in handler code, not SQL; INT3 compares business numbers
// across folders) is not checked here, and is not claimed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppMap, FileOwner } from "./index.ts";
import type { EndpointFacts } from "./code.ts";
import { pathFits } from "../acceptance-tests.ts";
import { limitedRolesFromContract } from "../../../agents/riya/src/index.ts";

export interface RuleViolation {
  rule: "INT1" | "INT2" | "SEC1" | "SEC2" | "SEC9" | "MAP";
  /** the kind of break, the same in every project (mistakes.ts keys repeats by rule and kind) */
  kind: string;
  owner: FileOwner;
  file: string;
  line: number;
  /** what the code does, as the map read it */
  fact: string;
  /** what keeping the rule takes */
  fix: string;
}

const OWNER_OF: Record<string, FileOwner> = { backend: "shubham", frontend: "aanya", db: "pranav" };
const ownerOf = (file: string): FileOwner => OWNER_OF[file.split("/")[0]!] ?? "shubham";

const NAME_COL = /(^|_)(name|title)($|_)/;
const PRICE_COL = /(^|_)(price|amount|cost)($|_)/;
const QTY_COL = /(^|_)(quantity|qty|count)($|_)/;
const PASSWORD_COL = /password|passwd|pass_hash/;
const STOCK_COL = /(^|_)(in_stock|stock|available|availability|capacity|seats|remaining|inventory|quantity_available)($|_)/;
// A sign-in check by its name; a rate limiter is not one.
const SIGN_IN = /auth|protect|jwt|token|session|signed|login|role|staff|admin|owner|manager/i;

export function checkRules(projectDir: string, map: AppMap): RuleViolation[] {
  const out: RuleViolation[] = [];
  const tables = map.database.tables;

  // ── INT1: order history keeps the item as it was ──────────────────────────
  const isItem = (t: string) => {
    const cols = Object.keys(tables[t]?.columns ?? {});
    return cols.some((c) => NAME_COL.test(c)) && cols.some((c) => PRICE_COL.test(c));
  };
  for (const [line, t] of Object.entries(tables)) {
    const refs = Object.entries(t.columns).filter(([, c]) => c.references);
    if (refs.length < 2) continue; // a line table points at an item and at its header
    // ...and records a price or a quantity of its own (complex1: applications → properties is a reference, not a line).
    const ownCols = Object.entries(t.columns).filter(([, c]) => !c.references).map(([n]) => n);
    if (!ownCols.some((x) => PRICE_COL.test(x) || QTY_COL.test(x))) continue;
    // The header is the table the line is named after: booking_items → bookings, order_items → orders (Trailhead:
    // bookings has waiver_signature_name and total_price, and is still not an item).
    const header = refs.map(([, c]) => c.references!.table).find((x) => line.startsWith(x.replace(/e?s$/, "")));
    for (const [fkCol, c] of refs) {
      const item = c.references!.table;
      if (!isItem(item) || item === line || item === header) continue;
      const own = Object.keys(t.columns).filter((x) => x !== fkCol);
      const nameCopy = own.find((x) => NAME_COL.test(x));
      const priceCopy = own.find((x) => PRICE_COL.test(x));
      const itemName = Object.keys(tables[item]!.columns).find((x) => NAME_COL.test(x))!;
      const itemPrice = Object.keys(tables[item]!.columns).find((x) => PRICE_COL.test(x))!;
      for (const [copy, what, src] of [[nameCopy, "name", itemName], [priceCopy, "price", itemPrice]] as const) {
        if (!copy) {
          out.push({ rule: "INT1", kind: "no-copy", owner: "pranav", file: t.createdIn, line: 1, fact: `${line} keeps no copy of ${item}.${src}: editing the item changes every past ${line} line`, fix: `add a column to ${line} that stores the ${what} at the time (a new migration), and write it on every insert` });
        }
      }
      if (c.references!.onDelete === "CASCADE") {
        out.push({ rule: "INT1", kind: "cascade", owner: "pranav", file: c.addedIn, line: 1, fact: `deleting a ${item} row deletes its ${line} lines (ON DELETE CASCADE) through ${line}.${fkCol}`, fix: `use ON DELETE RESTRICT, or SET NULL with ${fkCol} allowed to be empty and the lines keeping their copies (a new migration)` });
      }
      for (const q of map.sql) {
        if (q.facts.kind === "insert" && q.facts.tables[0]?.table === line) {
          for (const copy of [nameCopy, priceCopy]) {
            if (copy && !q.facts.writes.includes(`${line}.${copy}`)) {
              out.push({ rule: "INT1", kind: "insert-without-copy", owner: ownerOf(q.file), file: q.file, line: q.line, fact: `${q.function} inserts ${line} lines without ${line}.${copy}`, fix: `write ${copy} from the item as it is at the time of the insert` });
            }
          }
        }
        // A read of the history: its main table is the line or its header (Trailhead listGear reads the catalog, FROM gear).
        if (q.facts.kind !== "select" || !q.facts.tables.some((x) => x.table === line) || ![line, header].includes(q.facts.tables[0]?.table)) continue;
        for (const o of q.facts.outputs) {
          const first = o.from[0];
          // Only when the line has its own copy to read: without one, the missing column (the database builder's) is the fact,
          // and the backend could not keep this rule (Brewline 3: the backend was sent the finding before the column existed).
          if ((first === `${item}.${itemName}` && nameCopy) || (first === `${item}.${itemPrice}` && priceCopy)) {
            out.push({ rule: "INT1", kind: "read-current", owner: ownerOf(q.file), file: q.file, line: q.line, fact: `${q.function} reads the ${first === `${item}.${itemName}` ? "name" : "price"} from ${first}, the current value, not what the ${line} line recorded`, fix: `read ${line}'s own copy${first === `${item}.${itemName}` ? (nameCopy ? ` (${nameCopy})` : "") : priceCopy ? ` (${priceCopy})` : ""}` });
          }
        }
        const join = q.facts.tables.find((x) => x.table === item && x.join === "inner");
        if (join && c.references!.onDelete === "SET NULL") {
          out.push({ rule: "INT1", kind: "inner-join-hides", owner: ownerOf(q.file), file: q.file, line: q.line, fact: `${q.function} INNER JOINs ${item}, but deleting a ${item} row sets ${line}.${fkCol} to empty: those lines disappear from the history`, fix: `use LEFT JOIN ${item}` });
        }
      }
    }
  }

  // ── INT2: a stock check and the write that follows are one atomic step ────
  for (const e of map.endpoints) {
    const checkAt = e.sql.findIndex((q) => q.facts.kind === "select" && [...q.facts.reads, ...q.facts.filters].some((r) => STOCK_COL.test(r.split(".")[1] ?? "")));
    if (checkAt < 0) continue;
    const writes = e.sql.slice(checkAt + 1).filter((q) => q.facts.kind === "insert" || q.facts.kind === "update");
    if (writes.length === 0) continue;
    const check = e.sql[checkAt]!;
    const inTx = e.sql.slice(0, checkAt).some((q) => q.facts.transaction === "begin");
    if (!(inTx && check.facts.locks)) {
      const col = [...check.facts.reads, ...check.facts.filters].find((r) => STOCK_COL.test(r.split(".")[1] ?? ""))!;
      out.push({ rule: "INT2", kind: inTx ? "no-lock" : "no-transaction", owner: ownerOf(check.file), file: check.file, line: check.line, fact: `${e.method} ${e.path} reads ${col} and then writes ${writes[0]!.facts.tables[0]?.table ?? "rows"}${inTx ? " in a transaction, but without locking the rows it read" : " outside a transaction"}: two requests at once can both pass the check`, fix: "run the check and the write in one transaction (BEGIN … COMMIT) and read the rows with SELECT … FOR UPDATE, or make the write itself conditional" });
    }
  }

  // ── SEC1: no SQL built from request values ────────────────────────────────
  for (const q of map.sql) {
    if (q.fromRequest) out.push({ rule: "SEC1", kind: "sql-from-request", owner: ownerOf(q.file), file: q.file, line: q.line, fact: `${q.function} builds its SQL text from request values`, fix: "pass every value as a $n parameter; build only fixed column names into the text" });
  }

  // ── SEC2 and SEC9: who may call an endpoint, and no self-chosen role ──────
  let contract: Array<{ method?: string; path?: string; auth?: boolean; description?: string }> = [];
  try {
    const f = join(projectDir, "api-contract.json");
    if (existsSync(f)) contract = (JSON.parse(readFileSync(f, "utf-8")) as { endpoints?: typeof contract }).endpoints ?? [];
  } catch {
    contract = [];
  }
  // The same path first: GET /orders/public also fits GET /orders/:id.
  const endpointOf = (c: { method?: string; path?: string }): EndpointFacts | undefined => {
    const same = map.endpoints.filter((e) => e.method === String(c.method ?? "").toUpperCase());
    return same.find((e) => e.path === c.path) ?? same.find((e) => pathFits(e.path, String(c.path ?? "")));
  };
  const isSignIn = (m: string) => SIGN_IN.test(m) && !/limit/i.test(m);
  for (const c of contract) {
    const e = endpointOf(c);
    if (!e) continue;
    const roles = limitedRolesFromContract([c]);
    // Only what the contract states: an endpoint with no auth field is not checked. A handler that answers 401 itself checks.
    if (c.auth === true && !e.middleware.some(isSignIn) && e.answers401 !== true) {
      out.push({ rule: "SEC2", kind: "no-sign-in", owner: ownerOf(e.file), file: e.file, line: e.line, fact: `${e.method} ${e.path} needs sign-in by the contract, but no sign-in check runs before ${e.handler}`, fix: "put the sign-in middleware on the route or on its router before it" });
    }
    if (roles.length > 0 && e.answers403 !== true && !e.middleware.some((m) => roles.some((r) => m.toLowerCase().includes(r)) || /role/i.test(m))) {
      out.push({ rule: "SEC2", kind: "no-role-check", owner: ownerOf(e.file), file: e.file, line: e.line, fact: `${e.method} ${e.path} is limited to ${roles.join(" or ")} by the contract, but no role check runs before ${e.handler} (middleware: ${e.middleware.join(", ") || "none"})`, fix: `add the ${roles.join("/")} role check to the route` });
    }
  }
  // The account table is the one that stores a password (9739da9032b0: contacts.role is a job title, not an access role).
  const accounts = new Set(Object.entries(tables).filter(([, t]) => Object.keys(t.columns).some((x) => PASSWORD_COL.test(x))).map(([n]) => n));
  for (const e of map.endpoints) {
    const c = contract.find((x) => endpointOf(x) === e);
    if (c && limitedRolesFromContract([c]).length > 0) continue; // a role-limited endpoint may set another account's role
    for (const q of e.sql) {
      for (const w of q.writesFromRequest) {
        if (/\.(role|roles|is_admin|is_staff|permissions?)$/.test(w) && accounts.has(w.split(".")[0]!)) {
          out.push({ rule: "SEC9", kind: "role-from-request", owner: ownerOf(q.file), file: q.file, line: q.line, fact: `${e.method} ${e.path}: ${w} is written from the request, so a caller chooses their own role`, fix: "set the lowest role in the code; never take it from the request" });
        }
      }
    }
  }

  // ── The map's own gaps ────────────────────────────────────────────────────
  for (const u of map.unknownColumns) out.push({ rule: "MAP", kind: "unknown-column", owner: ownerOf(u.file), file: u.file, line: u.line, fact: u.why, fix: "use a column the migrations create, or add it in a new migration" });
  // One violation per call site: a shared lib/api.ts is reached from every page (7e1ab88dc56a: one call, 8 pages).
  const calls = new Map<string, { c: (typeof map.links.unmatchedCalls)[number]; pages: string[] }>();
  for (const c of map.links.unmatchedCalls) {
    const key = `${c.file}:${c.line} ${c.method} ${c.path}`;
    if (calls.has(key)) calls.get(key)!.pages.push(c.page);
    else calls.set(key, { c, pages: [c.page] });
  }
  for (const { c, pages } of calls.values()) {
    // In the contract: the backend does not serve it (193c3080e582: an empty router). Not in it: the page calls the wrong path.
    const inContract = contract.some((x) => String(x.method ?? "").toUpperCase() === c.method && (x.path === c.path || pathFits(String(x.path ?? ""), c.path)));
    out.push(inContract
      ? { rule: "MAP", kind: "contract-endpoint-not-served", owner: "shubham", file: "backend/src", line: 0, fact: `${c.method} ${c.path} is in the contract and called by ${pages.join(", ")} (${c.file}:${c.line}), but the backend does not serve it`, fix: `serve ${c.method} ${c.path} as the contract describes` }
      : { rule: "MAP", kind: "call-outside-contract", owner: "aanya", file: c.file, line: c.line, fact: `${c.method} ${c.path} (from ${pages.join(", ")}) matches no endpoint of the backend and is not in the contract`, fix: "call an endpoint of the approved contract" });
  }
  for (const d of map.schemaDiff) out.push({ rule: "MAP", kind: "schema-file-differs", owner: "pranav", file: "db/src/schema.ts", line: 1, fact: `${d.table}.${d.column} is in the ${d.in === "migrations only" ? "migrations but not in the schema file" : "schema file but not in the migrations"}`, fix: "make db/src/schema.ts match the migrations" });
  return out;
}

/** The violations as finding lines for one owner (or all), for the finish checks and the review. */
export function ruleFindings(violations: RuleViolation[], owner?: FileOwner): string[] {
  return violations
    .filter((v) => !owner || v.owner === owner)
    .map((v) => `[map-rule ${v.rule}] ${v.file}${v.line > 0 ? `:${v.line}` : ""} — ${v.fact}. To keep the rule: ${v.fix}.`);
}
