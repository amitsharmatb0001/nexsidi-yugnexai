import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontendExitChecks, externalImageUrls, backendExitChecks } from "./builder-exit-checks.ts";

// 2026-10-24 (Brewline root cause): 8 emoji findings and the missing-colour findings were raised in review, after the
// frontend builder had said "done" — its instructions said "no emoji", and the checks existed, but they only ran later.
// Now the same checks run, by the system, when the builder says it is done (last phase and fix rounds); what they find
// is handed back to the builder first. No model call.

const prevBuildDir = process.env.BUILD_DIR;
let root = "";
afterEach(() => {
  if (prevBuildDir === undefined) delete process.env.BUILD_DIR;
  else process.env.BUILD_DIR = prevBuildDir;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function project(id: string, files: Record<string, string>, description: string): void {
  root = mkdtempSync(join(tmpdir(), "exit-checks-"));
  process.env.BUILD_DIR = root;
  const dir = join(root, id);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ description }));
}

const SPEC = "A coffee shop. Visual direction: soft oat cream #FAF6F0 backgrounds, espresso brown #2C1E18 typography, terracotta #D46A4E accents.";

test("emoji, a dead button and a spec colour missing from the theme are all reported before the builder may finish", () => {
  project("e1", {
    "frontend/app/menu/page.tsx": 'export default function M() { return <div><span>☕</span><button>Order</button></div>; }\n',
    "frontend/app/theme-overrides.css": ":root { --bg: #FAF6F0; --text: #2C1E18; }\n",
  }, SPEC);
  const out = frontendExitChecks("e1");
  expect(out.some((f) => f.includes("emoji"))).toBe(true);
  expect(out.some((f) => f.includes("dead UI"))).toBe(true);
  expect(out.some((f) => f.includes("#D46A4E"))).toBe(true);
  expect(out.some((f) => f.includes("#FAF6F0"))).toBe(false);
});

test("a clean frontend passes, and a spec without colours checks no colours", () => {
  project("e2", {
    "frontend/app/menu/page.tsx": 'export default function M() { return <button onClick={() => {}}>Order</button>; }\n',
    "frontend/app/theme-overrides.css": ":root { --bg: #faf6f0; --text: #2c1e18; --accent: #d46a4e; }\n",
  }, SPEC);
  expect(frontendExitChecks("e2")).toEqual([]);
  project("e3", { "frontend/app/page.tsx": "export default function P() { return null; }\n" }, "A plain site with no colours named.");
  expect(frontendExitChecks("e3")).toEqual([]);
});

test("the frontend builder runs these checks when it says it is done, in its last phase and in fix rounds", () => {
  const src = readFileSync(new URL("../../../agents/generators/aanya/src/index.ts", import.meta.url), "utf-8");
  expect((src.match(/exitChecks:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const loop = readFileSync(new URL(`../../../packages/agent-runtime/src/${file}`, import.meta.url), "utf-8");
    expect({ file, ok: loop.includes("config.exitChecks") }).toEqual({ file, ok: true });
  }
});

test("the backend builder's middle phases need a passing build, not a live check; the last phase keeps the full check", () => {
  const src = readFileSync(new URL("../../../agents/generators/shubham/src/index.ts", import.meta.url), "utf-8");
  expect(src).toContain('requiredEvidenceKinds: phase && !phase.isLast ? [] : ["http_check"]');
  const phases = readFileSync(new URL("../../activities/build-phases.ts", import.meta.url), "utf-8");
  expect(phases).not.toContain("test THIS phase's endpoints against your running API");
});


// 2026-10-24: generated apps hot-linked stock photos — on Trailhead a burger photo stood in for a sleeping bag, and the
// browser blocked others (net::err_blocked_by_orb). External image URLs in the frontend, the backend or the database
// seed files are now reported at the builder's "done"; a designed placeholder in the app, or no image, is used instead.
test("external image URLs are found in source and seed files; embedded images and app paths are not", () => {
  project("i1", {
    "frontend/components/GearCard.tsx": 'const src = "https://images.unsplash.com/photo-1568901346375?w=800"; const ok = "/images/tent.svg";\n',
    "frontend/components/Logo.tsx": 'const logo = "data:image/png;base64,iVBORw0KGgo"; const svg = "https://example.com/logo.png";\n',
    "backend/src/db/seed.ts": "image_url: 'https://picsum.photos/400/300'\n",
    "db/migrations/0001_seed.sql": "INSERT INTO gear (name, image_url) VALUES ('Tent', 'https://cdn.pixabay.com/photo/tent.jpg');\n",
  }, "A gear rental shop.");
  const front = externalImageUrls(join(root, "i1", "frontend"));
  expect(front.map((f) => f.url).sort()).toEqual(["https://example.com/logo.png", "https://images.unsplash.com/photo-1568901346375?w=800"]);
  const back = backendExitChecks("i1");
  expect(back.some((f) => f.includes("picsum.photos"))).toBe(true);
  expect(back.some((f) => f.includes("pixabay"))).toBe(true);
  expect(frontendExitChecks("i1").some((f) => f.includes("images.unsplash.com"))).toBe(true);
});

test("both builders are told the rule, and the backend lead runs the backend check", () => {
  const aanya = readFileSync(new URL("../../../packages/agent-runtime/skills/aanya/00-identity-and-visual-doctrine.md", import.meta.url), "utf-8");
  const shubham = readFileSync(new URL("../../../packages/agent-runtime/skills/shubham/20-critical-rules-and-verification.md", import.meta.url), "utf-8");
  expect(aanya).toContain("NO HOT-LINKED IMAGES");
  expect(shubham).toContain("NO HOT-LINKED IMAGES");
  const src = readFileSync(new URL("../../../agents/generators/shubham/src/index.ts", import.meta.url), "utf-8");
  expect(src).toContain("backendExitChecksFor(plan.projectId)");
});

// 2026-10-24 (Brewline): the footer's YugNex logo was a retyped copy of a 5,432-character encoded image and showed as a
// broken image. The system now puts the logo file in the app; the builder's check reports a footer logo that does not
// use that file, or a missing file.
test("a footer logo that is not the app's own logo file, or a missing logo file, is reported", () => {
  project("l1", {
    "frontend/components/layout/Footer.tsx": '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIkAAABgCAMAAAAes" alt="YugNex" width="69" height="48" />\n',
    "frontend/public/yugnex-logo.png": "png",
  }, "A coffee shop.");
  expect(frontendExitChecks("l1").some((f) => f.includes("yugnex-logo.png"))).toBe(true);
  project("l2", { "frontend/components/layout/Footer.tsx": '<img src="/yugnex-logo.png" alt="YugNex" width="69" height="48" />\n' }, "A coffee shop.");
  expect(frontendExitChecks("l2").some((f) => f.includes("public/yugnex-logo.png is missing"))).toBe(true);
  project("l3", {
    "frontend/components/layout/Footer.tsx": '<img src="/yugnex-logo.png" alt="YugNex" width="69" height="48" />\n',
    "frontend/public/yugnex-logo.png": "png",
  }, "A coffee shop.");
  expect(frontendExitChecks("l3")).toEqual([]);
});

// 2026-10-24 (Brewline): the spec says customers browse the menu, but nothing told a builder to ship starter content;
// the delivered app opened with an empty menu (one test item left from the review). A public list endpoint needs rows.
test("a public list endpoint with no starter rows anywhere is reported; starter rows in a seed file or migration satisfy it", () => {
  const contract = JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/auth/sign-in", auth: false },
    { method: "GET", path: "/api/v1/menu", auth: false },
    { method: "GET", path: "/api/v1/orders", auth: true },
  ] });
  project("s1", {
    "api-contract.json": contract,
    "backend/src/db/seedStaff.ts": "await pool.query(\"INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'staff')\");\n",
    "db/migrations/0000_initial.sql": "CREATE TABLE menu_items (id uuid);\n",
  }, "A coffee shop.");
  const empty = backendExitChecks("s1");
  expect(empty.some((f) => f.includes("GET /api/v1/menu") && f.includes("starter"))).toBe(true);
  project("s2", {
    "api-contract.json": contract,
    "backend/src/db/seedStaff.ts": "await pool.query(\"INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'staff')\");\n",
    "backend/src/db/seedCatalog.ts": "await pool.query(\"INSERT INTO menu_items (name, price) VALUES ('Flat white', 4.5)\");\n",
  }, "A coffee shop.");
  expect(backendExitChecks("s2").some((f) => f.includes("starter"))).toBe(false);
  project("s3", {
    "api-contract.json": contract,
    "db/migrations/0001_seed.sql": "INSERT INTO menu_items (name, price) VALUES ('Flat white', 4.5) ON CONFLICT DO NOTHING;\n",
  }, "A coffee shop.");
  expect(backendExitChecks("s3").some((f) => f.includes("starter"))).toBe(false);
  project("s4", { "api-contract.json": JSON.stringify({ endpoints: [{ method: "POST", path: "/api/v1/auth/sign-in", auth: false }, { method: "GET", path: "/health", auth: false }] }) }, "A tool with no public lists.");
  expect(backendExitChecks("s4").some((f) => f.includes("starter"))).toBe(false);
});

test("the backend builder is told to ship starter content for a public catalog", () => {
  const shubham = readFileSync(new URL("../../../packages/agent-runtime/skills/shubham/20-critical-rules-and-verification.md", import.meta.url), "utf-8");
  expect(shubham).toContain("PUBLIC CATALOG SHIPS WITH STARTER CONTENT");
  expect(shubham).toContain("seedCatalog");
});

// 2026-10-25 (brewline2, the first build started from the web app): the approved spec said sign-up "creates a new customer or
// staff account", and the backend did exactly that: the sign-up body takes `role: 'customer' | 'staff'`, so anyone can register
// as staff and reach the barista dashboard and the menu manager. No staff account was seeded either. Reviewers followed the plan
// and reported nothing. Nothing in the system said that a role must never come from the request.
test("a sign-up that takes the account's role from the request is reported; one that does not is not", () => {
  project("r1", {
    "backend/src/routes/auth.ts": [
      "const signUpSchema = z.object({ email: z.string(), password: z.string(), role: z.enum(['customer', 'staff']).optional().default('customer') });",
      "router.post('/sign-up', async (req, res) => { const { email, password, role } = signUpSchema.parse(req.body); });",
    ].join("\n"),
  }, "A coffee shop.");
  expect(backendExitChecks("r1").some((f) => f.includes("auth.ts") && f.includes("role"))).toBe(true);
  project("r2", { "backend/src/routes/auth.ts": "const signUpSchema = z.object({ email: z.string(), password: z.string() });\nrouter.post('/sign-up', async (req, res) => { await pool.query(\"INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'customer')\"); });\n" }, "A coffee shop.");
  expect(backendExitChecks("r2").some((f) => f.includes("role"))).toBe(false);
  project("r3", { "backend/src/routes/orders.ts": "const { status } = req.body; // an order's role-free body\nconst role = req.user.role;\n" }, "A coffee shop.");
  expect(backendExitChecks("r3").some((f) => f.includes("role"))).toBe(false);
});

test("a contract with staff-only endpoints and no seeded staff account is reported; a seeded staff account satisfies it", () => {
  const contract = JSON.stringify({ endpoints: [{ method: "POST", path: "/api/v1/menu", auth: true, description: "Create a menu item (staff only)." }] });
  project("t1", { "api-contract.json": contract, "backend/src/index.ts": "app.listen(3001);\n" }, "A coffee shop.");
  expect(backendExitChecks("t1").some((f) => f.includes("no staff account is seeded"))).toBe(true);
  project("t2", {
    "api-contract.json": contract,
    "backend/src/db/seedStaff.ts": "await pool.query(\"INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'staff') ON CONFLICT DO NOTHING\");\n",
  }, "A coffee shop.");
  expect(backendExitChecks("t2").some((f) => f.includes("no staff account is seeded"))).toBe(false);
  project("t3", { "api-contract.json": JSON.stringify({ endpoints: [{ method: "GET", path: "/api/v1/menu", auth: false }] }) }, "A coffee shop.");
  expect(backendExitChecks("t3").some((f) => f.includes("no staff account is seeded"))).toBe(false);
});

test("the planner, the backend builder and both reviewers are told a role never comes from the request", () => {
  const read = (rel: string) => readFileSync(new URL(`../../../packages/agent-runtime/skills/${rel}`, import.meta.url), "utf-8");
  expect(read("saanvi.md")).toContain("never writes \"customer or staff account\"");
  expect(read("shubham/20-critical-rules-and-verification.md")).toContain("A ROLE NEVER COMES FROM THE REQUEST");
  expect(read("library/auth-flows/SKILL.md")).toContain("role is never read from the request");
  expect(read("library/security-review/SKILL.md")).toContain("role or permission field");
});
