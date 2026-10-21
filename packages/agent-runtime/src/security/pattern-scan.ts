// A pattern database for the security checker (patent claim 8).
//
// Two kinds of entries, both stored (packages/db security_patterns / security_advisories) and both usable with no database
// from the built-in seed lists below:
//   - source patterns: a regular expression for a risky way of writing code, tied to its OWASP Top 10 (2021) category and
//     CWE number, with a severity and the usual fix;
//   - advisories: a published vulnerability in a package version range (CVE or GitHub advisory id, the range, the fixed
//     version), read from the generated app's package.json. `importOsv` turns an entry in the public OSV format into one.
// The scanner reads one file at a time, line by line. It is a first-pass filter that costs nothing and needs no model: it
// finds what looks risky and says exactly where; whether a hit is a real flaw is for the checker (and the person) to judge.
// Comments, test files and dependency folders are skipped, and a line can opt out with `nexsidi-allow <pattern key>`.

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SecurityPattern {
  key: string;
  source: "owasp" | "cwe" | "internal";
  category: string;
  cwe: string;
  severity: Severity;
  /** JavaScript regular expression, matched against one line. */
  pattern: string;
  flags?: string;
  /** Only files whose path matches this regular expression are scanned. */
  pathRegex?: string;
  /** Also try the pattern on this line joined with the next one, for calls written over two lines. */
  crossLine?: boolean;
  description: string;
  remediation: string;
  enabled?: boolean;
}

export interface PatternHit {
  key: string;
  file: string;
  line: number;
  severity: Severity;
  category: string;
  cwe: string;
  remediation: string;
  evidence: string;
}

export interface Advisory {
  id: string;
  ghsa?: string;
  package: string;
  /** Space-separated comparators that must ALL hold, e.g. ">=3.0.0 <3.4.1". */
  range: string;
  fixedIn: string;
  severity: Severity;
  summary: string;
}

export interface DependencyHit {
  file: string;
  package: string;
  version: string;
  advisoryId: string;
  range: string;
  fixedIn: string;
  severity: Severity;
  summary: string;
  dev: boolean;
}

// ── versions ────────────────────────────────────────────────────────────────

function parts(v: string): number[] | null {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.replace(/^[\^~v=<>\s]+/, ""));
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** Negative, zero or positive, comparing major, minor and patch as numbers. Anything unreadable compares as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a) ?? [0, 0, 0];
  const y = parts(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** True when `version` satisfies every comparator in `range` (">=3.0.0 <3.4.1"). */
export function inRange(version: string, range: string): boolean {
  for (const c of range.split(/\s+/).filter(Boolean)) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(c);
    if (!m) return false;
    const cmp = compareVersions(version, m[2]!);
    const ok = { ">=": cmp >= 0, "<=": cmp <= 0, ">": cmp > 0, "<": cmp < 0, "=": cmp === 0, undefined: cmp === 0 }[(m[1] ?? "undefined") as ">="];
    if (!ok) return false;
  }
  return true;
}

// ── source patterns ─────────────────────────────────────────────────────────

const SQL_WORDS = "(?=[^\\n]*?\\b(?:select|insert|update|delete|drop|where|from)\\b)";

export const SEED_PATTERNS: SecurityPattern[] = [
  { key: "sql-string-built", crossLine: true, source: "owasp", category: "A03:2021 Injection", cwe: "CWE-89", severity: "HIGH",
    pattern: `\\b(?:query|execute|raw|unsafe|queryRaw|executeRaw)\\s*\\(\\s*${SQL_WORDS}(?:\`[^\`]*\\$\\{[^\`]*\`(?!\\s*,)|(?:"[^"]*"|'[^']*'|\`[^\`$]*\`)\\s*\\+)`, flags: "i",
    description: "A SQL statement is built by joining text with variables, so request data can change the statement.",
    remediation: "Pass values as query parameters ($1, $2) and never put them into the SQL text." },
  { key: "shell-command-built", crossLine: true, source: "owasp", category: "A03:2021 Injection", cwe: "CWE-78", severity: "HIGH",
    pattern: "(?:(?<![\\w.$])|child_process\\.|cp\\.)(?:exec|execSync)\\s*\\(\\s*(?:`[^`]*\\$\\{|[A-Za-z_$][\\w$.]*\\s*\\+|\"[^\"]*\"\\s*\\+|'[^']*'\\s*\\+|req\\.)",
    description: "A shell command is built from variables, so request data can add commands.",
    remediation: "Use execFile or spawn with an argument list and no shell, and validate the values first." },
  { key: "eval-use", source: "cwe", category: "A03:2021 Injection", cwe: "CWE-95", severity: "HIGH",
    pattern: "(?<![\\w.$])eval\\s*\\(|\\bnew\\s+Function\\s*\\(",
    description: "Text is run as code.", remediation: "Remove eval and Function; parse data with JSON.parse or a real parser." },
  { key: "weak-hash", source: "owasp", category: "A02:2021 Cryptographic Failures", cwe: "CWE-327", severity: "MEDIUM",
    pattern: "createHash\\(\\s*['\"](?:md5|sha1)['\"]\\s*\\)",
    description: "MD5 and SHA-1 are broken for security use.", remediation: "Use SHA-256 or better; hash passwords with bcrypt or argon2." },
  { key: "bcrypt-low-cost", source: "owasp", category: "A02:2021 Cryptographic Failures", cwe: "CWE-916", severity: "MEDIUM",
    pattern: "bcrypt\\w*\\.(?:hash|hashSync)\\s*\\([^,()]+,\\s*[1-9]\\s*\\)",
    description: "The bcrypt cost is below 10, so stolen hashes can be guessed quickly.", remediation: "Use a cost of 10 to 12 or more." },
  { key: "predictable-token", source: "cwe", category: "A02:2021 Cryptographic Failures", cwe: "CWE-338", severity: "MEDIUM",
    pattern: "(?:token|secret|session|password|otp|nonce)\\w*[^\\n]*Math\\.random\\s*\\(|Math\\.random\\s*\\([^\\n]*(?:token|secret|session|otp)", flags: "i",
    description: "Math.random is predictable and must not make tokens or secrets.", remediation: "Use crypto.randomBytes or crypto.randomUUID." },
  { key: "secret-fallback", source: "owasp", category: "A07:2021 Identification and Authentication Failures", cwe: "CWE-798", severity: "HIGH",
    pattern: "(?:SECRET|PASSWORD|API_?KEY|TOKEN|PRIVATE_KEY)\\w*\\s*(?:\\|\\||\\?\\?)\\s*['\"][^'\"]{6,}['\"]", flags: "i",
    description: "A secret falls back to a value written in the code when the environment variable is missing.", remediation: "Fail at start-up if the variable is missing; never ship a default secret." },
  { key: "hardcoded-secret", source: "owasp", category: "A07:2021 Identification and Authentication Failures", cwe: "CWE-798", severity: "HIGH",
    pattern: "(?:secret|password|passwd|api_?key|access_?token|private_?key|client_?secret)\\w*\\s*[:=]\\s*['\"](?!your|change|example|placeholder|xxx|test|dummy|password|secret|<)[A-Za-z0-9_\\-+/=.]{16,}['\"]", flags: "i",
    description: "A secret is written into the code.", remediation: "Read it from an environment variable and keep it out of the repository." },
  { key: "raw-html", source: "owasp", category: "A03:2021 Injection", cwe: "CWE-79", severity: "MEDIUM",
    pattern: "dangerouslySetInnerHTML|\\.innerHTML\\s*=(?!=)|\\bdocument\\.write\\s*\\(",
    description: "HTML is inserted without escaping, so injected script can run in the page.", remediation: "Render text through the framework, or sanitise with a trusted library first." },
  { key: "path-from-request", crossLine: true, source: "owasp", category: "A01:2021 Broken Access Control", cwe: "CWE-22", severity: "HIGH",
    pattern: "(?:sendFile|readFile|readFileSync|createReadStream|unlink|unlinkSync|writeFile|writeFileSync|download)\\s*\\([^\\n]*\\breq\\.(?:params|query|body)",
    description: "A file path comes straight from the request, so '../' can reach other files.", remediation: "Use path.basename or check the resolved path stays inside the allowed folder." },
  { key: "request-url-fetch", crossLine: true, source: "owasp", category: "A10:2021 Server-Side Request Forgery", cwe: "CWE-918", severity: "HIGH",
    pattern: "\\b(?:fetch|axios(?:\\.(?:get|post|put|delete|request))?|got|request)\\s*\\(\\s*req\\.(?:body|query|params)",
    description: "The server fetches a URL chosen by the caller, so it can be pointed at internal services.", remediation: "Allow only a fixed list of hosts and block private addresses." },
  { key: "open-redirect", source: "owasp", category: "A01:2021 Broken Access Control", cwe: "CWE-601", severity: "MEDIUM",
    pattern: "\\bredirect\\s*\\(\\s*(?:\\d+\\s*,\\s*)?req\\.(?:query|body|params)",
    description: "The redirect target comes from the request, so users can be sent to another site.", remediation: "Redirect only to paths on this site, or to a fixed list." },
  { key: "cors-open", source: "owasp", category: "A05:2021 Security Misconfiguration", cwe: "CWE-942", severity: "MEDIUM",
    pattern: "\\bcors\\(\\s*\\)|origin\\s*:\\s*['\"]\\*['\"]",
    description: "Any website may call this API from a browser.", remediation: "Name the allowed origins." },
  { key: "tls-verification-off", source: "owasp", category: "A02:2021 Cryptographic Failures", cwe: "CWE-295", severity: "MEDIUM",
    pattern: "rejectUnauthorized\\s*:\\s*false|NODE_TLS_REJECT_UNAUTHORIZED\\s*=\\s*['\"]?0",
    description: "Certificate checks are switched off.", remediation: "Leave certificate verification on." },
  { key: "jwt-none", source: "owasp", category: "A02:2021 Cryptographic Failures", cwe: "CWE-347", severity: "CRITICAL",
    pattern: "algorithms?\\s*:\\s*\\[[^\\]]*['\"]none['\"]", flags: "i",
    description: "Tokens with no signature are accepted.", remediation: "Allow only the algorithm you sign with (HS256 or RS256)." },
  { key: "cookie-not-httponly", source: "owasp", category: "A05:2021 Security Misconfiguration", cwe: "CWE-1004", severity: "MEDIUM",
    pattern: "httpOnly\\s*:\\s*false",
    description: "Page script can read this cookie.", remediation: "Set httpOnly: true on session cookies." },
  { key: "stack-trace-exposed", source: "owasp", category: "A05:2021 Security Misconfiguration", cwe: "CWE-209", severity: "MEDIUM",
    pattern: "\\b(?:res|reply)\\b[^\\n]*\\b(?:err|error|e)\\.stack",
    description: "A stack trace is sent to the caller.", remediation: "Log the trace; send a short message." },
  { key: "mass-assignment", source: "owasp", category: "A04:2021 Insecure Design", cwe: "CWE-915", severity: "MEDIUM",
    pattern: "\\.(?:update|insert|create|set|values)\\s*\\(\\s*req\\.body\\s*\\)",
    description: "The whole request body is written to the database, so callers can set fields they should not (role, owner).", remediation: "Pick the allowed fields by name." },
  { key: "prototype-pollution", source: "cwe", category: "A08:2021 Software and Data Integrity Failures", cwe: "CWE-1321", severity: "MEDIUM",
    pattern: "(?:_\\.)?(?:merge|defaultsDeep|mergeWith)\\s*\\([^\\n]*req\\.(?:body|query|params)",
    description: "Request data is deep-merged into an object, which can change what every object inherits.", remediation: "Copy only known fields, or use a merge that ignores __proto__." },
  { key: "log-secret", source: "owasp", category: "A09:2021 Security Logging and Monitoring Failures", cwe: "CWE-532", severity: "LOW",
    pattern: "console\\.(?:log|info|debug)\\([^\\n]*\\b(?:password|token|secret|authorization)\\b", flags: "i",
    description: "A secret may be written to the logs.", remediation: "Log an identifier, never the value." },
];

const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
// vendor: library code copied into the app (the UI kit), not written by the generators. test-*: throwaway test scripts.
const SKIP_PATH = /(^|\/)(node_modules|\.next|dist|\.git|\.nexsidi|vendor)(\/|$)|\.(?:test|spec)\.[a-z]+$|(^|\/)__tests__\/|(^|\/)test[-_][^/]*$/;

/** Scans one source file against the patterns. Returns the hits in line order. */
export function scanSource(file: string, source: string, patterns: SecurityPattern[]): PatternHit[] {
  const path = file.split("\\").join("/");
  if (!CODE_FILE.test(path) || SKIP_PATH.test(path)) return [];
  const active = patterns
    .filter((p) => p.enabled !== false && (!p.pathRegex || new RegExp(p.pathRegex).test(path)))
    .map((p) => ({ p, re: new RegExp(p.pattern, p.flags ?? "") }));
  const hits: PatternHit[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const marker = /nexsidi-allow\s+([\w-]+)/.exec(line) ?? (i > 0 ? /nexsidi-allow\s+([\w-]+)/.exec(lines[i - 1]!) : null);
    for (const { p, re } of active) {
      if (marker && marker[1] === p.key) continue;
      if (re.test(line)) {
        hits.push({ key: p.key, file: path, line: i + 1, severity: p.severity, category: p.category, cwe: p.cwe, remediation: p.remediation, evidence: trimmed.slice(0, 200) });
      } else if (p.crossLine && i + 1 < lines.length) {
        // A call written over two lines: the call on this line, its text on the next. Reported where the call starts.
        const joined = `${trimmed} ${lines[i + 1]!.trim()}`;
        if (/[(,]\s*$/.test(trimmed) && re.test(joined)) {
          hits.push({ key: p.key, file: path, line: i + 1, severity: p.severity, category: p.category, cwe: p.cwe, remediation: p.remediation, evidence: joined.slice(0, 200) });
        }
      }
    }
  }
  return hits;
}

// ── advisories ──────────────────────────────────────────────────────────────

// Entered by hand from the public advisories. Check an id on osv.dev before relying on it; the live source is importOsv.
export const SEED_ADVISORIES: Advisory[] = [
  { id: "CVE-2021-23337", package: "lodash", range: "<4.17.21", fixedIn: "4.17.21", severity: "HIGH", summary: "Command injection through the template function" },
  { id: "CVE-2021-44906", package: "minimist", range: "<1.2.6", fixedIn: "1.2.6", severity: "CRITICAL", summary: "Prototype pollution" },
  { id: "CVE-2024-29041", package: "express", range: "<4.19.2", fixedIn: "4.19.2", severity: "MEDIUM", summary: "Open redirect through malformed URLs" },
  { id: "CVE-2024-43796", package: "express", range: "<4.20.0", fixedIn: "4.20.0", severity: "LOW", summary: "Cross-site scripting through res.redirect" },
  { id: "CVE-2022-23539", package: "jsonwebtoken", range: "<9.0.0", fixedIn: "9.0.0", severity: "HIGH", summary: "Unrestricted key types allow legacy keys to be used" },
  { id: "CVE-2022-23540", package: "jsonwebtoken", range: "<9.0.0", fixedIn: "9.0.0", severity: "MEDIUM", summary: "Signature checks can be bypassed because of an insecure default algorithm" },
  { id: "CVE-2022-23541", package: "jsonwebtoken", range: "<9.0.0", fixedIn: "9.0.0", severity: "MEDIUM", summary: "A key-lookup function can allow forged tokens (RSA to HMAC)" },
  { id: "CVE-2023-45857", package: "axios", range: ">=0.8.1 <0.28.0", fixedIn: "0.28.0", severity: "HIGH", summary: "The anti-forgery token is sent to other sites" },
  { id: "CVE-2023-45857", package: "axios", range: ">=1.0.0 <1.6.0", fixedIn: "1.6.0", severity: "HIGH", summary: "The anti-forgery token is sent to other sites" },
  { id: "CVE-2025-29927", package: "next", range: ">=11.1.4 <12.3.5", fixedIn: "12.3.5", severity: "CRITICAL", summary: "Middleware checks can be skipped with a crafted header" },
  { id: "CVE-2025-29927", package: "next", range: ">=13.0.0 <13.5.9", fixedIn: "13.5.9", severity: "CRITICAL", summary: "Middleware checks can be skipped with a crafted header" },
  { id: "CVE-2025-29927", package: "next", range: ">=14.0.0 <14.2.25", fixedIn: "14.2.25", severity: "CRITICAL", summary: "Middleware checks can be skipped with a crafted header" },
  { id: "CVE-2025-29927", package: "next", range: ">=15.0.0 <15.2.3", fixedIn: "15.2.3", severity: "CRITICAL", summary: "Middleware checks can be skipped with a crafted header" },
  { id: "CVE-2024-45590", package: "body-parser", range: "<1.20.3", fixedIn: "1.20.3", severity: "HIGH", summary: "Denial of service with a crafted request" },
  { id: "CVE-2024-47764", package: "cookie", range: "<0.7.0", fixedIn: "0.7.0", severity: "LOW", summary: "Cookie names and values can carry out-of-bounds characters" },
  { id: "CVE-2024-37890", package: "ws", range: ">=8.0.0 <8.17.1", fixedIn: "8.17.1", severity: "HIGH", summary: "Denial of service with many headers" },
  { id: "CVE-2022-0235", package: "node-fetch", range: "<2.6.7", fixedIn: "2.6.7", severity: "HIGH", summary: "Sensitive headers are forwarded on redirects" },
  { id: "CVE-2022-31129", package: "moment", range: ">=2.18.0 <2.29.4", fixedIn: "2.29.4", severity: "HIGH", summary: "Slow parsing of crafted date strings" },
  { id: "CVE-2022-25883", package: "semver", range: "<5.7.2", fixedIn: "5.7.2", severity: "MEDIUM", summary: "Slow matching of crafted version strings" },
  { id: "CVE-2022-25883", package: "semver", range: ">=7.0.0 <7.5.2", fixedIn: "7.5.2", severity: "MEDIUM", summary: "Slow matching of crafted version strings" },
];

const ADVISORY_SEVERITY: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** Reads package.json text and lists each dependency whose version falls in an advisory's range. Unreadable input gives []. */
export function scanDependencies(file: string, packageJson: string, advisories: Advisory[], installed: Record<string, string> = {}): DependencyHit[] {
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    return [];
  }
  const out: DependencyHit[] = [];
  for (const [section, dev] of [["dependencies", false], ["devDependencies", true]] as const) {
    for (const [name, spec] of Object.entries(pkg?.[section] ?? {})) {
      if (typeof spec !== "string" || !parts(spec)) continue;
      // The version actually installed (from node_modules) beats the range written in package.json.
      const version = installed[name] ?? spec;
      for (const a of advisories) {
        if (a.package === name && inRange(version, a.range)) {
          out.push({ file, package: name, version, advisoryId: a.id, range: a.range, fixedIn: a.fixedIn, severity: a.severity, summary: a.summary, dev });
        }
      }
    }
  }
  return out;
}

interface OsvEntry {
  id: string;
  aliases?: string[];
  summary?: string;
  database_specific?: { severity?: string };
  affected?: Array<{ package?: { ecosystem?: string; name?: string }; ranges?: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }> }> }>;
}

/** Turns an entry in the public OSV format into advisories (npm packages only). */
export function importOsv(entry: OsvEntry): Advisory[] {
  const cve = entry.aliases?.find((a) => a.startsWith("CVE-"));
  const sev = String(entry.database_specific?.severity ?? "").toUpperCase();
  const severity = (ADVISORY_SEVERITY as string[]).includes(sev) ? (sev as Severity) : sev === "MODERATE" ? "MEDIUM" : "MEDIUM";
  const out: Advisory[] = [];
  for (const aff of entry.affected ?? []) {
    if (aff.package?.ecosystem !== "npm" || !aff.package.name) continue;
    for (const range of aff.ranges ?? []) {
      let from: string | null = null;
      for (const ev of range.events ?? []) {
        if (ev.introduced !== undefined) from = ev.introduced === "0" ? null : ev.introduced;
        else if (ev.fixed !== undefined) {
          const lower = from ? `>=${from} ` : "";
          out.push({ id: cve ?? entry.id, ...(cve && entry.id.startsWith("GHSA-") ? { ghsa: entry.id } : {}), package: aff.package.name, range: `${lower}<${ev.fixed}`, fixedIn: ev.fixed!, severity, summary: entry.summary ?? "" });
          from = null;
        }
      }
    }
  }
  return out;
}
