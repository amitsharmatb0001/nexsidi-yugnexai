import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneProject } from "./clone-project.ts";
import { pruneUnusedComponents } from "./prune-unused.ts";
import { preferOriginals } from "./clone-source-picker.ts";
import { lineageOf, recordLineage, isClone } from "./clone-lineage.ts";

let tempDir: string | null = null;
afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

// 2026-10-15 (Shopbill run 10): Automatic chose an earlier clone as the base. That clone's own source name
// ("Ledgerly") was still in its code, and the new project only knew to rename the clone's immediate name.
function makeCloneOfClone(buildDir: string, id: string): void {
  const dir = join(buildDir, id);
  mkdirSync(join(dir, "frontend", "app"), { recursive: true });
  mkdirSync(join(dir, "backend", "src", "config"), { recursive: true });
  writeFileSync(join(dir, "frontend", "app", "page.tsx"), "export default function P() { return <p>Welcome to Acme Co</p>; }\n");
  writeFileSync(join(dir, "backend", "src", "config", "db.ts"), 'export const DB = process.env.DB_NAME || "legacyco";\n');
  writeFileSync(join(dir, "frontend", "marketing.ts"), "export const rows = [{ legacyco: 'exact to the paisa' }];\n");
  writeFileSync(join(dir, "docker-compose.yml"), 'services:\n  frontend:\n    ports:\n      - "3200:3000"\n  backend:\n    ports:\n      - "3301:3001"\n  postgres:\n    ports:\n      - "5437:5432"\n');
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ projectId: id, name: "Acme Co", description: "d" }, null, 2));
  // Who this app was copied from lives beside the builds, never inside the app a customer receives.
  recordLineage(buildDir, id, { clonedFrom: "origin000001", priorNames: ["Legacy Co"] });
}

test("a clone also renames every name its source inherited, and records its own lineage", async () => {
  tempDir = mkdtempSync(join(tmpdir(), "nexsidi-lineage-"));
  makeCloneOfClone(tempDir, "srcaaa000001");
  await cloneProject(
    { sourceProjectId: "srcaaa000001", newProjectId: "newbbb000002", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempDir },
    { findFreePort: async (s) => s },
  );
  const dir = join(tempDir, "newbbb000002");
  const stale = allFiles(dir).filter((f) => /legacy ?co/i.test(readFileSync(f, "utf-8")));
  expect(stale).toEqual([]);
  expect(readFileSync(join(dir, "backend", "src", "config", "db.ts"), "utf-8")).toContain('"beaconlabs"');
  expect(lineageOf(tempDir, "newbbb000002")).toEqual({ clonedFrom: "srcaaa000001", priorNames: ["Legacy Co", "Acme Co"] });
  expect(isClone(tempDir, "newbbb000002")).toBe(true);
  // ...and nothing about it is written into the new app.
  expect(allFiles(dir).filter((f) => /srcaaa000001|origin000001/.test(readFileSync(f, "utf-8")))).toEqual([]);
});

test("a clone of an original (no lineage yet) records the original's name", async () => {
  tempDir = mkdtempSync(join(tmpdir(), "nexsidi-lineage-"));
  makeCloneOfClone(tempDir, "srcaaa000001");
  writeFileSync(join(tempDir, ".lineage.json"), "{}");
  expect(isClone(tempDir, "srcaaa000001")).toBe(false);
  await cloneProject(
    { sourceProjectId: "srcaaa000001", newProjectId: "newbbb000002", oldName: "Acme Co", newName: "Beacon Labs", sourcePorts: { frontendPort: 3200, backendPort: 3301, dbPort: 5437 }, buildDir: tempDir },
    { findFreePort: async (s) => s },
  );
  expect(lineageOf(tempDir, "newbbb000002")?.priorNames).toEqual(["Acme Co"]);
});

// ── pruneUnusedComponents ─────────────────────────────────────────────────
// 2026-10-15: the removed comparison section's component was still in the delivered app, imported by nothing.
function makeFrontend(root: string): string {
  const fe = join(root, "frontend");
  mkdirSync(join(fe, "app"), { recursive: true });
  mkdirSync(join(fe, "components", "marketing"), { recursive: true });
  mkdirSync(join(fe, "components", "nexui"), { recursive: true });
  mkdirSync(join(fe, "lib"), { recursive: true });
  writeFileSync(join(fe, "app", "page.tsx"), 'import { Hero } from "@/components/marketing/Hero";\nimport { fmt } from "@/lib/format";\nexport default function P() { return <Hero />; }\n');
  writeFileSync(join(fe, "components", "marketing", "Hero.tsx"), 'import { Badge } from "./Badge";\nexport function Hero() { return <Badge />; }\n');
  writeFileSync(join(fe, "components", "marketing", "Badge.tsx"), "export function Badge() { return null; }\n");
  writeFileSync(join(fe, "components", "marketing", "ComparisonSection.tsx"), "export function ComparisonSection() { return null; }\n");
  writeFileSync(join(fe, "components", "nexui", "unused-kit-part.tsx"), "export const K = 1;\n");
  writeFileSync(join(fe, "lib", "format.ts"), 'import { Money } from "@/components/marketing/Money";\nexport const fmt = Money;\n');
  writeFileSync(join(fe, "components", "marketing", "Money.tsx"), "export const Money = 1;\n");
  return fe;
}

test("pruneUnusedComponents removes components nothing imports, and reports them", async () => {
  tempDir = mkdtempSync(join(tmpdir(), "nexsidi-prune-"));
  const fe = makeFrontend(tempDir);
  const removed = pruneUnusedComponents(fe);
  expect(removed).toEqual(["components/marketing/ComparisonSection.tsx"]);
  expect(existsSync(join(fe, "components", "marketing", "ComparisonSection.tsx"))).toBe(false);
});

test("pruneUnusedComponents keeps what the app reaches through nested imports, through lib/, and the UI kit", async () => {
  tempDir = mkdtempSync(join(tmpdir(), "nexsidi-prune-"));
  const fe = makeFrontend(tempDir);
  pruneUnusedComponents(fe);
  for (const kept of ["marketing/Hero.tsx", "marketing/Badge.tsx", "marketing/Money.tsx", "nexui/unused-kit-part.tsx"]) {
    expect(existsSync(join(fe, "components", kept))).toBe(true);
  }
});

test("pruneUnusedComponents keeps a file whose name is used somewhere, even when no import resolves", async () => {
  tempDir = mkdtempSync(join(tmpdir(), "nexsidi-prune-"));
  const fe = makeFrontend(tempDir);
  writeFileSync(join(fe, "lib", "registry.ts"), 'const m = require("components/marketing/ComparisonSection");\n');
  expect(pruneUnusedComponents(fe)).toEqual([]);
  expect(existsSync(join(fe, "components", "marketing", "ComparisonSection.tsx"))).toBe(true);
});

test("pruneUnusedComponents does nothing when there is no app/ folder", async () => {
  tempDir = mkdtempSync(join(tmpdir(), "nexsidi-prune-"));
  mkdirSync(join(tempDir, "components"), { recursive: true });
  writeFileSync(join(tempDir, "components", "A.tsx"), "export const A = 1;\n");
  expect(pruneUnusedComponents(tempDir)).toEqual([]);
  expect(existsSync(join(tempDir, "components", "A.tsx"))).toBe(true);
});

// ── a clone is not offered as a starting point while an original exists ────
test("preferOriginals drops clones from the candidates, and keeps all of them when only clones exist", () => {
  const cands = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const isClone = (id: string) => id !== "a";
  expect(preferOriginals(cands, isClone)).toEqual([{ id: "a" }]);
  expect(preferOriginals(cands, () => true)).toEqual(cands);
  expect(preferOriginals(cands, () => false)).toEqual(cands);
});
