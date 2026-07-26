import { db } from "../packages/db/src/client.ts";
import { projects } from "../packages/db/src/schema.ts";

async function run() {
  try {
    const list = await db.select().from(projects);
    console.log("PROJECTS IN DB:", list);
  } catch (err) {
    console.error("DB ERROR:", err);
  }
}

run();
