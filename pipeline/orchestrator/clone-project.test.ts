import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneProject, renameInFile, rewriteComposePorts, parseComposePorts } from "./clone-project.ts";

// ── renameInFile ─────────────────────────────────────────────────────────
test("renameInFile replaces every occurrence of the literal name", () => {
  const content = "© 2026 Clario AI. All rights reserved.\n<title>Clario AI</title>";
  const result = renameInFile(content, "Clario AI", "Beacon Labs");
  expect(result).toBe("© 2026 Beacon Labs. All rights reserved.\n<title>Beacon Labs</title>");
});

test("renameInFile escapes regex metacharacters in the old name — a real company name is not a pattern", () => {
  const content = "Welcome to R&D Co. — R&D Co. builds things.";
  const result = renameInFile(content, "R&D Co.", "NewCo");
  expect(result).toBe("Welcome to NewCo — NewCo builds things.");
});

test("renameInFile leaves content unchanged when the name doesn't appear", () => {
  const content = "Some unrelated text.";
  expect(renameInFile(content, "Clario AI", "Beacon Labs")).toBe(content);
});

test("renameInFile also replaces a hardcoded ALL-CAPS wordmark — real bug found live cloning Gatherly, whose Navbar literally reads 'GATHERLY' rather than computing it from the name", () => {
  const content = '<Link className={logoClass}>\n  GATHERLY\n</Link>';
  const result = renameInFile(content, "Gatherly", "DropCircle");
  expect(result).toContain("DROPCIRCLE");
  expect(result).not.toContain("GATHERLY");
});

test("renameInFile does not double-transform a name that's already all-caps to begin with", () => {
  const content = "Welcome to ACME. ACME builds things.";
  const result = renameInFile(content, "ACME", "Beacon Labs");
  expect(result).toBe("Welcome to Beacon Labs. Beacon Labs builds things.");
});

// ── rewriteComposePorts ──────────────────────────────────────────────────
test("rewriteComposePorts swaps all 3 host ports and every localhost:PORT reference", () => {
  const compose = `services:
  postgres:
    ports:
      - "5437:5432"
  backend:
    environment:
      CORS_ORIGIN: http://localhost:3200
    ports:
      - "3301:3001"
  frontend:
    build:
      args:
        NEXT_PUBLIC_API_URL: http://localhost:3301
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3301
    ports:
      - "3200:3000"
`;
  const result = rewriteComposePorts(
    compose,
    { frontendPort: 3200, backendPort: 3301, dbPort: 5437 },
    { frontendPort: 3206, backendPort: 3306, dbPort: 5441 },
  );
  expect(result).toContain('"5441:5432"');
  expect(result).toContain('"3306:3001"');
  expect(result).toContain('"3206:3000"');
  expect(result).toContain("http://localhost:3306");
  expect(result).not.toContain("3301");
  expect(result).not.toContain("5437");
  expect(result).not.toContain('"3200:');
});

// ── parseComposePorts ────────────────────────────────────────────────────
test("parseComposePorts reads the configured ports regardless of running state — the real Clario AI shape", () => {
  const compose = `version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5437:5432"

  backend:
    build:
      context: ./backend
    ports:
      - "3301:3001"

  frontend:
    build:
      context: ./frontend
    ports:
      - "3200:3000"
`;
  expect(parseComposePorts(compose)).toEqual({ frontendPort: 3200, backendPort: 3301, dbPort: 5437 });
});

test("parseComposePorts reads the 127.0.0.1-bound form new deploys write (2026-09-26)", () => {
  const compose = `services:\n  postgres:\n    ports:\n      - "127.0.0.1:5437:5432"\n  backend:\n    ports:\n      - "127.0.0.1:3301:3001"\n  frontend:\n    ports:\n      - "127.0.0.1:3200:3000"\n`;
  expect(parseComposePorts(compose)).toEqual({ frontendPort: 3200, backendPort: 3301, dbPort: 5437 });
});

test("rewriteComposePorts swaps 127.0.0.1-bound host ports, keeps the prefix, and survives a new port equal to another service's old port", () => {
  const compose = `services:\n  postgres:\n    ports:\n      - "127.0.0.1:5437:5432"\n  backend:\n    environment:\n      CORS_ORIGIN: http://localhost:3200\n    ports:\n      - "127.0.0.1:3301:3001"\n  frontend:\n    environment:\n      NEXT_PUBLIC_API_URL: http://localhost:3301\n    ports:\n      - "127.0.0.1:3200:3000"\n`;
  const result = rewriteComposePorts(
    compose,
    { frontendPort: 3200, backendPort: 3301, dbPort: 5437 },
    { frontendPort: 3301, backendPort: 3402, dbPort: 5538 }, // new frontend == old backend
  );
  expect(result).toContain('"127.0.0.1:5538:5432"');
  expect(result).toContain('"127.0.0.1:3402:3001"');
  expect(result).toContain('"127.0.0.1:3301:3000"');
  expect(result).toContain("NEXT_PUBLIC_API_URL: http://localhost:3402");
  expect(result).toContain("CORS_ORIGIN: http://localhost:3301");
  expect(result).not.toContain("5437");
});

test("parseComposePorts returns null when a service is missing rather than guessing", () => {
  const compose = `services:\n  postgres:\n    ports:\n      - "5437:5432"\n`;
  expect(parseComposePorts(compose)).toBeNull();
});

// ── cloneProject (real filesystem, real temp dir) ───────────────────────
let tempBuildDir: string | null = null;
afterEach(() => {
  if (tempBuildDir) rmSync(tempBuildDir, { recursive: true, force: true });
  tempBuildDir = null;
});

function makeFixtureSource(buildDir: string, projectId: string): void {
  const dir = join(buildDir, projectId);
  mkdirSync(join(dir, "frontend", "app"), { recursive: true });
  mkdirSync(join(dir, "frontend", "node_modules", "some-pkg"), { recursive: true });
  writeFileSync(join(dir, "frontend", "node_modules", "some-pkg", "index.js"), "should not be copied");
  writeFileSync(join(dir, "frontend", "app", "page.tsx"), `export default function Home() { return <p>Welcome to Acme Co</p>; }`);
  writeFileSync(join(dir, "frontend", "package.json"), JSON.stringify({ name: `${projectId}-frontend` }));
  writeFileSync(
    join(dir, "frontend", "app", "layout.tsx"),
    `import { createTheme } from "@yugnex/core";\nconst projectTheme = createTheme({\n  "light": { "primary": "#FF3B00", "ring": "#FF3B00", "primaryForeground": "#ffffff" },\n  "dark": { "primary": "#FF3B00", "ring": "#FF3B00", "primaryForeground": "#ffffff" }\n});\n`,
  );
  writeFileSync(
    join(dir, "docker-compose.yml"),
    `services:\n  postgres:\n    ports:\n      - "5437:5432"\n  backend:\n    ports:\n      - "3301:3001"\n    environment:\n      CORS_ORIGIN: http://localhost:3200\n  frontend:\n    ports:\n      - "3200:3000"\n    environment:\n      NEXT_PUBLIC_API_URL: http://localhost:3301\n`,
  );
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ projectId, name: "Acme Co", description: "Acme Co builds things." }, null, 2));
}

test("cloneProject copies real files, skips node_modules, and renames the source directory to the new projectId", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source1");

  const result = await cloneProject(
    { sourceProjectId: "source1", newProjectId: "clone1", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir },
    { findFreePort: async (start) => start }, // deterministic — always the first candidate in each range
  );

  expect(result.newProjectId).toBe("clone1");
  expect(existsSync(join(tempBuildDir, "clone1", "frontend", "app", "page.tsx"))).toBe(true);
  // node_modules must NOT be copied — the Dockerfile's own install step regenerates it
  expect(existsSync(join(tempBuildDir, "clone1", "frontend", "node_modules"))).toBe(false);
  // source untouched
  expect(existsSync(join(tempBuildDir, "source1", "frontend", "node_modules"))).toBe(true);
});

test("cloneProject renames the company name throughout the copied source, not just spec.json", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source2");

  await cloneProject(
    { sourceProjectId: "source2", newProjectId: "clone2", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir },
    { findFreePort: async (start) => start },
  );

  const page = readFileSync(join(tempBuildDir, "clone2", "frontend", "app", "page.tsx"), "utf-8");
  expect(page).toContain("Beacon Labs");
  expect(page).not.toContain("Acme Co");
});

test("cloneProject updates spec.json's projectId and name fields", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source3");

  await cloneProject(
    { sourceProjectId: "source3", newProjectId: "clone3", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir },
    { findFreePort: async (start) => start },
  );

  const spec = JSON.parse(readFileSync(join(tempBuildDir, "clone3", "spec.json"), "utf-8"));
  expect(spec.projectId).toBe("clone3");
  expect(spec.name).toBe("Beacon Labs");
  expect(spec.description).toContain("Beacon Labs");
});

test("cloneProject assigns fresh ports and rewrites docker-compose.yml to use them", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source4");

  const result = await cloneProject(
    { sourceProjectId: "source4", newProjectId: "clone4", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir },
    { findFreePort: async (start) => start + 100 }, // simulate "the +1 candidate was taken, next free one is +100"
  );

  expect(result.ports).toEqual({ frontendPort: 3301, backendPort: 3402, dbPort: 5538 });
  const compose = readFileSync(join(tempBuildDir, "clone4", "docker-compose.yml"), "utf-8");
  // 2026-09-26: clones are also bound to this PC only (see the next test).
  expect(compose).toContain('"127.0.0.1:3301:3000"');
  expect(compose).toContain('"127.0.0.1:3402:3001"');
  expect(compose).toContain('"127.0.0.1:5538:5432"');
});

// 2026-09-26 security fix: generated apps published every port on 0.0.0.0
// (reachable from the whole Wi-Fi). Existing projects still have that form,
// so a clone of one must come out bound to 127.0.0.1 regardless.
test("cloneProject binds every published port to 127.0.0.1 even when the source was published on all interfaces", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source9"); // plain "HOST:CONTAINER" form, like every existing project

  const result = await cloneProject(
    { sourceProjectId: "source9", newProjectId: "clone9", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir },
    { findFreePort: async (start) => start },
  );

  const compose = readFileSync(join(tempBuildDir, "clone9", "docker-compose.yml"), "utf-8");
  expect(compose).toContain(`"127.0.0.1:${result.ports.frontendPort}:3000"`);
  expect(compose).toContain(`"127.0.0.1:${result.ports.backendPort}:3001"`);
  expect(compose).toContain(`"127.0.0.1:${result.ports.dbPort}:5432"`);
  expect(compose).not.toMatch(/-\s*"\d+:\d+"/); // no entry left published on all interfaces
  expect(parseComposePorts(compose)).toEqual(result.ports);
});

test("cloneProject refuses a source whose compose has a port it cannot bind to 127.0.0.1 — before copying anything", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source10");
  const sourceCompose = join(tempBuildDir, "source10", "docker-compose.yml");
  writeFileSync(sourceCompose, readFileSync(sourceCompose, "utf-8") + `  adminer:\n    ports:\n      - "8080"\n`);

  await expect(
    cloneProject(
      { sourceProjectId: "source10", newProjectId: "clone10", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir },
      { findFreePort: async (start) => start },
    ),
  ).rejects.toThrow("cannot be bound to 127.0.0.1");
  expect(existsSync(join(tempBuildDir, "clone10"))).toBe(false); // no half-made clone left behind
});

test("cloneProject always varies the accent color, even with no LLM changes requested — two clones must never look identical", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source7");

  const result = await cloneProject(
    { sourceProjectId: "source7", newProjectId: "clone7", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir },
    { findFreePort: async (start) => start },
  );

  expect(result.theme.applied).toBe(true);
  expect(result.theme.newAccent).toBeDefined();
  expect(result.theme.newAccent!.toLowerCase()).not.toBe("#ff3b00"); // the fixture's own source accent

  const layout = readFileSync(join(tempBuildDir, "clone7", "frontend", "app", "layout.tsx"), "utf-8");
  expect(layout).toContain(`"primary": "${result.theme.newAccent}"`);
});

test("cloneProject throws (does not silently no-op) when the source project doesn't exist", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  await expect(
    cloneProject({ sourceProjectId: "does-not-exist", newProjectId: "clone5", oldName: "X", newName: "Y", sourcePorts: { frontendPort: 1, backendPort: 2, dbPort: 3 }, buildDir: tempBuildDir }),
  ).rejects.toThrow(/not found/);
});

test("cloneProject refuses to overwrite an existing destination rather than silently clobbering it", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeFixtureSource(tempBuildDir, "source6");
  makeFixtureSource(tempBuildDir, "clone6"); // destination already has something real in it

  await expect(
    cloneProject({ sourceProjectId: "source6", newProjectId: "clone6", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempBuildDir }),
  ).rejects.toThrow(/already exists/);
});

// ── Vendored packages (2026-09-27) ───────────────────────────────────────
// Real bug found live: a clone of NexTech (88d7b375eaef) failed `npm run
// build` with "Can't resolve '@yugnex/nexui-react'". Older NexUI-era
// projects depend on "file:./vendor/nexui-react", whose "main" is
// ./dist/index.js, and the copy skipped every dist/ at every level. dist/ is
// build output at the app level (backend/dist) but IS the package inside a
// vendored one.
function makeVendoredSource(buildDir: string, projectId: string): string {
  makeFixtureSource(buildDir, projectId);
  const fe = join(buildDir, projectId, "frontend");
  writeFileSync(
    join(fe, "package.json"),
    JSON.stringify({
      name: `${projectId}-frontend`,
      dependencies: { "@yugnex/nexui": "file:./vendor/nexui", "@yugnex/nexui-react": "file:./vendor/nexui-react", "@acme/ui": "file:./packages/ui" },
    }),
  );
  for (const pkg of ["vendor/nexui", "vendor/nexui-react", "packages/ui"]) {
    mkdirSync(join(fe, pkg, "dist"), { recursive: true });
    mkdirSync(join(fe, pkg, "src"), { recursive: true });
    writeFileSync(join(fe, pkg, "package.json"), JSON.stringify({ name: pkg, main: "./dist/index.js" }));
    writeFileSync(join(fe, pkg, "dist", "index.js"), `export const lib = "${pkg}";`);
    // Library code that happens to contain the project's name — must NOT be renamed.
    writeFileSync(join(fe, pkg, "dist", "index.d.ts"), `/** Example: <Card title="Acme Co" /> */ export declare const lib: string;`);
    writeFileSync(join(fe, pkg, "src", "index.ts"), `// Example: <Card title="Acme Co" />\nexport const lib = "${pkg}";`);
  }
  mkdirSync(join(fe, "vendor", "nexui-react", "node_modules", "react"), { recursive: true });
  writeFileSync(join(fe, "vendor", "nexui-react", "node_modules", "react", "index.js"), "should not be copied");
  mkdirSync(join(fe, "dist"), { recursive: true });
  writeFileSync(join(fe, "dist", "stale.js"), "app-level build output, should not be copied");
  mkdirSync(join(buildDir, projectId, "backend", "dist"), { recursive: true });
  writeFileSync(join(buildDir, projectId, "backend", "dist", "index.js"), "app-level build output, should not be copied");
  return fe;
}

async function cloneVendored(buildDir: string, sourceId: string, cloneId: string) {
  return cloneProject(
    { sourceProjectId: sourceId, newProjectId: cloneId, oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir },
    { findFreePort: async (start) => start },
  );
}

test("cloneProject copies dist/ inside vendored packages but still skips app-level dist/ and node_modules", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  const srcFe = makeVendoredSource(tempBuildDir, "source11");
  await cloneVendored(tempBuildDir, "source11", "clone11");
  const fe = join(tempBuildDir, "clone11", "frontend");

  expect(readFileSync(join(fe, "vendor", "nexui-react", "dist", "index.js"), "utf-8")).toBe(readFileSync(join(srcFe, "vendor", "nexui-react", "dist", "index.js"), "utf-8"));
  expect(existsSync(join(fe, "vendor", "nexui", "dist", "index.js"))).toBe(true);
  expect(existsSync(join(tempBuildDir, "clone11", "backend", "dist"))).toBe(false);
  expect(existsSync(join(fe, "dist"))).toBe(false);
  expect(existsSync(join(fe, "vendor", "nexui-react", "node_modules"))).toBe(false);
});

test("cloneProject copies dist/ of a file: dependency outside vendor/ too", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeVendoredSource(tempBuildDir, "source12");
  await cloneVendored(tempBuildDir, "source12", "clone12");
  expect(existsSync(join(tempBuildDir, "clone12", "frontend", "packages", "ui", "dist", "index.js"))).toBe(true);
});

test("cloneProject renames the app but never rewrites vendored library code", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  const srcFe = makeVendoredSource(tempBuildDir, "source13");
  await cloneVendored(tempBuildDir, "source13", "clone13");
  const fe = join(tempBuildDir, "clone13", "frontend");

  expect(readFileSync(join(fe, "app", "page.tsx"), "utf-8")).toContain("Beacon Labs"); // app still renamed
  for (const file of ["vendor/nexui-react/dist/index.d.ts", "vendor/nexui/src/index.ts", "packages/ui/src/index.ts"]) {
    expect(readFileSync(join(fe, file), "utf-8")).toBe(readFileSync(join(srcFe, file), "utf-8"));
  }
});

// ── Express Build: no trace of the source project (2026-09-27) ──────────
// Real finding: a clone carried the source's agent histories, logs and QA
// notes, kept the source's project id in package.json/package-lock.json,
// and kept the source customer's own request as user-request.txt. A
// customer must not be able to tell their project started from another.
import { readdirSync as readdirForTrace, statSync as statForTrace } from "node:fs";

function allFiles(dir: string): string[] {
  return readdirForTrace(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statForTrace(full).isDirectory() ? allFiles(full) : [full];
  });
}

function makeSourceWithTraces(buildDir: string, projectId: string): void {
  makeFixtureSource(buildDir, projectId);
  const dir = join(buildDir, projectId);
  writeFileSync(join(dir, "history-tilotma-reality-checker.json"), JSON.stringify([{ role: "system", content: "internal prompt" }]));
  writeFileSync(join(dir, "qa-submissions.json"), "[]");
  writeFileSync(join(dir, "planner-plan.json"), "{}");
  mkdirSync(join(dir, "logs"), { recursive: true });
  writeFileSync(join(dir, "logs", "pipeline.log"), "internal log");
  writeFileSync(join(dir, "user-request.txt"), "Acme Co needs a site for our confidential product launch in March.");
  mkdirSync(join(dir, "backend"), { recursive: true });
  writeFileSync(join(dir, "backend", "package.json"), JSON.stringify({ name: `${projectId}-backend` }));
  writeFileSync(join(dir, "backend", "package-lock.json"), JSON.stringify({ name: `${projectId}-backend`, packages: { "": { name: `${projectId}-backend` } } }));
}

async function expressFrom(buildDir: string, sourceId: string, newId: string, extra: { requestText?: string } = {}) {
  return cloneProject(
    { sourceProjectId: sourceId, newProjectId: newId, oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir, ...extra },
    { findFreePort: async (start) => start },
  );
}

test("an Express Build never copies the source's pipeline files (histories, logs, QA notes)", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeSourceWithTraces(tempBuildDir, "srcaaa000001");
  await expressFrom(tempBuildDir, "srcaaa000001", "newbbb000002");
  const dir = join(tempBuildDir, "newbbb000002");
  for (const f of ["history-tilotma-reality-checker.json", "qa-submissions.json", "planner-plan.json", "logs"]) {
    expect(existsSync(join(dir, f))).toBe(false);
  }
});

test("an Express Build leaves no trace of the source project's id anywhere in the new project", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeSourceWithTraces(tempBuildDir, "srcaaa000001");
  await expressFrom(tempBuildDir, "srcaaa000001", "newbbb000002");
  const dir = join(tempBuildDir, "newbbb000002");
  const withSourceId = allFiles(dir).filter((f) => readFileSync(f, "utf-8").includes("srcaaa000001"));
  expect(withSourceId).toEqual([]);
  expect(JSON.parse(readFileSync(join(dir, "backend", "package.json"), "utf-8")).name).toBe("newbbb000002-backend");
});

test("an Express Build writes the new project's own request, never the source customer's", async () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-clone-test-"));
  makeSourceWithTraces(tempBuildDir, "srcaaa000001");
  await expressFrom(tempBuildDir, "srcaaa000001", "newbbb000002", { requestText: "Beacon Labs: a site for our lighthouse tours." });
  expect(readFileSync(join(tempBuildDir, "newbbb000002", "user-request.txt"), "utf-8")).toBe("Beacon Labs: a site for our lighthouse tours.");

  await expressFrom(tempBuildDir, "srcaaa000001", "newccc000003"); // no request text: name + the site's own description
  const fallback = readFileSync(join(tempBuildDir, "newccc000003", "user-request.txt"), "utf-8");
  expect(fallback).toStartWith("Beacon Labs");
  expect(fallback).not.toContain("confidential product launch");
});
