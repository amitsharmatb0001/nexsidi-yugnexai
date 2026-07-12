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
