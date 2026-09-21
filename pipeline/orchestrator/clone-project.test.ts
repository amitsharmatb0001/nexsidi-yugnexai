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
  expect(compose).toContain('"3301:3000"');
  expect(compose).toContain('"3402:3001"');
  expect(compose).toContain('"5538:5432"');
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
