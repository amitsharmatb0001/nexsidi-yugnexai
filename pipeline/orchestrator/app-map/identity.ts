// What a finding is about, by the facts of the app (2026-10-30, understanding plan step 4). A finding was known by its words
// and its file; the same fact in new words looked new (Brewline 3's item-name finding, 18 rounds), and a new fact under the
// same rule in the same file looked like a repeat (the 14:42 fix had landed; the later reports were the read fallback and the
// schema file). Here a finding's identity is the rule or plan item it cites plus the place in the app map its file and line
// fall in: an endpoint (the line is inside its handler or one of its queries), a table (a migration), a page, or the file.
// The ledger records which identities were sent to which builder, so one that comes back after a fix is known as such.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppMap } from "./index.ts";

export interface Place {
  kind: "endpoint" | "function" | "table" | "page" | "file";
  key: string;
}

/** The place in the app a file and line fall in. For a migration, the first table of the map the text names. */
export function placeOf(map: AppMap, file: string, line?: number, text = ""): Place {
  const f = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (f.startsWith("db/")) {
    const tables = Object.keys(map.database.tables);
    const named = [...text.matchAll(/\b([a-z_][a-z0-9_]*)(?:\.[a-z_][a-z0-9_]*)?\b/gi)].map((m) => m[1]!).find((t) => tables.includes(t));
    return named ? { kind: "table", key: named } : { kind: "file", key: f };
  }
  if (f.startsWith("backend/") && line) {
    const key = (e: AppMap["endpoints"][number]) => `${e.method} ${e.path}`;
    const byQuery = map.endpoints.filter((e) => e.sql.some((q) => q.file === f && q.line === line));
    if (byQuery.length === 1) return { kind: "endpoint", key: key(byQuery[0]!) };
    const byHandler = map.endpoints.filter((e) => e.handlerFile === f && e.handlerSpan && line >= e.handlerSpan[0] && line <= e.handlerSpan[1]);
    if (byHandler.length === 1) return { kind: "endpoint", key: key(byHandler[0]!) };
    const byRoute = map.endpoints.filter((e) => e.file === f && e.line === line);
    if (byRoute.length === 1) return { kind: "endpoint", key: key(byRoute[0]!) };
    // A helper the handlers call (Brewline 3: validatePickupSlot): the innermost named function the line is in.
    const fn = (map.functions ?? []).filter((x) => x.file === f && line >= x.start && line <= x.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (fn) return { kind: "function", key: `${f}#${fn.name}` };
  }
  if (f.startsWith("frontend/")) {
    const pages = map.pages.filter((p) => p.file === f);
    if (pages.length === 1) return { kind: "page", key: pages[0]!.route };
  }
  return { kind: "file", key: f };
}

const CITED_PLACE = /((?:backend|frontend|db)\/[^\s:,;()]+\.[a-z]+):(\d+)/i;
// The rule or plan item a finding names: [map-rule INT1], or the first bracketed id like [INT1], [SC2], [EP3].
const CITED_ID = /\[map-rule ([A-Z0-9]+)\]|\[([A-Z]+\d+)\]/;

/** "<rule or plan item>|<kind>:<key>". A finding that cites no id is identified by its place alone ("?|…"). */
export function findingIdentity(map: AppMap, finding: { file: string; issue: string }): string {
  const at = finding.issue.match(CITED_PLACE);
  const file = at?.[1] ?? finding.file;
  const line = at ? Number(at[2]) : undefined;
  const id = finding.issue.match(CITED_ID);
  const place = placeOf(map, file, line, finding.issue);
  return `${id?.[1] ?? id?.[2] ?? "?"}|${place.kind}:${place.key}`;
}

// ── The ledger: which identities went to which builder ─────────────────────
export interface SentRecord {
  identity: string;
  owner: string;
  text: string;
  sentAt: string;
}

const LEDGER = "findings-ledger.jsonl";

export function recordSent(projectDir: string, items: Array<Omit<SentRecord, "sentAt">>, at = new Date().toISOString()): void {
  if (items.length === 0) return;
  appendFileSync(join(projectDir, LEDGER), items.map((i) => JSON.stringify({ ...i, sentAt: at })).join("\n") + "\n");
}

function readLedger(projectDir: string): SentRecord[] {
  const f = join(projectDir, LEDGER);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf-8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as SentRecord];
    } catch {
      return [];
    }
  });
}

/** The last time this identity was sent to a builder, or null. */
export function sentBefore(projectDir: string, identity: string): SentRecord | null {
  return readLedger(projectDir).filter((r) => r.identity === identity).pop() ?? null;
}
