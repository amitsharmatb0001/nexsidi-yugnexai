import { db, projects } from "@nexsidi/db";
import { desc } from "drizzle-orm";
const rows = await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(3);
console.log(JSON.stringify(rows, null, 2));
process.exit(0);
