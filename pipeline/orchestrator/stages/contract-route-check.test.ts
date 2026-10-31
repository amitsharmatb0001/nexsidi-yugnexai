import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contractRouteFindings, staffOnlyEndpoint, type ContractEndpoint } from "./contract-route-check.ts";

// 2026-10-24 (final plan item 1): the approved API contract is the yardstick for the backend. When the backend builder
// says it is done, the system loads the compiled app, calls every contract endpoint (no database needed) and reports:
// a route that does not exist (404), a protected route that answers without a token, and a staff-only route that lets a
// customer token in. Nothing is guessed: each finding is a status the app really returned.

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

const ENDPOINTS: ContractEndpoint[] = [
  { method: "GET", path: "/api/v1/menu", auth: false, description: "List all menu items." },
  { method: "POST", path: "/api/v1/menu", auth: true, description: "Add a menu item (staff only)." },
  { method: "PATCH", path: "/api/v1/menu/:id", auth: true, description: "Update an item (staff only)." },
  { method: "POST", path: "/api/v1/orders", auth: true, description: "Place an order (authenticated customer only)." },
];

// A hand-written app (no framework): `faults` switches on the three defects.
function backend(faults: { noOrdersRoute?: boolean; menuPostOpen?: boolean; customerPassesStaff?: boolean } = {}): string {
  dir = mkdtempSync(join(tmpdir(), "contract-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}"); // like a real backend: its own package.json, so the compiled files are CommonJS
  writeFileSync(join(dir, "dist", "app.js"), `
const crypto = require("node:crypto");
function claims(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  const [a, b, sig] = h.slice(7).split(".");
  const ok = crypto.createHmac("sha256", process.env.JWT_SECRET).update(a + "." + b).digest("base64url") === sig;
  return ok ? JSON.parse(Buffer.from(b, "base64url").toString()) : null;
}
module.exports = function app(req, res) {
  const path = req.url.split("?")[0];
  const json = (s, body) => { res.statusCode = s; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body || {})); };
  const user = claims(req);
  if (path === "/api/v1/menu" && req.method === "GET") return json(200, { items: [] });
  if (path === "/api/v1/menu" && req.method === "POST") {
    if (!${faults.menuPostOpen ? "true" : "false"} && !user) return json(401, {});
    if (!${faults.customerPassesStaff ? "true" : "false"} && user && user.role !== "staff") return json(403, {});
    return json(400, {});
  }
  if (path.startsWith("/api/v1/menu/") && req.method === "PATCH") {
    if (!user) return json(401, {});
    if (!${faults.customerPassesStaff ? "true" : "false"} && user.role !== "staff") return json(403, {});
    return json(404, { error: "Menu item not found" });
  }
  if (path === "/api/v1/orders" && req.method === "POST" && ${faults.noOrdersRoute ? "false" : "true"}) {
    if (!user) return json(401, {});
    return json(400, {});
  }
  return json(404, {});
};
`);
  return dir;
}

test("staffOnlyEndpoint reads the contract's own words", () => {
  expect(staffOnlyEndpoint(ENDPOINTS[1]!)).toBe(true);
  expect(staffOnlyEndpoint(ENDPOINTS[3]!)).toBe(false);
  expect(staffOnlyEndpoint({ method: "GET", path: "/x", auth: true, description: "Admin-only report." })).toBe(true);
  expect(staffOnlyEndpoint({ method: "GET", path: "/x", auth: false, description: "Staff only? no, public." })).toBe(false);
});

test("a backend that matches its contract passes, and a staff 'item not found' 404 is not a missing route", async () => {
  const r = await contractRouteFindings(backend(), ENDPOINTS);
  expect(r.ran).toBe(true);
  expect(r.findings).toEqual([]);
});

test("a missing route, a protected route open without a token and a staff route open to a customer are each reported", async () => {
  const r = await contractRouteFindings(backend({ noOrdersRoute: true, menuPostOpen: true, customerPassesStaff: true }), ENDPOINTS);
  expect(r.findings.some((f) => f.includes("POST /api/v1/orders") && f.includes("404"))).toBe(true);
  expect(r.findings.some((f) => f.includes("POST /api/v1/menu") && f.includes("without a token"))).toBe(true);
  expect(r.findings.some((f) => f.includes("POST /api/v1/menu") && f.includes("customer"))).toBe(true);
  expect(r.findings.some((f) => f.includes("PATCH /api/v1/menu/:id") && f.includes("customer"))).toBe(true);
});

test("no compiled app means the check did not run, and says so", async () => {
  dir = mkdtempSync(join(tmpdir(), "contract-"));
  const r = await contractRouteFindings(dir, ENDPOINTS);
  expect(r.ran).toBe(false);
  expect(r.note).toContain("dist/app.js");
});

test("the backend builder's finish check runs it", () => {
  const src = readFileSync(new URL("../../../agents/generators/shubham/src/index.ts", import.meta.url), "utf-8");
  expect(src).toContain("contractRouteFindingsFor");
  const exit = readFileSync(new URL("./builder-exit-checks.ts", import.meta.url), "utf-8");
  expect(exit).toContain("contractRouteFindings(");
  expect(exit).toContain("statSync(dist).mtimeMs < newestSource");
});

// 2026-10-31 (Brewline 4): the same facts as the plan's role reader — a signed-in /admin route is staff-only.
test("staffOnlyEndpoint reads the roles field and the path, not only the wording", () => {
  expect(staffOnlyEndpoint({ method: "POST", path: "/api/v1/admin/menu", auth: true, description: "Staff adds a new menu item." } as ContractEndpoint)).toBe(true);
  expect(staffOnlyEndpoint({ method: "GET", path: "/api/v1/orders/me", auth: true, description: "Customer views their own orders." } as ContractEndpoint)).toBe(false);
});
