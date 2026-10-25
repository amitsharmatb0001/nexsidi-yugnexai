// Checks for things a builder can find by reading its own files before it says "done" (2026-10-25, brewline3). The reviewers kept
// raising them one or two per round, each round a paid fix and a deploy: the whole spec pasted into the page description, a staff
// password written to the console, a test compose file with weak secrets left in the backend folder, a `secure` cookie that is
// dropped over http. No model call; each returns lines a builder must fix before the system lets it finish.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage"]);

function filesUnder(dir: string, accept: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
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
        if (statSync(full).isDirectory()) walk(full);
        else if (accept(n)) out.push(full);
      } catch {
        // unreadable: skipped
      }
    }
  };
  walk(dir);
  return out;
}

const rel = (projectDir: string, full: string): string => full.slice(projectDir.length + 1).split("\\").join("/");
const SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/i;
const NOT_TEST = (n: string) => SOURCE.test(n) && !/\.(test|spec)\./i.test(n);

const readSpecDescription = (projectDir: string): string => {
  try {
    return String((JSON.parse(readFileSync(join(projectDir, "spec.json"), "utf-8")) as { description?: string }).description ?? "");
  } catch {
    return "";
  }
};

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** True when `text` repeats a run of `run` consecutive words of `source`. */
function sharesRun(text: string, source: string, run: number): boolean {
  const t = words(text);
  const s = ` ${words(source).join(" ")} `;
  for (let i = 0; i + run <= t.length; i++) if (s.includes(` ${t.slice(i, i + run).join(" ")} `)) return true;
  return false;
}

const DESCRIPTION = /\bdescription\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** A page title or description that is the internal brief, or runs on for paragraphs, shows the spec to every visitor and search engine. */
export function metadataLeakFindings(projectDir: string): string[] {
  const spec = readSpecDescription(projectDir);
  const out: string[] = [];
  for (const full of filesUnder(join(projectDir, "frontend", "app"), (n) => /^(layout|page)\.(tsx|jsx|ts|js)$/.test(n))) {
    let text = "";
    try {
      text = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    if (!/\bmetadata\b/.test(text)) continue;
    for (const m of text.matchAll(DESCRIPTION)) {
      const desc = m[2] ?? "";
      if (desc.length > 200 || (spec && words(desc).length >= 8 && sharesRun(desc, spec, 8))) {
        out.push(`${rel(projectDir, full)}: the page description (metadata) is ${desc.length > 200 ? `${desc.length} characters long and ` : ""}copied from the internal brief — every visitor and search engine sees it. Write one short sentence a customer would read (under 160 characters) about what the site offers`);
      }
    }
  }
  return out;
}

/** `secure` on a cookie the browser code sets makes the browser drop it over http (every local run), so sign-in never sticks. */
export function cookieSecureFindings(projectDir: string): string[] {
  const out: string[] = [];
  for (const full of filesUnder(join(projectDir, "frontend"), NOT_TEST)) {
    let text = "";
    try {
      text = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (/document\.cookie\s*=/.test(line) && /;\s*secure\b/i.test(line) && !/protocol|https/i.test(line)) {
        out.push(`${rel(projectDir, full)}:${i + 1}: the cookie is set with the secure flag, which the browser drops over http (every local run), so the user is never signed in — leave it off, or set it only when location.protocol is https:`);
      }
    });
  }
  return out;
}

// A log call that prints a password, secret or token value (an interpolation, an argument or a concatenation), not one that only mentions the word.
const SECRET_NAME = String.raw`(?:password|passwd|secret|token|api[_-]?key)`;
const LOGS_SECRET = new RegExp(
  String.raw`console\.\w+\(.*(?:\$\{[^}]*\b${SECRET_NAME}\b[^}]*\}|,\s*${SECRET_NAME}\s*[,)]|\+\s*${SECRET_NAME}\b|${SECRET_NAME}\s*\+)`,
  "i",
);

/** The only place a generated password may appear is the owner's one-time login file, never a log that ends up in server logs. */
export function secretLoggingFindings(projectDir: string): string[] {
  const out: string[] = [];
  for (const sub of ["backend/src", "frontend"]) {
    for (const full of filesUnder(join(projectDir, sub), NOT_TEST)) {
      let text = "";
      try {
        text = readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      text.split("\n").forEach((line, i) => {
        if (LOGS_SECRET.test(line)) {
          out.push(`${rel(projectDir, full)}:${i + 1}: a password, secret or token value is written to a log — log that it was created, never the value (the owner's login goes only in the one-time login file)`);
        }
      });
    }
  }
  return out;
}

/** The project root's compose file is the only one that ships; one left inside backend/ or frontend/ is a test file with weak secrets. */
export function strayShippedFileFindings(projectDir: string): string[] {
  const out: string[] = [];
  for (const sub of ["backend", "frontend"]) {
    const base = join(projectDir, sub);
    if (!existsSync(base)) continue;
    for (const full of filesUnder(base, (n) => /^docker-compose.*\.ya?ml$/i.test(n) || n === ".env" || /^\.env\.(production|development|test)$/i.test(n))) {
      let text = "";
      try {
        text = readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const isCompose = /docker-compose/i.test(full);
      if (isCompose || /(password|secret|key|token)\s*[=:]/i.test(text)) {
        out.push(`${rel(projectDir, full)}: ${isCompose ? "a compose file inside the source folder (only the project root's docker-compose.yml ships) with test secrets in it" : "an environment file with secret values inside the source folder"} — delete it before finishing; keep values in .env.example with placeholders only`);
      }
    }
  }
  return out;
}
