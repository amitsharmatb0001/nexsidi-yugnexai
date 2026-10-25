// The frontend builder's own checks before it may say "done" (2026-10-24, docs/root-cause/2026-10-24-brewline.md).
// On Brewline 8 emoji findings and the missing-colour findings were raised in review, after the builder had finished: its
// instructions said "no emoji" and the checks existed, but they ran only in the review stage. The same checks now run,
// by the system, when the builder calls task_complete (last phase and fix rounds), and what they find is handed back to
// it first. Pure file reads; no model call.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";
import { scanProjectForEmojiUi } from "./emoji-ui-check.ts";
import { scanProjectForDeadButtons } from "./dead-ui-check.ts";
import { specColours } from "../../../agents/vanya/src/index.ts";
import { contractRouteFindings, staffOnlyEndpoint, type ContractEndpoint } from "./contract-route-check.ts";
import { migrationFindings } from "./migration-check.ts";
import { metadataLeakFindings, cookieSecureFindings, secretLoggingFindings, strayShippedFileFindings, schemaMigrationSyncFindings, projectHygieneFindings, dedupeAgainstHygiene } from "./shipping-hygiene.ts";
import { planItemsFor, type PlanItem } from "../chief-check.ts";

const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git"]);

function frontendText(frontendDir: string): string {
  let text = "";
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const full = join(dir, n);
      try {
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(css|tsx?|jsx?)$/i.test(n)) text += readFileSync(full, "utf-8").toUpperCase() + "\n";
      } catch {
        // unreadable: skipped
      }
    }
  };
  walk(frontendDir);
  return text;
}

/** Every colour the approved spec names must appear somewhere in the frontend's styles or code. */
export function missingSpecColours(projectId: string): string[] {
  const dir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  const specFile = join(dir, "spec.json");
  if (!existsSync(specFile)) return [];
  let description = "";
  try {
    description = String((JSON.parse(readFileSync(specFile, "utf-8")) as { description?: string }).description ?? "");
  } catch {
    return [];
  }
  const colours = specColours({ description } as never);
  if (colours.length === 0) return [];
  const text = frontendText(join(dir, "frontend"));
  return colours.filter((c) => !text.includes(c.hex.toUpperCase())).map((c) => `${c.name} ${c.hex}`);
}

// 2026-10-24: generated apps hot-linked stock photos — on Trailhead a burger photo stood in for a sleeping bag and the
// browser blocked others (net::err_blocked_by_orb). An image the app shows must live in the app (a designed placeholder
// under public/) or not be shown. Found: an http(s) URL ending in an image type, or on a stock-photo/placeholder host.
const EXTERNAL_IMAGE = /https?:\/\/(?:[^\s"'`)<>]+\.(?:jpe?g|png|webp|gif|avif|svg)(?:\?[^\s"'`)<>]*)?|(?:images\.unsplash\.com|source\.unsplash\.com|plus\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com|picsum\.photos|placehold\.co|via\.placeholder\.com|loremflickr\.com)[^\s"'`)<>]*)/gi;

export function externalImageUrls(dir: string): Array<{ file: string; url: string }> {
  const out: Array<{ file: string; url: string }> = [];
  const walk = (d: string, rel: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const full = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      try {
        if (statSync(full).isDirectory()) walk(full, r);
        else if (/\.(tsx?|jsx?|css|sql|json)$/i.test(n) && n !== "package.json" && n !== "package-lock.json") {
          for (const m of readFileSync(full, "utf-8").matchAll(EXTERNAL_IMAGE)) out.push({ file: r, url: m[0] });
        }
      } catch {
        // unreadable: skipped
      }
    }
  };
  walk(dir, "");
  return out;
}

const imageFindings = (where: string, found: Array<{ file: string; url: string }>) =>
  found.map((f) => `${where}${f.file}: the image ${f.url} is loaded from another site — use a designed placeholder saved in the app (an SVG under public/images) or no image`);

/** The backend builder's own checks before it may finish: no hot-linked images in its code or the database seed files. */
export function backendExitChecks(projectId: string): string[] {
  const dir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  return [
    ...imageFindings("backend/", externalImageUrls(join(dir, "backend", "src"))),
    ...imageFindings("db/", externalImageUrls(join(dir, "db"))),
    ...starterContentFindings(dir),
    ...roleFromRequestFindings(join(dir, "backend", "src")),
    ...staffAccountFindings(dir),
    ...secretLoggingFindings(dir).filter((f) => f.startsWith("backend/")),
    ...strayShippedFileFindings(dir).filter((f) => f.startsWith("backend/")),
  ];
}

export { metadataLeakFindings, cookieSecureFindings, secretLoggingFindings, strayShippedFileFindings, schemaMigrationSyncFindings, projectHygieneFindings, dedupeAgainstHygiene };

// 2026-10-25 (brewline3): the reviewers judge the code against the approved plan's items (SC, EP, ROLES, DESIGN, SEC, INT), but the
// builders never had to check their own work against the same list, so every gap was found in review, a paid round each. The builder
// now gets the items that concern it in its task and cannot finish until its summary accounts for each one with a file it checked.
const BACKEND_ITEMS = /^(EP\d+|ROLES|SEC(1|2|3|4|6|7|9)|INT\d+)$/;
const FRONTEND_ITEMS = /^(SC\d+|DESIGN|ROLES|SEC(5|8)|INT3)$/;

export function checklistFor(projectDir: string, role: "backend" | "frontend"): PlanItem[] {
  const wanted = role === "backend" ? BACKEND_ITEMS : FRONTEND_ITEMS;
  return planItemsFor(projectDir).filter((i) => wanted.test(i.id));
}

/** The task text that gives a builder its checklist from the start. */
export function checklistTaskText(projectId: string, role: "backend" | "frontend"): string {
  const dir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  const items = checklistFor(dir, role);
  if (items.length === 0) return "";
  return `APPROVED PLAN CHECKLIST — the reviewers judge your work against exactly these items. Build to them, and before you call task_complete check each one in your own files. Your task_complete summary must list every item as "[ID] file:line — what you checked", one line each; the system refuses to finish without them.
${items.map((i) => `[${i.id}] ${i.text}`).join("\n")}`;
}

const HAS_FILE_NEAR = /[\w./\\-]+\.(?:tsx?|jsx?|css|sql|json|mjs|cjs|ya?ml)\b/i;

/** One finding listing the checklist items the summary does not account for (an id with a file named near it), or none. */
export function checklistFindings(projectId: string, role: "backend" | "frontend", summary: string): string[] {
  const dir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  const items = checklistFor(dir, role);
  const missing = items.filter((i) => {
    const at = summary.search(new RegExp(`\\[${i.id}\\]|\\b${i.id}\\b`));
    return at < 0 || !HAS_FILE_NEAR.test(summary.slice(at, at + 220));
  });
  if (missing.length === 0) return [];
  return [
    `your task_complete summary does not account for ${missing.length} of the approved plan's ${items.length} checklist items. Check each one in your files now (read the code, not memory) and list every item in the summary as "[ID] file:line — what you checked". Missing:\n${missing.map((i) => `[${i.id}] ${i.text}`).join("\n")}`,
  ];
}

// 2026-10-24 (Brewline): the spec says customers browse the menu, but no instruction told a builder to ship starter
// content, so the delivered app opened empty. A public list endpoint needs rows in the database from the first start:
// any INSERT into a table other than users, in a seed module under backend/src/db or a migration under db/migrations.
const SEED_INSERT = /INSERT\s+INTO\s+"?(\w+)"?/gi;

export function starterContentFindings(projectDir: string): string[] {
  const contractFile = join(projectDir, "api-contract.json");
  if (!existsSync(contractFile)) return [];
  let endpoints: Array<{ method?: string; path?: string; auth?: boolean }>;
  try {
    endpoints = (JSON.parse(readFileSync(contractFile, "utf-8")) as { endpoints?: typeof endpoints }).endpoints ?? [];
  } catch {
    return [];
  }
  const lists = endpoints.filter((e) => e.method?.toUpperCase() === "GET" && e.auth === false && e.path && !/:/.test(e.path) && !/\/(health|auth|status|ping)(\/|$)/i.test(e.path));
  if (lists.length === 0) return [];
  let seeded = false;
  const scan = (d: string, pattern: RegExp) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const full = join(d, n);
      try {
        if (statSync(full).isDirectory()) scan(full, pattern);
        else if (pattern.test(n)) {
          for (const m of readFileSync(full, "utf-8").matchAll(SEED_INSERT)) if (m[1]!.toLowerCase() !== "users") seeded = true;
        }
      } catch {
        // unreadable: skipped
      }
    }
  };
  scan(join(projectDir, "backend", "src", "db"), /seed.*\.(ts|js|sql)$/i);
  scan(join(projectDir, "db", "migrations"), /\.sql$/i);
  if (seeded) return [];
  return [`backend/src/db: ${lists.map((e) => `GET ${e.path}`).join(", ")} ${lists.length === 1 ? "is a public list" : "are public lists"}, but the database ships with no starter rows (no INSERT into any table but users) — add backend/src/db/seedCatalog.ts with 8 to 15 believable rows, run at startup only when the table is empty`];
}

// 2026-10-24 (Brewline): the footer's YugNex logo was a retyped copy of a 5,432-character encoded image and showed as a
// broken image. The scaffold now saves the logo as public/yugnex-logo.png; every YugNex logo must use that file.
const YUGNEX_IMG = /<img\b[^>]*\balt=["']YugNex["'][^>]*>/gi;

export function attributionLogoFindings(frontendDir: string): string[] {
  const out: string[] = [];
  let usesFile = false;
  const walk = (d: string, rel: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n) || n === "public") continue;
      const full = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      try {
        if (statSync(full).isDirectory()) walk(full, r);
        else if (/\.(tsx|jsx)$/i.test(n)) {
          for (const m of readFileSync(full, "utf-8").matchAll(YUGNEX_IMG)) {
            if (/\bsrc=["']\/yugnex-logo\.png["']/.test(m[0])) usesFile = true;
            else out.push(`${r}: the YugNex logo must be <img src="/yugnex-logo.png" ...> (the system saved the file in public/); an embedded or retyped image shows as broken`);
          }
        }
      } catch {
        // unreadable: skipped
      }
    }
  };
  walk(frontendDir, "");
  if (usesFile && !existsSync(join(frontendDir, "public", "yugnex-logo.png"))) out.push("frontend: public/yugnex-logo.png is missing, so the footer logo is broken — do not delete it");
  return out;
}

export function frontendExitChecks(projectId: string): string[] {
  const out: string[] = [];
  out.push(...imageFindings("", externalImageUrls(join(buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds"), "frontend"))));
  out.push(...attributionLogoFindings(join(buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds"), "frontend")));
  for (const f of scanProjectForEmojiUi(projectId)) out.push(`${f.file}: ${f.issue}`);
  for (const f of scanProjectForDeadButtons(projectId)) out.push(`${f.file}: ${f.issue}`);
  const projectDir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  out.push(...metadataLeakFindings(projectDir), ...cookieSecureFindings(projectDir), ...secretLoggingFindings(projectDir).filter((f) => f.startsWith("frontend/")), ...strayShippedFileFindings(projectDir).filter((f) => f.startsWith("frontend/")));
  const missing = missingSpecColours(projectId);
  if (missing.length > 0) out.push(`frontend theme: the approved spec's colours are not used anywhere in the frontend: ${missing.join(", ")} — put them in the theme (app/theme-overrides.css)`);
  return out;
}

/**
 * The approved API contract against the compiled backend (contract-route-check.ts). Not run when the contract or the
 * build is missing, or when the compiled app is older than the source (it would answer for code that has since changed).
 */
export async function backendContractFindings(projectId: string): Promise<string[]> {
  const dir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  const contractFile = join(dir, "api-contract.json");
  const dist = join(dir, "backend", "dist", "app.js");
  if (!existsSync(contractFile) || !existsSync(dist)) return [];
  let endpoints: ContractEndpoint[];
  try {
    endpoints = (JSON.parse(readFileSync(contractFile, "utf-8")) as { endpoints?: ContractEndpoint[] }).endpoints ?? [];
  } catch {
    return [];
  }
  if (endpoints.length === 0) return [];
  let newestSource = 0;
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (SKIP.has(n)) continue;
      const full = join(d, n);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|js|json)$/.test(n)) newestSource = Math.max(newestSource, st.mtimeMs);
    }
  };
  try {
    walk(join(dir, "backend", "src"));
  } catch {
    return [];
  }
  if (statSync(dist).mtimeMs < newestSource) return [];
  const r = await contractRouteFindings(join(dir, "backend"), endpoints);
  return r.findings.map((f) => `backend (API contract): ${f}`);
}

/** Every migration applied, in order, to an empty PostgreSQL 16, as a customer's first `docker compose up` does (migration-check.ts). */
export async function backendFreshStartFindings(projectId: string): Promise<string[]> {
  const dir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  const r = await migrationFindings(dir);
  if (!r.ran && r.note) console.warn(`[exit-checks] ${r.note}`);
  return r.findings;
}

// 2026-10-25 (brewline2): sign-up took `role: 'customer' | 'staff'` from the request body, so anyone could register as staff.
// A role (or any permission) is never read from the request: sign-up makes the lowest role; more powerful accounts come from
// a seeded account or from someone who already has that power. Found: a file that handles sign-up and reads `role` from the
// request (a validation field named role, `req.body.role`, or role in a destructure of the request body).
const ROLE_FROM_REQUEST = [
  /\brole\s*:\s*z\./,
  /req\.body\.role\b/,
  /\{[^{}]*\brole\b[^{}]*\}\s*=\s*(?:req\.body|\w+\.data)\b/,
  /\{[^{}]*\brole\b[^{}]*\}\s*=\s*\w*[sS]chema\.parse\(\s*req\.body/,
];

export function roleFromRequestFindings(backendSrcDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const full = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      try {
        if (statSync(full).isDirectory()) walk(full, r);
        else if (/\.(ts|js)$/.test(n) && !/\.test\./.test(n)) {
          const text = readFileSync(full, "utf-8");
          if (/sign-?up|register/i.test(text) && ROLE_FROM_REQUEST.some((re) => re.test(text))) {
            out.push(`backend/src/${r}: sign-up reads the account's role from the request, so anyone can register with the most powerful role. A role is never taken from the request: sign-up always creates the lowest role, and staff/admin accounts come from a seeded account (seedStaff.ts) or from someone who already has that role`);
          }
        }
      } catch {
        // unreadable: skipped
      }
    }
  };
  walk(backendSrcDir, "");
  return out;
}

/**
 * A contract with endpoints only staff/admin/owner/manager may call needs such an account to exist from the first start;
 * sign-up cannot create one (see above). Satisfied by an INSERT INTO users with a staff-like role in a seed module under
 * backend/src/db or a migration.
 */
export function staffAccountFindings(projectDir: string): string[] {
  const contractFile = join(projectDir, "api-contract.json");
  if (!existsSync(contractFile)) return [];
  let endpoints: ContractEndpoint[];
  try {
    endpoints = (JSON.parse(readFileSync(contractFile, "utf-8")) as { endpoints?: ContractEndpoint[] }).endpoints ?? [];
  } catch {
    return [];
  }
  const staffOnly = endpoints.filter(staffOnlyEndpoint);
  if (staffOnly.length === 0) return [];
  let seeded = false;
  const scan = (d: string, pattern: RegExp) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const full = join(d, n);
      try {
        if (statSync(full).isDirectory()) scan(full, pattern);
        else if (pattern.test(n)) {
          const text = readFileSync(full, "utf-8");
          if (/INSERT\s+INTO\s+"?users"?/i.test(text) && /['"`](staff|admin|owner|manager)['"`]/i.test(text)) seeded = true;
        }
      } catch {
        // unreadable: skipped
      }
    }
  };
  scan(join(projectDir, "backend", "src", "db"), /seed.*\.(ts|js|sql)$/i);
  scan(join(projectDir, "db", "migrations"), /\.sql$/i);
  if (seeded) return [];
  return [`backend/src/db: ${staffOnly.length} endpoint(s) in the contract are staff-only (${staffOnly.slice(0, 3).map((e) => `${e.method.toUpperCase()} ${e.path}`).join(", ")}), but no staff account is seeded — add backend/src/db/seedStaff.ts, called at startup, that creates one staff account only when none exists (email and password from STAFF_EMAIL / STAFF_PASSWORD, a generated password logged once when unset)`];
}

// 2026-10-25 (brewline2): order_items referenced menu_items with ON DELETE CASCADE, so deleting a menu item (an endpoint of the
// contract) deleted the order lines of every past order; and order_items kept no price, so changing a price changed old orders.
// A "line table" (a table with an order/invoice/booking/purchase/sale parent column and a reference to a catalog row) must not
// cascade from the catalog row and must keep the price it was sold at. A table that a later ALTER TABLE touches is not judged.
const PARENT_COLUMN = /^\s*"?(order|invoice|booking|purchase|sale)_id"?\s/i;

export function historyIntegrityFindings(projectDir: string): string[] {
  const dir = join(projectDir, "db", "migrations");
  let sql = "";
  try {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) sql += readFileSync(join(dir, f), "utf-8") + "\n";
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
    const table = m[1]!;
    const columns = m[2]!.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!columns.some((c) => PARENT_COLUMN.test(c))) continue;
    if (!columns.some((c) => /^\s*"?\w+_id"?\s[^,]*REFERENCES/i.test(c) && !PARENT_COLUMN.test(c))) continue;
    if (new RegExp(`ALTER\\s+TABLE\\s+"?${table}"?`, "i").test(sql)) continue;
    for (const c of columns) {
      if (/REFERENCES[^,]*ON\s+DELETE\s+CASCADE/i.test(c) && !PARENT_COLUMN.test(c)) {
        const col = c.match(/^"?(\w+)"?/)?.[1] ?? "?";
        out.push(`db/migrations: ${table}.${col} is ON DELETE CASCADE from the row it points at, so deleting that row (a menu item, a product) deletes the ${table} lines of every past order. History must survive: use ON DELETE RESTRICT (or keep the line with the name and price copied into it)`);
      }
    }
    if (!columns.some((c) => /price|amount/i.test(c.split(/\s/)[0] ?? ""))) {
      out.push(`db/migrations: ${table} keeps no price (no price or amount column), so changing the price of an item changes what every past order shows. Copy the unit price (and name) into the line when the order is placed`);
    }
  }
  return out;
}

// 2026-10-25 (brewline3): the cascade half of the history rule is fixed by the system, not asked of the backend builder.
// db/migrations belongs to the database builder and the backend builder cannot write it, so a finish check that demanded the
// change deadlocked the build. A line table's reference to its catalog row becomes ON DELETE RESTRICT (the reference to its own
// parent order keeps its cascade). Returns one line per changed column; a missing price column is left to the reviewers and the
// Chief AI check (INT1/INT2), which can hand it to the database builder.
export function keepHistoryInMigrations(projectDir: string): string[] {
  const dir = join(projectDir, "db", "migrations");
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
  } catch {
    return [];
  }
  const sqlOf = (n: string) => readFileSync(join(dir, n), "utf-8");
  const all = names.map(sqlOf).join("\n");
  const changed: string[] = [];
  for (const name of names) {
    const original = sqlOf(name);
    const rewritten = original.replace(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi, (whole, table: string, body: string) => {
      const lines = body.split("\n");
      const columns = lines.map((l) => l.trim()).filter(Boolean);
      if (!columns.some((c) => PARENT_COLUMN.test(c))) return whole;
      if (!columns.some((c) => /^\s*"?\w+_id"?\s[^,]*REFERENCES/i.test(c) && !PARENT_COLUMN.test(c))) return whole;
      if (new RegExp(`ALTER\\s+TABLE\\s+"?${table}"?`, "i").test(all)) return whole;
      const fixed = lines.map((line) => {
        if (PARENT_COLUMN.test(line) || !/REFERENCES[^,]*ON\s+DELETE\s+CASCADE/i.test(line)) return line;
        const col = line.trim().match(/^"?(\w+)"?/)?.[1] ?? "?";
        changed.push(`db/migrations/${name}: ${table}.${col} ON DELETE CASCADE -> ON DELETE RESTRICT`);
        return line.replace(/ON\s+DELETE\s+CASCADE/i, "ON DELETE RESTRICT");
      });
      return whole.replace(body, fixed.join("\n"));
    });
    if (rewritten !== original) writeFileSync(join(dir, name), rewritten, "utf-8");
  }
  return changed;
}
