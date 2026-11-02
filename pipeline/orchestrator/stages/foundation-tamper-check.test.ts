import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendFoundationFiles, writeFoundation } from "../../../packages/foundation/src/index.ts";
import { foundationTamperFindings } from "./foundation-tamper-check.ts";

// 2026-11-02 (Brewline 7): the write guard kept the builder out of the tested CORS file, so it changed the setting while the app
// runs: "(config as any).corsOrigin = ..." in its own routes file. The files stayed as written and every check passed. By fact,
// from the code: a builder's file may use what a tested file exports, and may not change it.
let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function app(code: string, name = "src/routes/index.ts"): string {
  root = mkdtempSync(join(tmpdir(), "tamper-"));
  const dir = join(root, "backend");
  writeFoundation(dir, backendFoundationFiles({ auth: null }));
  mkdirSync(join(dir, "src/routes"), { recursive: true });
  writeFileSync(join(dir, name), code);
  return dir;
}

const changes: Array<[string, string]> = [
  ["a plain assignment", 'import { config } from "../config";\nconfig.corsOrigin = "x";'],
  ["through a cast (Brewline 7)", 'import { config } from "../config";\n(config as any).corsOrigin = "x";'],
  ["through a named copy", 'import { config } from "../config";\nconst c = config as any;\nc.corsOrigin = "x";'],
  ["with square brackets", 'import { config } from "../config";\nconfig["corsOrigin"] = "x";'],
  ["with Object.assign", 'import { config } from "../config";\nObject.assign(config, { corsOrigin: "x" });'],
  ["with Object.defineProperty", 'import { config } from "../config";\nObject.defineProperty(config, "corsOrigin", { value: "x" });'],
  ["with delete", 'import { config } from "../config";\ndelete (config as any).corsOrigin;'],
  ["under another name", 'import { config as settings } from "../config";\n(settings as any).corsOrigin = "x";'],
];

for (const [how, code] of changes) {
  test("changing a tested setting is found: " + how, () => {
    const found = foundationTamperFindings(app(code));
    expect(found.length).toBe(1);
    expect(found[0]).toContain("src/routes/index.ts");
  });
}

test("using a tested setting is not a change", () => {
  const code = 'import { config } from "../config";\nconst a = config.corsOrigin;\nconst c = { ...config };\nc.corsOrigin = "x";\nexport const b = a.split(",");\nlet port = config.port;\nport = 1;\nexport { port };';
  expect(foundationTamperFindings(app(code))).toEqual([]);
});

test("the builder's own settings are its own", () => {
  const code = 'import { config } from "./mine";\n(config as any).corsOrigin = "x";';
  expect(foundationTamperFindings(app(code))).toEqual([]);
});

test("a build with no tested files has nothing to check", () => {
  root = mkdtempSync(join(tmpdir(), "tamper-"));
  expect(foundationTamperFindings(join(root, "backend"))).toEqual([]);
});
