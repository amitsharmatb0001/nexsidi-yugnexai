import { readFileSync } from "node:fs";
import { runFix } from "../agents/generators/shubham/src/index.ts";
import type { BuildPlan } from "../agents/arjun/src/index.ts";

const plan: BuildPlan = JSON.parse(
  readFileSync("E:/tmp/nexsidi-builds/meridianbk4/build-plan.json", "utf-8"),
);

const finding =
  "backend/src/routes/index.ts: API route mounting mismatches the API contract and frontend client calls in frontend/lib/api.ts. " +
  "appointmentRouter is mounted at '/appointment' instead of '/appointments' (line 9), and catalogRouter is mounted at '/catalog' " +
  "(line 11), creating endpoints at '/api/v1/catalog/services' and '/api/v1/catalog/products' instead of '/api/v1/services' and " +
  "'/api/v1/products'. When clients request GET /api/v1/services, GET /api/v1/products, or GET/POST /api/v1/appointments, Express " +
  "fails route matching and returns a 404 Not Found error on these core application paths.";

console.log("[force-fix] invoking Shubham's real runFix() against the confirmed-still-broken route mismatch...");
const result = await runFix(plan, [finding]);
console.log(`[force-fix] result: success=${result.success} filesWritten=${JSON.stringify(result.filesWritten)}`);
if (result.errors.length > 0) {
  console.log(`[force-fix] errors: ${JSON.stringify(result.errors)}`);
}
