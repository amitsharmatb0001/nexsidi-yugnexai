import { test, expect } from "bun:test";
import { compareVersions, inRange, scanSource, scanDependencies, importOsv, SEED_PATTERNS, SEED_ADVISORIES, type SecurityPattern } from "./pattern-scan.ts";

// Patent claim 8: the security agent consults a pattern database built from OWASP/CWE categories and published
// vulnerability entries, and applies it to the generated code and its dependencies.

const byKey = (key: string): SecurityPattern => SEED_PATTERNS.find((p) => p.key === key)!;
const hits = (file: string, code: string) => scanSource(file, code, SEED_PATTERNS).map((h) => h.key);

test("versions compare numerically, not as text, and ignore a leading ^ ~ or v", () => {
  expect(compareVersions("4.17.9", "4.17.21")).toBeLessThan(0);
  expect(compareVersions("10.0.0", "9.9.9")).toBeGreaterThan(0);
  expect(compareVersions("^4.18.2", "4.18.2")).toBe(0);
  expect(compareVersions("v1.2", "1.2.0")).toBe(0);
});

test("a range like '<4.19.2' or '>=3.0.0 <3.4.1' says whether a version is affected", () => {
  expect(inRange("4.18.2", "<4.19.2")).toBe(true);
  expect(inRange("4.19.2", "<4.19.2")).toBe(false);
  expect(inRange("3.2.0", ">=3.0.0 <3.4.1")).toBe(true);
  expect(inRange("2.9.9", ">=3.0.0 <3.4.1")).toBe(false);
  expect(inRange("3.4.1", ">=3.0.0 <3.4.1")).toBe(false);
});

test("every seeded pattern names its OWASP category and CWE, and has a severity, a real regular expression and a fix", () => {
  expect(SEED_PATTERNS.length).toBeGreaterThanOrEqual(20);
  for (const p of SEED_PATTERNS) {
    expect(p.category).toMatch(/^A\d{2}:2021/);
    expect(p.cwe).toMatch(/^CWE-\d+$/);
    expect(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).toContain(p.severity);
    expect(() => new RegExp(p.pattern, p.flags ?? "")).not.toThrow();
    expect(p.remediation.length).toBeGreaterThan(10);
  }
  expect(new Set(SEED_PATTERNS.map((p) => p.key)).size).toBe(SEED_PATTERNS.length);
});

test("SQL built by joining text with request data is found, with the line number", () => {
  const code = `const a = 1;\nawait db.query("SELECT * FROM users WHERE id = " + req.params.id);\n`;
  const h = scanSource("backend/src/routes/users.ts", code, SEED_PATTERNS).find((x) => x.key === "sql-string-built")!;
  expect(h.line).toBe(2);
  expect(h.cwe).toBe("CWE-89");
  expect(h.evidence).toContain("SELECT * FROM users");
  expect(hits("a.ts", "await db.query(`SELECT * FROM t WHERE id = ${id}`);")).toContain("sql-string-built");
});

test("parameterised queries are not flagged", () => {
  expect(hits("a.ts", 'await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);')).not.toContain("sql-string-built");
});

test("shell commands built from variables, eval and Function are found", () => {
  expect(hits("a.ts", "exec(`convert ${req.body.name}.png`);")).toContain("shell-command-built");
  expect(hits("a.ts", "const r = eval(userInput);")).toContain("eval-use");
  expect(hits("a.ts", "const f = new Function('a', body);")).toContain("eval-use");
});

test("weak password hashing, low bcrypt cost and predictable tokens are found", () => {
  expect(hits("a.ts", "crypto.createHash('md5').update(pw).digest('hex')")).toContain("weak-hash");
  expect(hits("a.ts", "await bcrypt.hash(password, 4);")).toContain("bcrypt-low-cost");
  expect(hits("a.ts", "await bcrypt.hash(password, 12);")).not.toContain("bcrypt-low-cost");
  expect(hits("a.ts", "const sessionToken = Math.random().toString(36);")).toContain("predictable-token");
  expect(hits("a.ts", "const x = Math.random() * 10;")).not.toContain("predictable-token");
});

test("secrets written into the code are found, but environment reads and placeholders are not", () => {
  expect(hits("a.ts", 'const jwtSecret = process.env.JWT_SECRET || "changeme-secret-value";')).toContain("secret-fallback");
  expect(hits("a.ts", 'const apiKey = "demo_key_0123456789abcdefghij";')).toContain("hardcoded-secret");
  expect(hits("a.ts", "const apiKey = process.env.API_KEY;")).not.toContain("hardcoded-secret");
  expect(hits("a.ts", 'const password = "your-password-here";')).not.toContain("hardcoded-secret");
});

test("browser-side injection: raw HTML insertion is found", () => {
  expect(hits("page.tsx", "<div dangerouslySetInnerHTML={{ __html: post.body }} />")).toContain("raw-html");
  expect(hits("a.ts", "el.innerHTML = value;")).toContain("raw-html");
});

test("file, URL and redirect targets taken straight from the request are found", () => {
  expect(hits("a.ts", "res.sendFile(path.join(dir, req.params.name));")).toContain("path-from-request");
  expect(hits("a.ts", "const r = await fetch(req.body.url);")).toContain("request-url-fetch");
  expect(hits("a.ts", "res.redirect(req.query.next);")).toContain("open-redirect");
});

test("open cross-origin access, disabled certificate checks and a 'none' token algorithm are found", () => {
  expect(hits("a.ts", "app.use(cors());")).toContain("cors-open");
  expect(hits("a.ts", "cors({ origin: '*', credentials: true })")).toContain("cors-open");
  expect(hits("a.ts", "https.request({ rejectUnauthorized: false })")).toContain("tls-verification-off");
  expect(hits("a.ts", "jwt.verify(t, s, { algorithms: ['none'] })")).toContain("jwt-none");
});

test("comments, test files and an explicit allow marker are not reported", () => {
  expect(hits("a.ts", "// eval(userInput) would be bad")).toEqual([]);
  expect(hits("backend/src/a.test.ts", "eval(userInput)")).toEqual([]);
  expect(hits("a.ts", "eval(code); // nexsidi-allow eval-use")).toEqual([]);
  expect(hits("node_modules/x/index.js", "eval(code)")).toEqual([]);
});

test("a pattern limited to some paths is only applied there", () => {
  const onlyBackend: SecurityPattern = { ...byKey("eval-use"), key: "t", pathRegex: "^backend/" };
  expect(scanSource("frontend/a.ts", "eval(x)", [onlyBackend])).toEqual([]);
  expect(scanSource("backend/a.ts", "eval(x)", [onlyBackend]).length).toBe(1);
});

test("a pattern turned off is ignored", () => {
  expect(scanSource("a.ts", "eval(x)", [{ ...byKey("eval-use"), enabled: false }])).toEqual([]);
});

test("a vulnerable package version in package.json is reported with its advisory id", () => {
  const pkg = JSON.stringify({ dependencies: { lodash: "^4.17.15", express: "4.21.0" }, devDependencies: { minimist: "1.2.0" } });
  const r = scanDependencies("backend/package.json", pkg, SEED_ADVISORIES);
  const names = r.map((x) => x.package).sort();
  expect(names).toContain("lodash");
  expect(names).toContain("minimist");
  expect(names).not.toContain("express");
  const lodash = r.find((x) => x.package === "lodash")!;
  expect(lodash.advisoryId).toMatch(/^(CVE|GHSA)-/);
  expect(lodash.fixedIn).toBeTruthy();
});

test("a fixed or newer version is not reported, and a missing or broken package.json is not an error", () => {
  expect(scanDependencies("p.json", JSON.stringify({ dependencies: { lodash: "4.17.21" } }), SEED_ADVISORIES)).toEqual([]);
  expect(scanDependencies("p.json", "not json", SEED_ADVISORIES)).toEqual([]);
  expect(scanDependencies("p.json", "{}", SEED_ADVISORIES)).toEqual([]);
});

test("entries in the public OSV format become advisories: package, affected range from the introduced/fixed events, id and severity", () => {
  const osv = {
    id: "GHSA-test-1234",
    aliases: ["CVE-2099-0001"],
    summary: "Test flaw",
    database_specific: { severity: "HIGH" },
    affected: [{ package: { ecosystem: "npm", name: "left-pad" }, ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "1.3.1" }] }] }],
  };
  const adv = importOsv(osv);
  expect(adv).toEqual([{ id: "CVE-2099-0001", ghsa: "GHSA-test-1234", package: "left-pad", range: ">=1.0.0 <1.3.1", fixedIn: "1.3.1", severity: "HIGH", summary: "Test flaw" }]);
  expect(importOsv({ id: "x", affected: [{ package: { ecosystem: "PyPI", name: "django" }, ranges: [] }] })).toEqual([]);
});

// Found by running the scanner over 80 real generated apps.
test("vendored library code and throwaway test scripts are not scanned", () => {
  expect(hits("frontend/vendor/nexui/src/primitives/avatar.ts", "this.shadowRoot.innerHTML = `<div></div>`;")).toEqual([]);
  expect(hits("backend/src/test-db.ts", 'const password = "securepassword123456";')).toEqual([]);
});

test("a query that interpolates a fragment but passes its values as parameters is not reported as built SQL", () => {
  expect(hits("a.ts", "const r = await pool.query(`SELECT COUNT(*) FROM tasks ${whereClause}`, countValues);")).not.toContain("sql-string-built");
  expect(hits("a.ts", "const r = await pool.query(`SELECT * FROM tasks WHERE id = ${id}`);")).toContain("sql-string-built");
});

test("a conditional certificate bypass is a medium finding, not high", () => {
  const h = scanSource("a.ts", "ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,", SEED_PATTERNS).find((x) => x.key === "tls-verification-off")!;
  expect(h.severity).toBe("MEDIUM");
});

test("the installed version, when known, is used instead of the range written in package.json", () => {
  const pkg = JSON.stringify({ dependencies: { next: "^15.1.0" } });
  expect(scanDependencies("p.json", pkg, SEED_ADVISORIES).map((h) => h.advisoryId)).toContain("CVE-2025-29927"); // the range alone allows 15.1.0
  expect(scanDependencies("p.json", pkg, SEED_ADVISORIES, { next: "15.5.2" })).toEqual([]);
  expect(scanDependencies("p.json", pkg, SEED_ADVISORIES, { next: "15.1.4" }).map((h) => h.version)).toEqual(["15.1.4"]);
});

test("the jsonwebtoken advisories carry the ids the public database uses", () => {
  const ids = SEED_ADVISORIES.filter((a) => a.package === "jsonwebtoken").map((a) => a.id).sort();
  expect(ids).toEqual(["CVE-2022-23539", "CVE-2022-23540", "CVE-2022-23541"]);
});

// Found by planting SQL defects in 105 real files (training run): 8 of 40 were missed because the call and its text were on different lines.
test("a query whose text starts on the next line is still found, and reported on the line where the text is", () => {
  const code = "const result = await pool.query(\n  `SELECT id FROM users WHERE id = ` + req.userId\n);\n";
  const h = scanSource("a.ts", code, SEED_PATTERNS).filter((x) => x.key === "sql-string-built");
  expect(h.length).toBe(1);
  expect(h[0]!.line).toBe(1);
  const safe = "const result = await pool.query(\n  `SELECT id FROM users WHERE id = $1`,\n  [id]\n);\n";
  expect(scanSource("a.ts", safe, SEED_PATTERNS).filter((x) => x.key === "sql-string-built")).toEqual([]);
});

test("a line that matches on its own is reported once, not again by the two-line check", () => {
  const code = 'await db.query("SELECT * FROM t WHERE id = " + id);\nconst x = 1;\n';
  expect(scanSource("a.ts", code, SEED_PATTERNS).filter((x) => x.key === "sql-string-built").length).toBe(1);
});
