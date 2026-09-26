# Bind Generated App Ports to 127.0.0.1 — Implementation Plan

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Every port a generated app publishes is reachable only from this PC (`127.0.0.1`), never from the Wi-Fi/LAN, without breaking deploy, clone, health checks or "open app".

**Architecture:** One shared, pure module owns the published-port format: parse `[IP:]HOST:CONTAINER` and rewrite entries to `127.0.0.1:HOST:CONTAINER`. It is enforced at the single choke point every agent-driven deploy passes through (`execDockerCompose` "up"), plus the clone path. The two duplicate port parsers switch to it, so a format change can never silently break one copy again. Riya's prompt asks for the safe form up front; the tool guard makes it true even if the model ignores that.

**Tech Stack:** TypeScript, Bun (`bun test`), Docker Compose short port syntax.

## Evidence (verified 2026-09-26 on Amit's PC)

| Fact | How verified |
|---|---|
| Generated apps publish `"HOST:CONTAINER"` (no IP), so Docker binds `0.0.0.0` and `[::]` | `E:/tmp/nexsidi-builds/5b25274f2abc/docker-compose.yml`; `docker ps` |
| Reachable via the LAN IP: postgres 5437 and frontend 3202 | `Test-NetConnection 10.62.192.240` |
| Other devices are not blocked by the firewall: Wi-Fi profile is **Public**, and "Docker Desktop Backend" has an inbound **Allow** rule on the Public profile | `Get-NetConnectionProfile`, `Get-NetFirewallRule` (not yet tested from a second device) |
| NexSidi's own dev stack is exposed too: postgres 5434, **redis 6379 (no password: `PING` → `PONG`)**, **temporal 7233**, temporal-ui 8088 | `docker ps`, `redis-cli ping` |
| `http://localhost:<port>` still works against a 127.0.0.1-only port from curl, Bun `fetch`, Node `fetch`, Node `http.get` and PowerShell. `localhost` resolves to `::1` first, but all of them fall back to 127.0.0.1. Direct `[::1]` is refused | tested live against the 127.0.0.1-bound laya-server container |
| `docker` is not in `run_command`'s allowlist, so agents can only run compose via the `docker_compose` tool (`execDockerCompose`) | `tools/command.ts` `ALLOWED_COMMANDS` |
| Riya's compose is written by the model from `buildAgentTask`'s "Ports to use" text. There is no deterministic template, and no port examples in `packages/agent-runtime/skills/riya/` | `agents/riya/src/index.ts:1597-1623`, grep of skills |
| **Changing the format without updating parsers breaks three things**: `getRunningDeploymentPorts` (`/-\s*"(\d+):\d+"/` fails on `"127.0.0.1:…"`, so "open app" and clone health checks report not running → `deploy_unhealthy`), `parseComposePorts` (clone → `source_ports_unreadable`), `rewriteComposePorts` (`"${old}:` never matches → the clone keeps the source's ports → collision) | read on `feat/nexsidi-pipeline-v2-eager` |
| `isPortUsedByDocker` (`:${port}->`) already matches `127.0.0.1:3202->3000/tcp` | regex inspection; locked in with a test in Task 2 |

## Every place that writes, rewrites or parses published ports

| Location | Role | Change |
|---|---|---|
| `packages/agent-runtime/src/tools/docker.ts` `execDockerCompose` | Every agent `up` (Riya, Aanya) | Guard: bind to 127.0.0.1 before `up`; refuse unsupported forms |
| `agents/riya/src/index.ts` `buildAgentTask` | Prompt that makes Riya write the compose | Ask for the exact `"127.0.0.1:H:C"` lines |
| `agents/riya/src/index.ts` `getRunningDeploymentPorts` | Parses compose for "is it running" (Stage 6 reuse, `ensureProjectRunning`, clone health check) | Use the shared parser |
| `agents/riya/src/index.ts` `isPortUsedByDocker` | Parses `docker ps` | No change; add a test for the 127.0.0.1 form |
| `agents/riya/src/index.ts` `ensureProjectRunning` | Re-`up`s an existing stopped project | **No change by default** (existing projects; see Decision 2) |
| `pipeline/orchestrator/clone-project.ts` `parseComposePorts` | Reads the source's ports | Use the shared parser |
| `pipeline/orchestrator/clone-project.ts` `rewriteComposePorts` | Swaps host ports for the clone | Match IP-prefixed entries too |
| `pipeline/orchestrator/clone-project.ts` `cloneProject` | Writes the clone's compose | Bind to 127.0.0.1 after the port rewrite (old 0.0.0.0 sources produce safe clones) |
| `pipeline/orchestrator/clone-deploy.ts` `deployWithRetry` | `up` for clones | No change (the compose it deploys is already bound by `cloneProject`) |
| `docker-compose.dev.yml` | NexSidi dev stack | Bind all 4 to 127.0.0.1 (file only; applying needs Decision 3) |

## Global Constraints

- Branch `feat/nexsidi-pipeline-v2-eager` (this worktree is on the older `claude/eager-varahamihira-967edb`: 172 commits behind, 0 unique; switching needs Amit's OK).
- Tests first (`bun test <file>`), then typecheck (`bun run typecheck` in `packages/agent-runtime`).
- Do not modify, restart or `down` any existing user project's containers or compose files without Amit's explicit OK. Only new builds and clones change.
- Deny by default: a published port the guard cannot bind to 127.0.0.1 (a port range, long syntax, container-only `"3000"`, an explicit non-loopback IP, inline `ports: [...]`) makes `up` fail with an actionable error. It is never silently published on all interfaces.
- Output compose entries are always double-quoted (`"127.0.0.1:3202:3000"`), keeping the entry's indentation.
- No behavior change for entries already bound to `127.0.0.1`: the rewrite is idempotent.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `packages/agent-runtime/src/tools/compose-ports.ts` | Create | `parseServiceHostPort`, `bindComposePortsToLoopback`, `prepareComposeForUp` (pure except the injected fs) |
| `packages/agent-runtime/src/tools/compose-ports.test.ts` | Create | Format tests |
| `packages/agent-runtime/src/tools/docker.ts` (+ `docker.test.ts`) | Modify | Call `prepareComposeForUp` before `up` |
| `packages/agent-runtime/src/index.ts` | Modify | Export `parseServiceHostPort`, `bindComposePortsToLoopback` |
| `agents/riya/src/index.ts` (+ `port-selection.test.ts`) | Modify | Shared parser in `getRunningDeploymentPorts`; prompt lines |
| `pipeline/orchestrator/clone-project.ts` (+ `clone-project.test.ts`) | Modify | Shared parser, IP-aware rewrite, bind after rewrite |
| `docker-compose.dev.yml` | Modify | `127.0.0.1:` on all 4 port entries |

---

### Task 1: Shared published-port module

**Files:** Create `packages/agent-runtime/src/tools/compose-ports.ts`, `compose-ports.test.ts`

**Interfaces (produces):**
```typescript
export function parseServiceHostPort(compose: string, service: string): number | null;
export interface LoopbackBindResult { content: string; changed: number; unsupported: string[] }
export function bindComposePortsToLoopback(compose: string): LoopbackBindResult;
export interface ComposeFs { exists(p: string): boolean; read(p: string): string; write(p: string, s: string): void }
export function prepareComposeForUp(cwd: string, fs?: ComposeFs):
  { ok: true; file: string | null; changed: number } | { ok: false; error: string };
```

- [ ] **Step 1: Failing tests**
```typescript
import { test, expect } from "bun:test";
import { join } from "node:path";
import { parseServiceHostPort, bindComposePortsToLoopback, prepareComposeForUp } from "./compose-ports.ts";

const compose = (fe: string, be: string, db: string) =>
  `services:\n  postgres:\n    image: postgres:16\n    ports:\n      - ${db}\n  backend:\n    build: ./backend\n    ports:\n      - ${be}\n  frontend:\n    build: ./frontend\n    ports:\n      - ${fe}\n`;

test("parseServiceHostPort reads plain, loopback-bound, 0.0.0.0-bound, unquoted and /tcp forms", () => {
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`"127.0.0.1:3202:3000"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`"0.0.0.0:3202:3000"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`3202:3000`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`"127.0.0.1:3202:3000/tcp"`, `"3303:3001"`, `"5437:5432"`), "frontend")).toBe(3202);
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`), "postgres")).toBe(5437); // "image: postgres:16" is not a port entry
});

test("parseServiceHostPort handles CRLF files and returns null for a missing service", () => {
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`).replace(/\n/g, "\r\n"), "backend")).toBe(3303);
  expect(parseServiceHostPort(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`), "redis")).toBeNull();
});

test("bindComposePortsToLoopback binds plain and 0.0.0.0 entries, keeps indentation, always double-quotes", () => {
  const r = bindComposePortsToLoopback(compose(`3202:3000`, `"0.0.0.0:3303:3001"`, `'5437:5432'`));
  expect(r.changed).toBe(3);
  expect(r.unsupported).toEqual([]);
  expect(r.content).toContain(`      - "127.0.0.1:3202:3000"\n`);
  expect(r.content).toContain(`      - "127.0.0.1:3303:3001"\n`);
  expect(r.content).toContain(`      - "127.0.0.1:5437:5432"\n`);
  expect(r.content).toContain("    image: postgres:16\n"); // non-port lines untouched
});

test("bindComposePortsToLoopback is idempotent and leaves already-bound entries alone", () => {
  const once = bindComposePortsToLoopback(compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`)).content;
  const twice = bindComposePortsToLoopback(once);
  expect(twice.changed).toBe(0);
  expect(twice.content).toBe(once);
});

test("bindComposePortsToLoopback reports forms it cannot safely bind (deny by default)", () => {
  const weird = `services:\n  web:\n    ports:\n      - "3000-3005:3000-3005"\n      - "3000"\n      - "192.168.1.5:80:80"\n      - target: 80\n        published: 8080\n  api:\n    ports: ["4000:4000"]\n`;
  const r = bindComposePortsToLoopback(weird);
  expect(r.unsupported).toEqual([`"3000-3005:3000-3005"`, `"3000"`, `"192.168.1.5:80:80"`, `target: 80`, `ports: ["4000:4000"]`]);
});

test("prepareComposeForUp rewrites the file docker compose would pick, and refuses unsupported entries", () => {
  const key = join("/app", "docker-compose.yml"); // "\app\docker-compose.yml" on Windows
  const files: Record<string, string> = { [key]: compose(`"3202:3000"`, `"3303:3001"`, `"5437:5432"`) };
  const fs = { exists: (p: string) => p in files, read: (p: string) => files[p]!, write: (p: string, s: string) => { files[p] = s; } };
  const ok = prepareComposeForUp("/app", fs);
  expect(ok).toEqual({ ok: true, file: key, changed: 3 });
  expect(files[key]).toContain(`"127.0.0.1:3202:3000"`);

  files[key] = `services:\n  web:\n    ports:\n      - "3000"\n`;
  const bad = prepareComposeForUp("/app", fs);
  expect(bad.ok).toBe(false);
  expect(bad.ok === false && bad.error).toContain(`"127.0.0.1:<host>:<container>"`);
});
```
- [ ] **Step 2: Run, verify FAIL** (`bun test packages/agent-runtime/src/tools/compose-ports.test.ts`)
- [ ] **Step 3: Implement**
```typescript
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Short-syntax published port: - "[IP:]HOST:CONTAINER[/tcp|/udp]" (quoted with " or ', or unquoted).
const PORT_ENTRY = /^(\s*-\s*)(["']?)(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d{1,5}):(\d{1,5})(\/(?:tcp|udp))?\2\s*$/;

function serviceBlock(compose: string, service: string): string | null {
  const text = compose.replace(/\r\n/g, "\n");
  // Bounded by the next line with EXACTLY 2 spaces + a non-space char (the next service key).
  const m = text.match(new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n {2}\\S|$)`));
  return m?.[1] ?? null;
}

export function parseServiceHostPort(compose: string, service: string): number | null {
  const block = serviceBlock(compose, service);
  if (!block) return null;
  for (const line of block.split("\n")) {
    const m = line.match(PORT_ENTRY);
    if (m) return Number(m[4]);
  }
  return null;
}

export function bindComposePortsToLoopback(compose: string): LoopbackBindResult {
  const eol = compose.includes("\r\n") ? "\r\n" : "\n";
  const lines = compose.split(/\r?\n/);
  let changed = 0;
  const unsupported: string[] = [];
  let portsIndent = -1; // indent of the active "ports:" key, -1 when outside one
  const out = lines.map((line) => {
    const indent = line.search(/\S/);
    const inline = line.match(/^\s*ports:\s*\[.*$/);
    if (inline) { unsupported.push(line.trim()); portsIndent = -1; return line; }
    if (/^\s*ports:\s*$/.test(line)) { portsIndent = indent; return line; }
    if (portsIndent >= 0 && indent !== -1 && indent <= portsIndent) portsIndent = -1;
    if (portsIndent < 0 || indent === -1) return line;
    if (!/^\s*-/.test(line)) return line; // continuation of a long-syntax item (e.g. "published: 8080")
    const m = line.match(PORT_ENTRY);
    if (!m) { unsupported.push(line.replace(/^\s*-\s*/, "").trim()); return line; }
    const [, prefix, , ip, host, container, proto = ""] = m;
    if (ip === "127.0.0.1") return line;
    if (ip !== undefined && ip !== "0.0.0.0") { unsupported.push(line.replace(/^\s*-\s*/, "").trim()); return line; }
    changed++;
    return `${prefix}"127.0.0.1:${host}:${container}${proto}"`;
  });
  return { content: out.join(eol), changed, unsupported };
}

// Same lookup order docker compose itself uses.
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const nodeFs: ComposeFs = { exists: existsSync, read: (p) => readFileSync(p, "utf-8"), write: (p, s) => writeFileSync(p, s, "utf-8") };

export function prepareComposeForUp(cwd: string, fs: ComposeFs = nodeFs) {
  const file = COMPOSE_FILES.map((f) => join(cwd, f)).find((p) => fs.exists(p)) ?? null;
  if (!file) return { ok: true as const, file: null, changed: 0 };
  const r = bindComposePortsToLoopback(fs.read(file));
  if (r.unsupported.length) {
    return { ok: false as const, error: `Refusing to publish ports that are not bound to this PC only: ${r.unsupported.join(", ")}. Write every published port as "127.0.0.1:<host>:<container>".` };
  }
  if (r.changed) fs.write(file, r.content);
  return { ok: true as const, file, changed: r.changed };
}
```
(`join` gives `\app\docker-compose.yml` on Windows; the test builds its key with the same `join`, so it passes on both platforms.)

> **Pre-validated 2026-09-26:** this exact Task 1 code and these tests were run in a scratch folder (not the repo): 8/8 pass. Added check: the real generated file `E:/tmp/nexsidi-builds/5b25274f2abc/docker-compose.yml` binds cleanly (3 entries changed, 0 unsupported) and parses back to 3202/3303/5437. The IP-aware `rewriteComposePorts` regex from Task 3 was checked in the same run (`"127.0.0.1:3000:3000"` → host position only).
- [ ] **Step 4: PASS + typecheck.** Export `parseServiceHostPort`, `bindComposePortsToLoopback` from `packages/agent-runtime/src/index.ts`.
- [ ] **Step 5: Commit** `feat(agent-runtime): shared published-port parser + loopback binder for generated compose files`

### Task 2: Guard `docker_compose up` + switch Riya's parser and prompt

**Files:** Modify `tools/docker.ts` (+test), `agents/riya/src/index.ts` (+`port-selection.test.ts`)

- [ ] **Step 1: Failing tests**
  - `docker.test.ts`: in a temp dir with a compose file containing `"3000"`, `execDockerCompose(dir, { action: "up" })` resolves `status: "error"` with the `127.0.0.1:<host>:<container>` hint **without spawning docker** (assert via the summary text and elapsed time < 1 s). With a plain `"3202:3000"` compose and a fake `docker` shim unavailable, the file on disk is rewritten to `"127.0.0.1:3202:3000"` before the spawn (assert the file content after the call; the spawn itself may fail in CI, which is fine for this assertion).
  - `port-selection.test.ts`: `getRunningDeploymentPorts` returns `{3202, 3303, 5437}` for a compose using `"127.0.0.1:…"` (docker check stubbed true). `isPortUsedByDocker(3202, () => "127.0.0.1:3202->3000/tcp")` is `true`.
  - `buildAgentTask(...)` output contains `- "127.0.0.1:5437:5432"`, `- "127.0.0.1:3303:3001"`, `- "127.0.0.1:3202:3000"`.
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implement**
  - `execDockerCompose`: at the start of `case "up"`, `const prep = prepareComposeForUp(cwd); if (!prep.ok) return Promise.resolve({ status: "error", summary: prep.error, next_actions: ["Fix the ports: entries in docker-compose.yml, then run docker_compose up again"] });`. On success, append ` (bound ${prep.changed} published port(s) to 127.0.0.1)` to the summary when `prep.changed > 0`.
  - `getRunningDeploymentPorts`: replace the local `portFor` with `parseServiceHostPort(compose, service)`. The docker-verification step is unchanged.
  - `buildAgentTask`: replace the "Ports to use" bullets with the exact lines to write under each service's `ports:`, plus one sentence of why ("only reachable from this computer; never omit the 127.0.0.1").
- [ ] **Step 4: PASS; full `bun test agents/riya packages/agent-runtime/src/tools` PASS; typecheck**
- [ ] **Step 5: Commit** `fix(security): generated apps publish ports on 127.0.0.1 only (tool guard + Riya prompt + parser)`

### Task 3: Clone path

**Files:** Modify `pipeline/orchestrator/clone-project.ts` (+`clone-project.test.ts`)

- [ ] **Step 1: Failing tests**
  - `parseComposePorts` reads the `"127.0.0.1:H:C"` form, and the existing Clario AI fixture still passes.
  - `rewriteComposePorts` on an IP-prefixed compose swaps all three host ports, keeps the `127.0.0.1:` prefix and rewrites `localhost:OLD` references. The existing plain-form test still passes, and the "new port equals another service's old port" case still holds.
  - `cloneProject` from a **plain-form** source (an old 0.0.0.0 project) writes a clone compose where every port entry is `"127.0.0.1:…"`, with the fresh ports.
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implement**
  - `parseComposePorts`: use `parseServiceHostPort`, imported via `../../packages/agent-runtime/src/tools/compose-ports.ts` (existing deep-relative convention). Update the "independent copy" comment: the parse is now shared because a format change broke both copies at once; the verification difference stays in `getRunningDeploymentPorts`.
  - `rewriteComposePorts`: replace ``new RegExp(`"${port}:`, "g")`` with ``new RegExp(`(-\\s*["']?(?:\\d{1,3}(?:\\.\\d{1,3}){3}:)?)${port}:`, "g")`` → `` `$1${TOKEN}:` ``, for all three ports. The `localhost:` replacements are unchanged.
  - `cloneProject`: after `rewriteComposePorts`, run `bindComposePortsToLoopback`. If `unsupported` is non-empty, throw `clone source compose has published ports that cannot be bound to 127.0.0.1: …`; the route already maps a thrown clone error to a JSON error.
- [ ] **Step 4: PASS; `bun test pipeline/orchestrator` PASS; typecheck**
- [ ] **Step 5: Commit** `fix(security): clones always bind published ports to 127.0.0.1, IP-aware port rewrite`

### Task 4: Dev stack compose (file change only)

- [ ] **Step 1:** In `docker-compose.dev.yml`, change `"5434:5432"`, `"6379:6379"`, `"7233:7233"` and `"8088:8080"` to `"127.0.0.1:…"`. Healthchecks run inside the containers and are unaffected. The Temporal comment about hostname vs 127.0.0.1 concerns the in-container healthcheck, not host publishing.
- [ ] **Step 2:** `docker compose -f docker-compose.dev.yml config` parses cleanly (no containers touched).
- [ ] **Step 3: Commit** `fix(security): dev stack (postgres/redis/temporal) published on 127.0.0.1 only`
- [ ] **Step 4 (only with Amit's OK, Decision 3):** apply with `docker compose -f docker-compose.dev.yml up -d`. This recreates those 4 containers, and named volumes keep the data. Then check that the API and worker reconnect (`/health`, one pipeline status call) and that `docker ps` shows `127.0.0.1:` for all 4.

### Task 5: Live verification (real clone, $0: manual source + no changes → no LLM calls)

- [ ] **Step 1:** Restart the API so it loads the new code (its `start` script has no watch). Through the dashboard clone page, logged in as Amit, clone one existing project with manual source, no changes, name "Port Fix Check".
- [ ] **Step 2: Evidence to capture:**
  - `docker ps --filter name=<newId>` shows `127.0.0.1:<port>->` for frontend, backend and postgres, and no `0.0.0.0`.
  - `curl http://localhost:<frontendPort>` → 200, and the app opens in the browser.
  - `curl http://localhost:<backendPort>/health` → 200.
  - `Test-NetConnection <LAN IP> -Port <frontendPort>` and `-Port <dbPort>` → fail.
  - The clone route returned success (so `getRunningDeploymentPorts` parsed the new form, i.e. no `deploy_unhealthy`).
- [ ] **Step 3: Agent tool path:** in a scratch copy of that clone, reset the compose ports to the plain `"H:C"` form (what Riya writes today). Call `execDockerCompose(dir, { action: "up" })` from a small `bun -e` script, then check that `docker ps` shows `127.0.0.1:` and that the summary says "bound 3 published port(s)".
- [ ] **Step 4:** Ask Amit before removing the test clones' containers (`docker compose down` is destructive for those two test projects only).

## Decisions for Amit

1. **Approve the plan + switch this worktree to `feat/nexsidi-pipeline-v2-eager`?**
2. **Existing projects** (still exposed after this change: 5b25274f2abc, gthrdeploy45t, ac85eb0fa344, 88d7b375eaef). Options:
   - (a) Leave them until they're next redeployed.
   - (b) With your OK, rewrite their compose files and run `docker compose up -d`, about 1 minute of downtime each; data volumes are kept.
   - (c) Also make `ensureProjectRunning` bind to 127.0.0.1 when it restarts a stopped project. That changes existing projects' compose files, which the task said not to do without asking.
3. **Apply the dev-stack change now** (Task 4 Step 4)? Redis (no password) and Temporal are currently reachable from your Wi-Fi.
4. **Machine-wide backstop (you'd do this yourself; it's a Docker system setting):** Docker Desktop → Settings → Docker Engine → add `"ip": "127.0.0.1"`, then Apply & Restart. Any port published without an explicit IP then defaults to 127.0.0.1 on this PC. It restarts every running container once.
