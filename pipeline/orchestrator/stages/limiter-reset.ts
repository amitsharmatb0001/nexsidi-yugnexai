// Rate-limit reset for the system's own test instance of a generated app (2026-10-25, brewline2).
//
// The generated app limits sign-up and sign-in (10 requests per 15 minutes per address, counted in memory). The system's own
// checks (deploy round trip, role accounts, auth smoke test, page sweep, live reviewers) use that budget up in every round:
// they hit "429 Too many requests", and the customer's first real sign-up right after delivery would too. Restarting the
// backend container of our own test instance resets the counters; the limiter in the app is left exactly as it is.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface LimiterResetDeps {
  exec?: (cmd: string) => string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the backend to answer again (default 60 s). */
  waitMs?: number;
}

export async function resetAppRateLimits(buildDir: string, backendUrl: string, deps: LimiterResetDeps = {}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const composePath = join(buildDir, "docker-compose.yml");
  if (!existsSync(composePath)) return { ok: false, reason: "no docker-compose.yml" };
  const exec = deps.exec ?? ((cmd: string) => execSync(cmd, { encoding: "utf-8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }));
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    exec(`docker compose -f "${composePath}" restart backend`);
  } catch (err) {
    return { ok: false, reason: `could not restart the backend: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` };
  }
  const waitMs = deps.waitMs ?? 60_000;
  const pollMs = 1_000;
  for (let waited = 0; waited <= waitMs; waited += pollMs) {
    try {
      const res = await fetchFn(`${backendUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.status < 500) return { ok: true };
    } catch {
      // not answering yet
    }
    await sleep(pollMs);
  }
  return { ok: false, reason: `the backend did not answer within ${Math.round(waitMs / 1000)} s after the restart` };
}
