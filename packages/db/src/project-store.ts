// Database access for scripts/consolidate-projects.ts. Lives here because this package is where drizzle-orm resolves.
import { db } from "./client.ts";
import { users, projects } from "./schema.ts";
import { eq, inArray } from "drizzle-orm";

export function createProjectStore() {
  return {
    users: async () => await db.select({ id: users.id, email: users.email }).from(users),
    projects: async () =>
      await db.select({ id: projects.id, userId: projects.userId, name: projects.name, status: projects.status, createdAt: projects.createdAt }).from(projects),
    reassign: async (ids: string[], to: string): Promise<number> =>
      db.transaction(async (tx) => {
        const rows = await tx.update(projects).set({ userId: to }).where(inArray(projects.id, ids)).returning({ id: projects.id });
        return rows.length;
      }),
    restore: async (rows: Array<{ id: string; userId: string }>): Promise<number> =>
      db.transaction(async (tx) => {
        let n = 0;
        for (const r of rows) {
          const changed = await tx.update(projects).set({ userId: r.userId }).where(eq(projects.id, r.id)).returning({ id: projects.id });
          n += changed.length;
        }
        return n;
      }),
  };
}
