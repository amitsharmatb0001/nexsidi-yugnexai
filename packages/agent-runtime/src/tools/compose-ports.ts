import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  | { ok: true; file: string | null; changed: number }
  | { ok: false; error: string };

/** Binds the compose file `docker compose up` would use in `cwd` to 127.0.0.1, or refuses when it has ports that can't be bound safely. */
export function prepareComposeForUp(cwd: string, fs: ComposeFs = nodeFs): PrepareComposeResult {
  const file = COMPOSE_FILES.map((name) => join(cwd, name)).find((path) => fs.exists(path)) ?? null;
  if (!file) return { ok: true, file: null, changed: 0 };

  const result = bindComposePortsToLoopback(fs.read(file));
  if (result.unsupported.length > 0) {
    return {
      ok: false,
      error: `Refusing to publish ports that are not bound to this PC only: ${result.unsupported.join(", ")}. Write every published port as "127.0.0.1:<host>:<container>".`,
    };
  }
  if (result.changed > 0) fs.write(file, result.content);
  return { ok: true, file, changed: result.changed };
}
