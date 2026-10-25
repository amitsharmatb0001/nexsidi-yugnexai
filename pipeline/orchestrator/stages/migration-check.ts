// Fresh-database migration check (2026-10-24, found on Brewline by starting a copy from scratch): a fix round added a
// migration that uses MIN(id) on a uuid column, which PostgreSQL 16 does not have. On the running app (created before
// that migration) nothing showed it; on a new database, which is what a customer's `docker compose up` creates, Postgres
// stops during start-up. The delivered compose file mounts db/migrations as Postgres's init directory, so every file runs
// in name order on first start and the first error stops it. This does the same in a throwaway PostgreSQL 16 container
// and reports the first file that fails, with the database's own message. No model call.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MigrationCheckResult {
  ran: boolean;
  findings: string[];
  note?: string;
}

export interface MigrationCheckDeps {
  exec?: (cmd: string) => string | Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

/** "docker run -d x" as the argument list for docker itself; a part in double quotes stays whole. */
export function dockerArgs(cmd: string): string[] {
  const args: string[] = [];
  for (const m of cmd.replace(/^docker /, "").matchAll(/"([^"]*)"|(\S+)/g)) args.push(m[1] ?? m[2]!);
  return args;
}

// Docker is started directly, with no cmd.exe, and without blocking the worker: inside the worker the blocking shell start ended with ETIMEDOUT every time (brewline3).
const defaultExec = (cmd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile("docker", dockerArgs(cmd), { encoding: "utf-8", timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr, stdout })) : resolve(stdout)));
  });

const errText = (err: unknown): string => {
  const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown; code?: unknown };
  return `${String(e?.stderr ?? "")}\n${String(e?.stdout ?? "")}\n${String(e?.message ?? err)}${e?.code ? ` [${String(e.code)}]` : ""}`;
};

export async function migrationFindings(projectDir: string, deps: MigrationCheckDeps = {}): Promise<MigrationCheckResult> {
  const exec = deps.exec ?? defaultExec;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const migrations = join(projectDir, "db", "migrations");
  const files = existsSync(migrations) ? readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort() : [];
  if (files.length === 0) return { ran: false, findings: [], note: "migration check not run: there are no migration files under db/migrations" };

  const name = `migcheck-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  try {
    await exec(`docker run -d --name ${name} -e POSTGRES_PASSWORD=check postgres:16-alpine`);
  } catch (err) {
    return { ran: false, findings: [], note: `migration check not run: docker could not start a PostgreSQL 16 container (${errText(err).trim().split("\n")[0]?.slice(0, 160)})` };
  }
  try {
    // The server restarts once after its own set-up, so it must answer twice in a row before it is used.
    let ready = 0;
    for (let i = 0; i < 60 && ready < 2; i++) {
      try {
        await exec(`docker exec ${name} pg_isready -U postgres`);
        ready++;
      } catch {
        ready = 0;
      }
      if (ready < 2) await sleep(1000);
    }
    if (ready < 2) return { ran: false, findings: [], note: "migration check not run: the PostgreSQL 16 container did not become ready in 60 s" };
    await exec(`docker cp "${migrations}/." ${name}:/m`);
    for (const file of files) {
      try {
        await exec(`docker exec ${name} psql -U postgres -v ON_ERROR_STOP=1 -f /m/${file}`);
      } catch (err) {
        const text = errText(err);
        const error = text.match(/ERROR:\s+([^\n]+)/)?.[1]?.trim() ?? text.trim().split("\n")[0] ?? "failed";
        const line = text.match(new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)`))?.[1];
        return {
          ran: true,
          findings: [`db/migrations/${file}${line ? ` (line ${line})` : ""} fails on a new database: ${error}. The app's compose file runs every migration in order the first time Postgres starts, so on a new install Postgres stops and the app never starts. Fix or remove this migration; migrations must work on an empty PostgreSQL 16.`],
        };
      }
    }
    return { ran: true, findings: [] };
  } finally {
    try { await exec(`docker rm -f ${name}`); } catch { /* nothing left to remove */ }
  }
}
