import { db, contextChain } from "@nexsidi/db";
import { eq, and, desc } from "drizzle-orm";
import { hashContext } from "@nexsidi/context-chain";
import { filterSourceManifest, buildStage4Result } from "./activities/index.ts";

const projectId = "simple1";
const rows = await db
  .select({ contextHash: contextChain.contextHash, createdAt: contextChain.createdAt })
  .from(contextChain)
  .where(and(eq(contextChain.projectId, projectId), eq(contextChain.agentFrom, "qa-gan"), eq(contextChain.agentTo, "deploy")))
  .orderBy(desc(contextChain.createdAt))
  .limit(5);
console.log("recorded rows:", JSON.stringify(rows, null, 2));

const stage4Result = buildStage4Result(projectId);
const manifest = filterSourceManifest(stage4Result);
console.log("current filesWritten count:", manifest.filesWritten.length);
console.log("current hash:", hashContext(manifest));
process.exit(0);
