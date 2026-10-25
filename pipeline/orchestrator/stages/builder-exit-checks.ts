// The frontend builder's own checks before it may say "done" (2026-10-24, docs/root-cause/2026-10-24-brewline.md).
// On Brewline 8 emoji findings and the missing-colour findings were raised in review, after the builder had finished: its
// instructions said "no emoji" and the checks existed, but they ran only in the review stage. The same checks now run,
// by the system, when the builder calls task_complete (last phase and fix rounds), and what they find is handed back to
// it first. Pure file reads; no model call.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";
import { scanProjectForEmojiUi } from "./emoji-ui-check.ts";
import { scanProjectForDeadButtons } from "./dead-ui-check.ts";
import { specColours } from "../../../agents/vanya/src/index.ts";
import { contractRouteFindings, type ContractEndpoint } from "./contract-route-check.ts";

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
