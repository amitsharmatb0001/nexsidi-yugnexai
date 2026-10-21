// Database access for the adversarial example database and the training history (patent claim 4).
// Plain row shapes, so this package does not depend on the training code that uses it.
import { db } from "./client.ts";
import { adversarialExamples, trainingRounds } from "./schema.ts";
import { and, asc, desc, eq, lte, gt, sql } from "drizzle-orm";

export interface ExampleRow {
  checker: string;
  id: string;
  operator: string;
  level: 1 | 2 | 3 | 4 | 5;
  file: string;
  description: string;
  before: string;
  after: string;
  hint: string;
  caught: number;
  missed: number;
}
export interface DefectRow {
  id: string;
  operator: string;
  level: 1 | 2 | 3 | 4 | 5;
  file: string;
  description: string;
  hint: string;
  before: string;
  after: string;
}
export interface RoundRow {
  level: 1 | 2 | 3 | 4 | 5;
  planted: number;
  caught: number;
}

export function createTrainingStore() {
  return {
    addRound: async (checker: string, level: 1 | 2 | 3 | 4 | 5, planted: number, caught: number): Promise<void> => {
      await db.insert(trainingRounds).values({ checker, level, planted, caught });
    },
    bumpExample: async (checker: string, d: DefectRow, caught: boolean): Promise<void> => {
      await db
        .insert(adversarialExamples)
        .values({ checker, id: d.id, operator: d.operator, level: d.level, file: d.file, description: d.description, beforeText: d.before, afterText: d.after, hint: d.hint, caught: caught ? 1 : 0, missed: caught ? 0 : 1 })
        .onConflictDoUpdate({
          target: [adversarialExamples.checker, adversarialExamples.id],
          set: caught ? { caught: sql`${adversarialExamples.caught} + 1`, updatedAt: new Date() } : { missed: sql`${adversarialExamples.missed} + 1`, updatedAt: new Date() },
        });
    },
    missedFor: async (checker: string, maxLevel: number, limit: number): Promise<ExampleRow[]> => {
      const rows = await db
        .select()
        .from(adversarialExamples)
        .where(and(eq(adversarialExamples.checker, checker), gt(adversarialExamples.missed, 0), lte(adversarialExamples.level, maxLevel)))
        .orderBy(desc(sql`${adversarialExamples.missed} - ${adversarialExamples.caught}`), desc(adversarialExamples.level))
        .limit(limit);
      return rows.map((r) => ({ checker: r.checker, id: r.id, operator: r.operator, level: r.level as ExampleRow["level"], file: r.file, description: r.description, before: r.beforeText, after: r.afterText, hint: r.hint, caught: r.caught, missed: r.missed }));
    },
    history: async (checker: string): Promise<RoundRow[]> => {
      const rows = await db.select().from(trainingRounds).where(eq(trainingRounds.checker, checker)).orderBy(asc(trainingRounds.ranAt));
      return rows.map((r) => ({ level: r.level as RoundRow["level"], planted: r.planted, caught: r.caught }));
    },
  };
}
