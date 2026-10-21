// Moves older projects under one account.
//
// Ownership is a single column (projects.user_id). Every other table is keyed by project id, and the build folders and the
// lineage registry are keyed by project id too, so changing that one column moves a project for good.
//
// Safe by design:
//   - It is a DRY RUN unless --apply is given, and --apply also needs --confirm <the target email> typed again.
//   - The old owner of every project is written to a backup file BEFORE anything changes; if the backup cannot be written,
//     nothing is moved.
//   - The move is one database transaction, and the result is counted afterwards.
//   - --undo <backup file> puts every project back with its old owner (skipping any that has been changed since).
//
//   bun scripts/consolidate-projects.ts --to amit@yugnex.com                       # show what would move
//   bun scripts/consolidate-projects.ts --to amit@yugnex.com --from a@x.com,b@y.com
//   bun scripts/consolidate-projects.ts --to amit@yugnex.com --apply --confirm amit@yugnex.com
//   bun scripts/consolidate-projects.ts --undo <backup file>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UserRow {
  id: string;
  email: string;
}
export interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  status: string;
  createdAt: string | Date;
}
export interface Store {
  users(): Promise<UserRow[]>;
  projects(): Promise<ProjectRow[]>;
  /** Sets the owner of the listed projects; returns how many rows changed. Runs as one transaction. */
  reassign(ids: string[], toUserId: string): Promise<number>;
  /** Sets each project back to the owner given; returns how many rows changed. Runs as one transaction. */
  restore(rows: Array<{ id: string; userId: string }>): Promise<number>;
}

export interface Plan {
  target: UserRow;
  moves: Array<{ project: ProjectRow; fromLabel: string }>;
  alreadyOnTarget: number;
  owners: Array<{ label: string; count: number }>;
}
export interface Backup {
  createdAt: string;
  target: UserRow;
  rows: Array<{ id: string; userId: string }>;
}

const norm = (s: string) => s.trim().toLowerCase();

export function planConsolidation(users: UserRow[], projects: ProjectRow[], opts: { to: string; from?: string[] }): Plan | { error: string } {
  const matches = users.filter((u) => norm(u.email) === norm(opts.to));
  if (matches.length === 0) return { error: `no account with the email ${opts.to}` };
  if (matches.length > 1) return { error: `${matches.length} accounts share the email ${opts.to}; will not guess which one` };
  const target = matches[0]!;

  let allowed: Set<string> | null = null;
  if (opts.from && opts.from.length > 0) {
    allowed = new Set();
    for (const email of opts.from) {
      const found = users.filter((u) => norm(u.email) === norm(email));
      if (found.length === 0) return { error: `--from names ${email}, which is not an account` };
      for (const u of found) allowed.add(u.id);
    }
  }

  const label = (userId: string) => users.find((u) => u.id === userId)?.email ?? `(no account: ${userId})`;
  const moves: Plan["moves"] = [];
  const counts = new Map<string, number>();
  let alreadyOnTarget = 0;
  for (const project of projects) {
    if (project.userId === target.id) {
      alreadyOnTarget++;
      continue;
    }
    if (allowed && !allowed.has(project.userId)) continue;
    const fromLabel = label(project.userId);
    moves.push({ project, fromLabel });
    counts.set(fromLabel, (counts.get(fromLabel) ?? 0) + 1);
  }
  return { target, moves, alreadyOnTarget, owners: [...counts].map(([l, count]) => ({ label: l, count })).sort((a, b) => b.count - a.count) };
}

/** Writes the backup, then moves the projects, then checks the count. `writeBackup` returns where it saved the file. */
export async function applyConsolidation(
  store: Store,
  plan: Plan,
  writeBackup: (backup: Backup) => Promise<string>,
): Promise<{ moved: number; backupPath: string }> {
  if (plan.moves.length === 0) return { moved: 0, backupPath: "" };
  const backup: Backup = { createdAt: new Date().toISOString(), target: plan.target, rows: plan.moves.map((m) => ({ id: m.project.id, userId: m.project.userId })) };
  const backupPath = await writeBackup(backup); // nothing has changed yet; if this throws, nothing is moved
  const moved = await store.reassign(backup.rows.map((r) => r.id), plan.target.id);
  if (moved !== plan.moves.length) throw new Error(`expected ${plan.moves.length} projects to move but ${moved} did; the backup is at ${backupPath}`);
  return { moved, backupPath };
}

/** Puts projects back with the owner in the backup, leaving any that has been changed since the consolidation. */
export async function undoConsolidation(store: Store, backup: Backup): Promise<{ restored: number; skipped: string[] }> {
  const current = new Map((await store.projects()).map((p) => [p.id, p.userId]));
  const toRestore: Backup["rows"] = [];
  const skipped: string[] = [];
  for (const row of backup.rows) {
    if (current.get(row.id) === backup.target.id) toRestore.push(row);
    else skipped.push(row.id);
  }
  const restored = toRestore.length > 0 ? await store.restore(toRestore) : 0;
  return { restored, skipped };
}

// ── real database ───────────────────────────────────────────────────────────

async function postgresStore(): Promise<Store> {
  const { createProjectStore } = await import("../packages/db/src/project-store.ts");
  return createProjectStore() as Store;
}

const backupDir = () => join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "nexsidi-consolidation");

async function writeBackupFile(backup: Backup): Promise<string> {
  mkdirSync(backupDir(), { recursive: true });
  const path = join(backupDir(), `consolidation-${backup.createdAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, JSON.stringify(backup, null, 2), { flag: "wx" });
  return path;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const store = await postgresStore();
  const undoPath = arg("--undo");
  if (undoPath) {
    const backup = JSON.parse(readFileSync(undoPath, "utf8")) as Backup;
    const r = await undoConsolidation(store, backup);
    console.log(`Restored ${r.restored} project(s) to their old owners.${r.skipped.length ? ` Left alone (changed since): ${r.skipped.join(", ")}` : ""}`);
    return;
  }
  const to = arg("--to");
  if (!to) {
    console.error("Usage: bun scripts/consolidate-projects.ts --to <email> [--from a@x,b@y] [--apply --confirm <email>] | --undo <backup file>");
    process.exit(2);
  }
  const from = arg("--from")?.split(",").map((s) => s.trim()).filter(Boolean);
  const plan = planConsolidation(await store.users(), await store.projects(), { to, from });
  if ("error" in plan) {
    console.error(`Stopped: ${plan.error}`);
    process.exit(1);
  }
  console.log(`Target account: ${plan.target.email} (${plan.target.id})`);
  console.log(`Already owned by the target: ${plan.alreadyOnTarget}`);
  console.log(`To move: ${plan.moves.length}`);
  for (const o of plan.owners) console.log(`  ${String(o.count).padStart(3)}  from ${o.label}`);
  for (const m of plan.moves) console.log(`    ${m.project.id}  ${String(m.project.status).padEnd(10)} ${m.project.name}  (${m.fromLabel})`);
  if (!process.argv.includes("--apply")) {
    console.log("\nDRY RUN: nothing was changed. To do it: add  --apply --confirm " + plan.target.email);
    return;
  }
  if (arg("--confirm") === undefined || norm(arg("--confirm")!) !== norm(plan.target.email)) {
    console.error(`\nStopped: --apply also needs  --confirm ${plan.target.email}  (typed again, to be sure of the target).`);
    process.exit(1);
  }
  const r = await applyConsolidation(store, plan, writeBackupFile);
  console.log(`\nMoved ${r.moved} project(s) to ${plan.target.email}.`);
  if (r.backupPath) console.log(`Backup of the old owners: ${r.backupPath}\nTo undo: bun scripts/consolidate-projects.ts --undo "${r.backupPath}"`);
}

if (import.meta.main) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(`Failed: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  });
}
