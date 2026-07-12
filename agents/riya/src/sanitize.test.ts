import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeGeneratedPackageJsons } from "./index.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "riya-sanitize-"));
  mkdirSync(join(dir, "frontend"), { recursive: true });
  mkdirSync(join(dir, "backend"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writePkg(svc: string, pkg: unknown) {
  writeFileSync(join(dir, svc, "package.json"), JSON.stringify(pkg, null, 2));
}
function readPkg(svc: string): any {
  return JSON.parse(readFileSync(join(dir, svc, "package.json"), "utf-8"));
}

test("removes a parent-referential file:.. dependency (the real deploy blocker)", () => {
  writePkg("frontend", {
    name: "proj-frontend",
    dependencies: { next: "^16.2.0", "my-proj": "file:..", "@yugnex/nexui": "file:./vendor/nexui" },
  });
  sanitizeGeneratedPackageJsons(dir);
  const deps = readPkg("frontend").dependencies;
  expect(deps["my-proj"]).toBeUndefined();       // parent ref removed
  expect(deps["next"]).toBe("^16.2.0");           // normal dep kept
  expect(deps["@yugnex/nexui"]).toBe("file:./vendor/nexui"); // in-context file: dep kept
});

test("keeps in-context file: deps and normal deps untouched", () => {
  writePkg("backend", { dependencies: { express: "^4.0.0", local: "file:./pkgs/local" } });
  sanitizeGeneratedPackageJsons(dir);
  const deps = readPkg("backend").dependencies;
  expect(deps["express"]).toBe("^4.0.0");
  expect(deps["local"]).toBe("file:./pkgs/local");
});

test("also strips file:../.. deeper parent refs from devDependencies", () => {
  writePkg("frontend", { devDependencies: { x: "file:../../shared" }, dependencies: {} });
  sanitizeGeneratedPackageJsons(dir);
  expect(readPkg("frontend").devDependencies["x"]).toBeUndefined();
});

test("is fail-safe on a missing or malformed package.json (no throw)", () => {
  writeFileSync(join(dir, "frontend", "package.json"), "{ not valid json");
  // backend has none at all
  expect(() => sanitizeGeneratedPackageJsons(dir)).not.toThrow();
});
