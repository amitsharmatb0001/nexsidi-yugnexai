import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ── Published ports of generated apps (2026-09-26 security fix) ─────────────
//
// Real exposure found live: generated docker-compose.yml files published
// ports as "HOST:CONTAINER" with no host IP, so Docker bound them on 0.0.0.0
// and [::]. Every generated app's Postgres, backend and frontend answered on
// the PC's LAN IP, and Windows Firewall did not stop other devices (Wi-Fi on
// the Public profile, with Docker Desktop's own inbound Allow rule for it).
// A generated app is delivered to ONE user on THIS machine, so every
// published port is bound to 127.0.0.1.
//
// This module is the single owner of the published-port format. Before it
// existed, the same "HOST:CONTAINER" regex lived in two places
// (getRunningDeploymentPorts, parseComposePorts), so a format change would
// silently break both: "open app" and clone health checks would report
// running apps as down, and clones would fail to read their source's ports.
//
// Only the short syntax is understood: - "[IP:]HOST:CONTAINER[/tcp|/udp]",
// quoted with " or ' or unquoted. Anything else under a ports: key (ranges,
// container-only "3000", long syntax, an explicit non-loopback IP, inline
// ports: [...]) is reported as unsupported so the caller can refuse to start
// it (deny by default) instead of publishing it on every interface.

const PORT_ENTRY = /^(\s*-\s*)(["']?)(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d{1,5}):(\d{1,5})(\/(?:tcp|udp))?\2\s*$/;

function serviceBlock(compose: string, service: string): string | null {
  const text = compose.replace(/\r\n/g, "\n");
  // Bounded by the next line with EXACTLY 2 spaces + a non-space char (the
  // next top-level service key), NOT "the next line with 2+ leading spaces",
  // which would match this service's own nested keys and cut the block
  // before its ports ever appear.
  const m = text.match(new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n {2}\\S|$)`));
  return m?.[1] ?? null;
}

/** Host port of the first published port in `service`'s block, or null. Accepts every IP-prefixed and plain form. */
export function parseServiceHostPort(compose: string, service: string): number | null {
  const block = serviceBlock(compose, service);
  if (!block) return null;
  for (const line of block.split("\n")) {
    const m = line.match(PORT_ENTRY);
    if (m) return Number(m[4]);
  }
  return null;
}

export interface LoopbackBindResult {
  content: string;
  changed: number;
  unsupported: string[];
}

/** Rewrites every plain or 0.0.0.0 published port to "127.0.0.1:HOST:CONTAINER". Idempotent; keeps indentation and line endings. */
export function bindComposePortsToLoopback(compose: string): LoopbackBindResult {
  const eol = compose.includes("\r\n") ? "\r\n" : "\n";
  const lines = compose.split(/\r?\n/);
  let changed = 0;
  const unsupported: string[] = [];
  let portsIndent = -1; // indent of the active "ports:" key, -1 when outside one

  const out = lines.map((line) => {
    const indent = line.search(/\S/);
    if (/^\s*ports:\s*\[.*$/.test(line)) {
      unsupported.push(line.trim());
      portsIndent = -1;
      return line;
    }
    if (/^\s*ports:\s*$/.test(line)) {
      portsIndent = indent;
      return line;
    }
    if (portsIndent >= 0 && indent !== -1 && indent <= portsIndent) portsIndent = -1;
    if (portsIndent < 0 || indent === -1) return line;
    if (!/^\s*-/.test(line)) return line; // continuation of a long-syntax item, e.g. "published: 8080"

    const m = line.match(PORT_ENTRY);
    const entry = line.replace(/^\s*-\s*/, "").trim();
    if (!m) {
      unsupported.push(entry);
      return line;
    }
    const [, prefix, , ip, host, container, proto = ""] = m;
    if (ip === "127.0.0.1") return line;
    if (ip !== undefined && ip !== "0.0.0.0") {
      unsupported.push(entry);
      return line;
    }
    changed++;
    return `${prefix}"127.0.0.1:${host}:${container}${proto}"`;
  });

  return { content: out.join(eol), changed, unsupported };
}

// ── No auto-start (2026-10-08, Amit) ────────────────────────────────────────
// Generated compose files came back from the deploy agent with `restart: always` / `unless-stopped` (14 of 17 apps on
// this PC), so every app woke up the moment Docker started. The owner starts what they want, by hand. No generated
// compose file may carry a restart policy; `restart: no` (or none) is what Docker does by default.

/** Value of a `restart:` line without trailing comment and quotes, e.g. `"always" # x` -> always. */
function restartValue(raw: string): string {
  return raw.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
}

export interface RestartStripResult {
  content: string;
  removed: number;
}

/** Removes every restart policy except `no`: `restart:` lines and `deploy.restart_policy` blocks. Idempotent; keeps line endings. */
export function removeRestartPolicies(compose: string): RestartStripResult {
  const eol = compose.includes("\r\n") ? "\r\n" : "\n";
  const lines = compose.split(/\r?\n/);
  const out: string[] = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const key = line.match(/^(\s+)restart:\s*(.*)$/);
    if (key) {
      if (restartValue(key[2]!) === "no") out.push(line);
      else removed++;
      continue;
    }
    const block = line.match(/^(\s+)restart_policy:\s*$/);
    if (block) {
      const indent = block[1]!.length;
      while (i + 1 < lines.length && (lines[i + 1]!.trim() === "" || lines[i + 1]!.search(/\S/) > indent)) i++;
      removed++;
      continue;
    }
    out.push(line);
  }
  // A `deploy:` that lost its only child is an empty mapping; drop it so the file stays valid.
  const cleaned: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const line = out[i]!;
    const d = line.match(/^(\s+)deploy:\s*$/);
    if (d) {
      const next = out.slice(i + 1).find((l) => l.trim() !== "");
      if (next === undefined || next.search(/\S/) <= d[1]!.length) continue;
    }
    cleaned.push(line);
  }
  return { content: removed > 0 ? cleaned.join(eol) : compose, removed };
}

export interface ComposeFs {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, content: string): void;
}

const nodeFs: ComposeFs = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf-8"),
  write: (path, content) => writeFileSync(path, content, "utf-8"),
};

// Same lookup order `docker compose` itself uses when no -f is given.
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

export type PrepareComposeResult =
  | { ok: true; file: string | null; changed: number; restartRemoved: number }
  | { ok: false; error: string };

/** Binds the compose file `docker compose up` would use in `cwd` to 127.0.0.1, or refuses when it has ports that can't be bound safely. */
export function prepareComposeForUp(cwd: string, fs: ComposeFs = nodeFs): PrepareComposeResult {
  const file = COMPOSE_FILES.map((name) => join(cwd, name)).find((path) => fs.exists(path)) ?? null;
  if (!file) return { ok: true, file: null, changed: 0, restartRemoved: 0 };

  const result = bindComposePortsToLoopback(fs.read(file));
  if (result.unsupported.length > 0) {
    return {
      ok: false,
      error: `Refusing to publish ports that are not bound to this PC only: ${result.unsupported.join(", ")}. Write every published port as "127.0.0.1:<host>:<container>".`,
    };
  }
  // No restart policy, ever: nothing may start by itself when Docker starts.
  const stripped = removeRestartPolicies(result.content);
  const waiting = composeWaitsForDatabase(stripped.content);
  if (result.changed > 0 || stripped.removed > 0 || waiting !== stripped.content) fs.write(file, waiting);
  pinFrontendDockerfile(dirname(file), fs);
  return { ok: true, file, changed: result.changed, restartRemoved: stripped.removed };
}

// 2026-09-29 (project a034f90ba50e): tools/db.ts says Stage 6 sets
// TIER3_DB_URL, but nothing ever did — every live review reported "db_query
// unavailable" as a finding and could not check that data really landed.
// The backend's DATABASE_URL names the database by its compose service; the
// review runs on the host, so it gets that service's published loopback port.
export function reviewDbUrl(compose: string): string | null {
  const url = compose.match(/DATABASE_URL["']?\s*[:=]\s*["']?(postgres(?:ql)?:\/\/[^\s"']+)/)?.[1];
  const service = url?.match(/@([^:/@]+)(?::\d+)?\//)?.[1];
  if (!url || !service) return null;
  const hostPort = parseServiceHostPort(compose, service);
  return hostPort === null ? null : url.replace(/@[^:/@]+(?::\d+)?\//, `@127.0.0.1:${hostPort}/`);
}

// 2026-09-29: real bug (project a034f90ba50e), recurring since Sprint 1.
// NEXT_PUBLIC_* values are baked in at `next build`. The launch step writes
// frontend/.env.local with the real backend URL, but an ARG/ENV default in
// the frontend Dockerfile (e.g. the contract's :3001) is process env during the
// build and beats .env.local — the browser called :3001 while the backend
// listened on :3308. Before every `up`, the Dockerfile is pinned to .env.local.
export function pinFrontendApiUrl(dockerfile: string, url: string): string {
  return dockerfile
    .replace(/^ARG\s+NEXT_PUBLIC_API_URL(?:=[^\r\n]*)?$/gm, `ARG NEXT_PUBLIC_API_URL=${url}`)
    .replace(/^ENV\s+NEXT_PUBLIC_API_URL(?:=|\s+)(?!\$)[^\r\n]*$/gm, `ENV NEXT_PUBLIC_API_URL=${url}`);
}

function pinFrontendDockerfile(projectDir: string, fs: ComposeFs): void {
  const envPath = join(projectDir, "frontend", ".env.local");
  const dockerfilePath = join(projectDir, "frontend", "Dockerfile");
  if (!fs.exists(envPath) || !fs.exists(dockerfilePath)) return;
  const url = fs.read(envPath).match(/^NEXT_PUBLIC_API_URL=(\S+)\s*$/m)?.[1];
  if (!url) return;
  const current = fs.read(dockerfilePath);
  const pinned = pinFrontendApiUrl(current, url);
  if (pinned !== current) fs.write(dockerfilePath, pinned);
}

// 2026-11-05 (Express Build): the backend started before the database took connections, its seed ran once and failed, and the app was delivered
// with no menu and no staff account. The backend now waits for a healthy database. The check asks over TCP: while Postgres sets itself up it
// answers only on its private socket, so a plain pg_isready says ready too early.
export function composeWaitsForDatabase(compose: string): string {
  const eol = compose.includes("\r\n") ? "\r\n" : "\n";
  const lines = compose.split(/\r?\n/);
  const starts = lines.flatMap((l, i) => (/^ {2}[\w.-]+:\s*$/.test(l) ? [i] : []));
  const blockEnd = (start: number) => {
    const next = lines.findIndex((l, i) => i > start && /^\S|^ {2}\S/.test(l));
    return next < 0 ? lines.length : next;
  };
  const dbStart = starts.find((s) => lines.slice(s, blockEnd(s)).some((l) => /^\s+image:\s*["']?(postgres|pgvector)/.test(l)));
  if (dbStart === undefined) return compose;
  const dbName = lines[dbStart]!.trim().replace(/:$/, "");
  const block = lines.slice(dbStart, blockEnd(dbStart));
  const envValue = (name: string) => block.map((l) => l.match(new RegExp(`${name}["']?\\s*[:=]\\s*["']?([\\w-]+)`))?.[1]).find(Boolean);
  const user = envValue("POSTGRES_USER");
  const database = envValue("POSTGRES_DB");
  const ready = `pg_isready -h 127.0.0.1${user ? ` -U ${user}` : ""}${database ? ` -d ${database}` : ""}`;

  // Depends-on first, from the bottom up, so earlier line numbers stay right.
  for (const s of [...starts].reverse()) {
    if (s === dbStart) continue;
    const end = blockEnd(s);
    const dep = lines.findIndex((l, i) => i > s && i < end && /^ {4}depends_on:\s*$/.test(l));
    if (dep < 0) continue;
    let last = dep + 1;
    while (last < end && /^\s+-\s/.test(lines[last]!)) last++;
    const names = lines.slice(dep + 1, last).map((l) => l.replace(/^\s+-\s*/, "").replace(/["']/g, "").trim());
    if (!names.includes(dbName)) continue;
    lines.splice(dep + 1, last - dep - 1, ...names.flatMap((n) => [`      ${n}:`, `        condition: ${n === dbName ? "service_healthy" : "service_started"}`]));
  }
  const dbEnd = blockEnd(dbStart);
  const check = lines.findIndex((l, i) => i > dbStart && i < dbEnd && /^ {4}healthcheck:\s*$/.test(l));
  if (check >= 0) {
    const test = lines.findIndex((l, i) => i > check && i < dbEnd && /pg_isready/.test(l));
    if (test >= 0 && !/-h\s/.test(lines[test]!)) lines[test] = `      test: ["CMD-SHELL", "${ready}"]`;
  } else {
    const image = lines.findIndex((l, i) => i > dbStart && i < dbEnd && /^\s+image:/.test(l));
    lines.splice(image + 1, 0, "    healthcheck:", `      test: ["CMD-SHELL", "${ready}"]`, "      interval: 2s", "      timeout: 3s", "      retries: 30");
  }
  return lines.join(eol);
}

export function composeWaitsForDatabaseInFile(composePath: string, fs: ComposeFs = nodeFs): void {
  if (!fs.exists(composePath)) return;
  const before = fs.read(composePath);
  const after = composeWaitsForDatabase(before);
  if (after !== before) fs.write(composePath, after);
}

/** Removes restart policies from one compose file on disk (for code paths that run `docker compose -f <file> up` themselves). Returns how many were removed. */
export function stripRestartPoliciesInFile(composePath: string, fs: ComposeFs = nodeFs): number {
  if (!fs.exists(composePath)) return 0;
  const r = removeRestartPolicies(fs.read(composePath));
  if (r.removed > 0) fs.write(composePath, r.content);
  return r.removed;
}
