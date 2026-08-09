import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoWireRoutes } from "./index.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shubham-autowire-"));
  mkdirSync(join(dir, "src", "routes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function routesIndex(): string {
  return readFileSync(join(dir, "src", "routes", "index.ts"), "utf-8");
}

test("mounts a single tasks route file at /tasks with a default import", () => {
  writeFileSync(join(dir, "src", "routes", "tasks.routes.ts"), "export default {};");
  writeFileSync(join(dir, "src", "routes", "index.ts"), "import { Router } from \"express\";\nexport default Router();");
  autoWireRoutes(dir);
  const idx = routesIndex();
  expect(idx).toContain('import tasksRouter from "./tasks.routes";');
  expect(idx).toContain('router.use("/tasks", tasksRouter);');
  expect(idx).toContain("export default router;");
  expect(idx).not.toBe("import { Router } from \"express\";\nexport default Router();"); // placeholder replaced
});

test("mounts multiple resource routers", () => {
  for (const r of ["tasks", "projects", "users"]) writeFileSync(join(dir, "src", "routes", `${r}.routes.ts`), "export default {};");
  autoWireRoutes(dir);
  const idx = routesIndex();
  for (const r of ["tasks", "projects", "users"]) {
    expect(idx).toContain(`import ${r}Router from "./${r}.routes";`);
    expect(idx).toContain(`router.use("/${r}", ${r}Router);`);
  }
});

test("leaves things alone when there are no route files", () => {
  autoWireRoutes(dir); // no *.routes.ts, no index.ts
  // should not throw and should not create an index (nothing to wire)
  expect(() => autoWireRoutes(dir)).not.toThrow();
});

test("is fail-safe when the routes dir does not exist", () => {
  rmSync(join(dir, "src"), { recursive: true, force: true });
  expect(() => autoWireRoutes(dir)).not.toThrow();
});

// 2026-08-09: real bug found live (project meridianbk4) — QA (Navya) kept
// flagging the same route-mismatch finding (backend mounted "/appointment"
// singular, frontend/contract expected plural "/appointments") because
// Shubham's fix loop hand-edits the mount path in routes/index.ts, verifies
// it live, calls task_complete — and then runFix() unconditionally called
// autoWireRoutes AGAIN, which mechanically re-derives every mount path from
// the *.routes.ts filename and silently reverted the fix every single time.
// Confirmed live: 3 consecutive "verified: true" fix passes, same finding
// re-flagged 3 times. autoWireRoutes must leave already-wired route files
// alone — its job is only to wire in a route file that was never mounted at
// all (the original bug this function fixed), not to enforce one specific
// mount-path convention forever.
test("does not revert a hand-tuned mount path when the route file is already wired", () => {
  writeFileSync(join(dir, "src", "routes", "appointment.routes.ts"), "export default {};");
  writeFileSync(
    join(dir, "src", "routes", "index.ts"),
    'import { Router } from "express";\nimport appointmentRouter from "./appointment.routes";\n\nconst router = Router();\n\nrouter.use("/appointments", appointmentRouter);\n\nexport default router;\n'
  );
  autoWireRoutes(dir);
  const idx = routesIndex();
  expect(idx).toContain('router.use("/appointments", appointmentRouter);');
  expect(idx).not.toContain('router.use("/appointment", appointmentRouter);');
});

test("still wires in a genuinely new route file even when others are already hand-tuned", () => {
  writeFileSync(join(dir, "src", "routes", "appointment.routes.ts"), "export default {};");
  writeFileSync(join(dir, "src", "routes", "catalog.routes.ts"), "export default {};");
  writeFileSync(
    join(dir, "src", "routes", "index.ts"),
    'import { Router } from "express";\nimport appointmentRouter from "./appointment.routes";\n\nconst router = Router();\n\nrouter.use("/appointments", appointmentRouter);\n\nexport default router;\n'
  );
  autoWireRoutes(dir);
  const idx = routesIndex();
  expect(idx).toContain('import catalogRouter from "./catalog.routes";');
  expect(idx).toContain('router.use("/catalog", catalogRouter);');
});
