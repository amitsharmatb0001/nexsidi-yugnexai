import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontendExitChecks, externalImageUrls, backendExitChecks, historyIntegrityFindings, keepHistoryInMigrations, metadataLeakFindings, cookieSecureFindings, secretLoggingFindings, strayShippedFileFindings, checklistFor, checklistFindings } from "./builder-exit-checks.ts";

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
  if (!("spec.json" in files)) writeFileSync(join(dir, "spec.json"), JSON.stringify({ description }));
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

// 2026-10-25 (brewline2): order_items referenced menu_items with ON DELETE CASCADE, so deleting a menu item (an endpoint of the
// contract) deleted the order lines of every past order; and order_items kept no price, so changing a price changed old orders.
// A table of order/invoice/booking lines must not cascade from the catalog row it points at, and must keep the price.
test("a line table that cascades from its catalog row, or keeps no price, is reported; RESTRICT with a price column passes", () => {
  const bad = [
    "CREATE TABLE IF NOT EXISTS order_items (",
    "    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
    "    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,",
    "    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,",
    "    quantity INTEGER NOT NULL DEFAULT 1",
    ");",
  ].join("\n");
  project("h1", { "db/migrations/0000_initial.sql": bad }, "A coffee shop.");
  const found = historyIntegrityFindings(join(root, "h1"));
  expect(found.some((f) => f.includes("order_items") && f.includes("ON DELETE CASCADE"))).toBe(true);
  expect(found.some((f) => f.includes("order_items") && f.includes("price"))).toBe(true);
  const good = bad.replace("menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE", "menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT").replace("quantity INTEGER", "unit_price NUMERIC(10,2) NOT NULL,\n    quantity INTEGER");
  project("h2", { "db/migrations/0000_initial.sql": good }, "A coffee shop.");
  expect(historyIntegrityFindings(join(root, "h2")).some((f) => f.includes("order_items"))).toBe(false);
  // a table that is not a line table is not judged
  project("h3", { "db/migrations/0000_initial.sql": "CREATE TABLE sessions (id UUID, user_id UUID REFERENCES users(id) ON DELETE CASCADE);\n" }, "A coffee shop.");
  expect(historyIntegrityFindings(join(root, "h3")).some((f) => f.includes("sessions"))).toBe(false);
});

test("the backend and database builders are told history is kept", () => {
  const read = (rel: string) => readFileSync(new URL(`../../../packages/agent-runtime/skills/${rel}`, import.meta.url), "utf-8");
  expect(read("shubham/20-critical-rules-and-verification.md")).toContain("HISTORY IS KEPT");
  expect(read("pranav.md")).toContain("HISTORY IS KEPT");
});

// 2026-10-25 (brewline3): the backend builder was asked to fix ON DELETE CASCADE in db/migrations, a folder that belongs to the
// database builder and that it cannot write, so the build stopped with "generation failed". The system now rewrites the key
// itself, and the backend builder's finish check no longer asks it to.
test("the system turns CASCADE from a catalog row into RESTRICT, keeps the parent cascade, and the backend builder is no longer asked to", () => {
  const sql = [
    "CREATE TABLE order_items (",
    "    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
    "    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,",
    "    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,",
    "    price_at_time NUMERIC(10,2) NOT NULL",
    ");",
  ].join("\n");
  project("n1", { "db/migrations/0000_initial.sql": sql }, "A coffee shop.");
  const dir = join(root, "n1");
  expect(backendExitChecks("n1").some((f) => f.includes("order_items"))).toBe(false);
  const changed = keepHistoryInMigrations(dir);
  expect(changed.length).toBe(1);
  expect(changed[0]).toContain("order_items.menu_item_id");
  const after = readFileSync(join(dir, "db/migrations/0000_initial.sql"), "utf-8");
  expect(after).toContain("menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT");
  expect(after).toContain("order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE");
  expect(historyIntegrityFindings(dir)).toEqual([]);
  // nothing left to change on a second pass
  expect(keepHistoryInMigrations(dir)).toEqual([]);
  // a table that is not a line table keeps its cascade
  project("n2", { "db/migrations/0000_initial.sql": "CREATE TABLE sessions (\n  id UUID,\n  user_id UUID REFERENCES users(id) ON DELETE CASCADE\n);\n" }, "A coffee shop.");
  expect(keepHistoryInMigrations(join(root, "n2"))).toEqual([]);
  expect(readFileSync(join(root, "n2", "db/migrations/0000_initial.sql"), "utf-8")).toContain("ON DELETE CASCADE");
});

test("both database-folder rewrites are wired: the database builder runs it after its migration, the backend builder before its finish check", () => {
  const pranav = readFileSync(new URL("../../../agents/generators/pranav/src/index.ts", import.meta.url), "utf-8");
  const shubham = readFileSync(new URL("../../../agents/generators/shubham/src/index.ts", import.meta.url), "utf-8");
  expect(pranav).toContain("keepHistoryInMigrations");
  expect(shubham).toContain("keepHistoryInMigrations");
});

// 2026-10-25 (brewline3): the backend rule said "copy the item's name and unit price into the line", the database rule said only
// "a unit_price"; the migration had a price column and no name column, the backend builder cannot write the database, and one finding
// ("old orders show the item's current name") went round for 8 review rounds. Both rules now name both columns.
test("the backend and database rules ask for the same two line columns: the name and the unit price", () => {
  const read = (rel: string) => readFileSync(new URL(`../../../packages/agent-runtime/skills/${rel}`, import.meta.url), "utf-8");
  const section = (text: string) => text.slice(text.indexOf("HISTORY IS KEPT"), text.indexOf("HISTORY IS KEPT") + 700);
  for (const s of [section(read("shubham/20-critical-rules-and-verification.md")), section(read("pranav.md"))]) {
    expect(s).toMatch(/name_at_time/);
    expect(s).toMatch(/unit_price/);
  }
});

// 2026-10-25 (brewline3): the reviewers kept finding, one or two per round, things a builder could have caught before saying done: the
// whole spec pasted into the page description, a staff password written to the console, a test compose file with weak secrets left in
// the backend folder, a `secure` cookie that breaks sign-in over http. They are found by file reads, so the system checks them
// when the builder says it is done.
const LONG_SPEC = "Brewline is a mobile-friendly pre-order web application for a single-location neighborhood coffee shop where customers can browse drinks and pastries with prices, select same-day 15-minute pickup slots starting at least 15 minutes from now during store hours, and place pre-orders";

test("a page description that is the spec pasted in, or is very long, is reported; a short one is not", () => {
  project("m1", { "frontend/app/layout.tsx": `export const metadata = { title: "Brewline", description: "${LONG_SPEC}" };\n` }, LONG_SPEC);
  expect(metadataLeakFindings(join(root, "m1")).length).toBe(1);
  project("m2", { "frontend/app/layout.tsx": 'export const metadata = { title: "Brewline", description: "Order coffee and pastries ahead for pickup." };\n' }, LONG_SPEC);
  expect(metadataLeakFindings(join(root, "m2"))).toEqual([]);
});

test("a cookie set with the secure flag in the browser code is reported (it is dropped over http); one without it is not", () => {
  project("c1", { "frontend/app/sign-in/page.tsx": 'document.cookie = `token=${t}; path=/; max-age=86400; samesite=lax; secure`;\n' }, "x");
  expect(cookieSecureFindings(join(root, "c1")).length).toBe(1);
  project("c2", { "frontend/app/sign-in/page.tsx": 'document.cookie = `token=${t}; path=/; max-age=86400; SameSite=Lax`;\n' }, "x");
  expect(cookieSecureFindings(join(root, "c2"))).toEqual([]);
});

test("a password, secret or token written to a log is reported; ordinary logging is not", () => {
  project("s1", {
    "backend/src/db/seedStaff.ts": "console.log(`[SEED] Created staff account: ${email} with generated password: ${password}`);\n",
    "backend/src/app.ts": 'console.log("server listening");\nconsole.error("Error seeding staff:", error);\nconsole.log("hashing password with bcrypt");\n',
  }, "x");
  const out = secretLoggingFindings(join(root, "s1"));
  expect(out.length).toBe(1);
  expect(out[0]).toContain("backend/src/db/seedStaff.ts");
});

test("a compose file or an .env with secrets inside the backend or frontend folder is reported; the project root's own compose file is not", () => {
  project("f1", {
    "docker-compose.yml": "services: {}\n",
    "backend/docker-compose.yml": "environment:\n  JWT_SECRET: testsecret\n  POSTGRES_PASSWORD: password\n",
    "backend/.env": "JWT_SECRET=testsecret\n",
    "backend/.env.example": "JWT_SECRET=change-me\n",
  }, "x");
  const out = strayShippedFileFindings(join(root, "f1"));
  expect(out.some((f) => f.includes("backend/docker-compose.yml"))).toBe(true);
  expect(out.some((f) => f.includes("backend/.env"))).toBe(true);
  expect(out.some((f) => f.startsWith("backend/.env.example"))).toBe(false);
  expect(out.some((f) => f.startsWith("docker-compose.yml"))).toBe(false);
});

test("the hygiene checks are part of the builders' finish checks", () => {
  project("w1", {
    "frontend/app/layout.tsx": `export const metadata = { description: "${LONG_SPEC}" };\n`,
    "backend/src/db/seedStaff.ts": "console.log(`password: ${password}`);\n",
    "backend/docker-compose.yml": "JWT_SECRET: x\n",
  }, LONG_SPEC);
  expect(frontendExitChecks("w1").some((f) => f.includes("layout.tsx"))).toBe(true);
  const back = backendExitChecks("w1");
  expect(back.some((f) => f.includes("seedStaff.ts"))).toBe(true);
  expect(back.some((f) => f.includes("docker-compose.yml"))).toBe(true);
});

const CHECK_FILES = {
  "api-contract.json": JSON.stringify({ endpoints: [{ method: "POST", path: "/api/v1/orders", description: "Place an order" }, { method: "GET", path: "/api/v1/menu", description: "List" }] }),
  "spec.json": JSON.stringify({ description: "x", successCriteria: ["Customers can place a pre-order"] }),
};

test("each builder gets the plan items that concern it: the backend the endpoints and the rules, the frontend the criteria and the design", () => {
  project("k1", CHECK_FILES, "x");
  const back = checklistFor(join(root, "k1"), "backend").map((i) => i.id);
  const front = checklistFor(join(root, "k1"), "frontend").map((i) => i.id);
  expect(back).toEqual(expect.arrayContaining(["EP1", "EP2", "SEC1", "INT1", "INT3"]));
  expect(back).not.toContain("SC1");
  expect(front).toEqual(expect.arrayContaining(["SC1", "SEC5", "SEC8", "INT3"]));
  expect(front).not.toContain("EP1");
});

test("a builder cannot finish until its summary accounts for every item that concerns it, each with a file", () => {
  project("k2", CHECK_FILES, "x");
  const ids = checklistFor(join(root, "k2"), "backend").map((i) => i.id);
  const missingAll = checklistFindings("k2", "backend", "All done, tests pass.");
  expect(missingAll.length).toBe(1);
  for (const id of ids) expect(missingAll[0]).toContain(`[${id}]`);
  const partial = ids.slice(1).map((id) => `[${id}] backend/src/routes/x.ts:10`).join("\n");
  const one = checklistFindings("k2", "backend", partial);
  expect(one[0]).toContain(`[${ids[0]}]`);
  expect(one[0]).not.toContain(`[${ids[1]}]`);
  const full = ids.map((id) => `[${id}] ok - backend/src/routes/x.ts:10`).join("\n");
  expect(checklistFindings("k2", "backend", full)).toEqual([]);
  // a bare id with no file after it does not count
  expect(checklistFindings("k2", "backend", ids.map((id) => `[${id}] ok`).join("\n")).length).toBe(1);
});

test("both builders pass their completion summary to the finish checks and get the checklist in their first task, not in fix rounds", () => {
  const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf-8");
  for (const f of ["agents/generators/shubham/src/index.ts", "agents/generators/aanya/src/index.ts"]) {
    const src = read(f);
    expect(src).toContain("checklistFindings");
    expect(src).toContain("checklistTextFor(plan.projectId)");
    expect(src).toMatch(/\(summary: string\) => (backend|frontend)ExitChecksFor\(plan\.projectId, summary\)/);
  }
  // the fix rounds call the finish checks without a summary, so no checklist
  expect(read("agents/generators/shubham/src/index.ts")).toContain("exitChecks: () => backendExitChecksFor(plan.projectId)");
  expect(read("agents/generators/aanya/src/index.ts")).toContain("exitChecks: () => frontendExitChecksFor(plan.projectId)");
  expect(read("packages/agent-runtime/src/gemini-loop.ts")).toContain("config.exitChecks(String(a.summary");
  expect(read("packages/agent-runtime/src/loop.ts")).toContain("config.exitChecks(String(a.summary");
});

test("the requirements skill tells Saanvi to state a business number once, with values", () => {
  const skill = readFileSync(new URL("../../../packages/agent-runtime/skills/saanvi.md", import.meta.url), "utf-8");
  expect(skill).toContain("BUSINESS NUMBERS ARE STATED ONCE");
  expect(skill).toMatch(/opening\s+hours/);
});
