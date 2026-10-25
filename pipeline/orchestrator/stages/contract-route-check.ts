// Contract route check (final plan item 1, 2026-10-24): the approved API contract is the yardstick for the backend.
// When the backend builder says it is done, the system loads the compiled app and calls every contract endpoint with
// no database behind it, and reports only what the app really answered:
//   - a route that does not exist (404 with no handler),
//   - a protected route that does not refuse a request with no token (must be 401/403),
//   - a staff-only route that lets a customer's token in.
// Auth runs before any database access in the generated apps, so these answers do not need data.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ContractEndpoint {
  method: string;
  path: string;
  auth?: boolean;
  description?: string;
}

export interface ContractRouteResult {
  ran: boolean;
  findings: string[];
  note?: string;
}

const ROLE_ONLY = /\b(staff|admin|owner|manager)[- ]only\b/i;
const UUID = "00000000-0000-4000-8000-0000000000aa";

/** The contract says only staff/admin/owner/manager may call it (its own wording; nothing is inferred from code). */
export function staffOnlyEndpoint(e: ContractEndpoint): boolean {
  return e.auth !== false && ROLE_ONLY.test(e.description ?? "");
}

const concrete = (path: string) => path.replace(/:[A-Za-z_]+/g, UUID);
// A handler answers 404 for a record that does not exist ("Menu item not found"), which is correct; a missing route
// answers 404 too. On a route with an :id only the other checks apply, so that 404 is never reported as a missing route.
const hasIdParam = (path: string) => /:[A-Za-z_]+/.test(path);

export async function contractRouteFindings(backendDir: string, endpoints: ContractEndpoint[], timeoutMs = 60_000): Promise<ContractRouteResult> {
  if (!existsSync(join(backendDir, "dist", "app.js"))) {
    return { ran: false, findings: [], note: "contract route check not run: backend/dist/app.js is missing (the build has not produced it)" };
  }
  type Job = { id: string; method: string; path: string; role?: string };
  const jobs: Job[] = [];
  for (const e of endpoints) {
    const base = { method: e.method.toUpperCase(), path: concrete(e.path) };
    jobs.push({ id: `${e.method} ${e.path}|none`, ...base });
    if (staffOnlyEndpoint(e)) jobs.push({ id: `${e.method} ${e.path}|customer`, ...base, role: "customer" });
  }
  const runner = join(import.meta.dir, "contract-route-runner.cjs");
  const secret = `contract-check-${Date.now()}`;
  const raw = await new Promise<string>((resolve) => {
    const child = spawn("node", [runner], {
      cwd: backendDir,
      env: { ...process.env, JWT_SECRET: secret, NODE_ENV: "test", DATABASE_URL: "postgres://check:check@127.0.0.1:1/check", PORT: "0" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(JSON.stringify({ ok: false, error: `timed out after ${timeoutMs / 1000}s` }));
    }, timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => { clearTimeout(timer); resolve(out); });
    child.on("error", (err) => { clearTimeout(timer); resolve(JSON.stringify({ ok: false, error: String(err) })); });
    child.stdin.end(JSON.stringify({ backendDir, jobs }));
  });
  let parsed: { ok: boolean; error?: string; results?: Array<{ id: string; status: number | null }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ran: false, findings: [], note: "contract route check not run: the compiled app could not be loaded (no output)" };
  }
  if (!parsed.ok || !parsed.results) return { ran: false, findings: [], note: `contract route check not run: ${parsed.error ?? "the compiled app could not be loaded"}` };

  const status = new Map(parsed.results.map((r) => [r.id, r.status] as const));
  const findings: string[] = [];
  for (const e of endpoints) {
    const label = `${e.method.toUpperCase()} ${e.path}`;
    const plain = status.get(`${e.method} ${e.path}|none`);
    if (plain === null || plain === undefined) continue;
    if (plain === 404 && !hasIdParam(e.path)) {
      findings.push(`${label} is in the approved API contract but the backend answers 404 — the route does not exist or is not mounted`);
      continue;
    }
    if (e.auth !== false && plain !== 401 && plain !== 403 && !(hasIdParam(e.path) && plain === 404)) {
      findings.push(`${label} needs sign-in per the contract, but called without a token the backend answered ${plain} (must be 401 or 403)`);
    }
    if (staffOnlyEndpoint(e)) {
      const asCustomer = status.get(`${e.method} ${e.path}|customer`);
      if (asCustomer !== null && asCustomer !== undefined && asCustomer !== 401 && asCustomer !== 403 && asCustomer !== 500) {
        findings.push(`${label} is staff-only per the contract, but a signed-in customer token got ${asCustomer} (must be 403) — a customer can call it`);
      }
    }
  }
  return { ran: true, findings };
}
