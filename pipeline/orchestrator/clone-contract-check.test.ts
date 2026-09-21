import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizePath,
  extractApiBasePrefix,
  extractRouteMounts,
  extractBackendRoutes,
  extractFrontendApiCalls,
  findContractMismatches,
  checkCrossLayerContract,
} from "./clone-contract-check.ts";

// ── normalizePath (pure) ──────────────────────────────────────────────────
test("normalizePath treats an Express :param and a frontend ${} interpolation as the same wildcard", () => {
  expect(normalizePath("/wishlist/:dropId")).toBe(normalizePath("/wishlist/${dropId}"));
});

test("normalizePath strips a trailing slash", () => {
  expect(normalizePath("/wishlist/")).toBe("/wishlist");
});

// ── extractApiBasePrefix (pure) ───────────────────────────────────────────
test("extractApiBasePrefix reads the real app.use(prefix, routes) mount from app.ts", () => {
  const appTs = `app.get("/health", h);\napp.use("/api/v1", routes);\n`;
  expect(extractApiBasePrefix(appTs)).toBe("/api/v1");
});

test("extractApiBasePrefix defaults to /api/v1 when app.ts is missing — this project's own established convention", () => {
  expect(extractApiBasePrefix(null)).toBe("/api/v1");
});

// ── extractRouteMounts (pure) — real content from a live generated project ─
const REAL_INDEX_TS = `import { Router } from "express";
import authRoutes from "./auth.routes";
import publicRoutes from "./public.routes";
import sellerRoutes from "./seller.routes";
import ordersRoutes from "./orders.routes";
import wishlistRoutes from "./wishlist.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/", publicRoutes);
router.use("/seller", sellerRoutes);
router.use("/", ordersRoutes);
router.use("/", wishlistRoutes);

export default router;
`;

test("extractRouteMounts resolves each route file to its real mount prefix — some resources get a real prefix, some are mounted at root", () => {
  const mounts = extractRouteMounts(REAL_INDEX_TS);
  expect(mounts["auth.routes"]).toBe("/auth");
  expect(mounts["seller.routes"]).toBe("/seller");
  expect(mounts["wishlist.routes"]).toBe("/");
});

// ── extractBackendRoutes (pure) — real content, real bug shape ───────────
test("extractBackendRoutes resolves the full real path for a resource mounted at a real prefix (auth writes relative paths)", () => {
  const routes = extractBackendRoutes(
    { "auth.routes.ts": 'router.post("/sign-in", signIn);\nrouter.post("/sign-up", signUp);\n' },
    extractRouteMounts(REAL_INDEX_TS),
    "/api/v1",
  );
  expect(routes).toContainEqual({ method: "POST", path: "/api/v1/auth/sign-in" });
});

test("extractBackendRoutes resolves the full real path for a resource mounted at root that self-contains its own resource name — the real Gatherly shape", () => {
  const routes = extractBackendRoutes(
    { "wishlist.routes.ts": 'router.get("/wishlist", getWishlist);\nrouter.post("/wishlist/:dropId", addItem);\nrouter.delete("/wishlist/:dropId", removeItem);\n' },
    extractRouteMounts(REAL_INDEX_TS),
    "/api/v1",
  );
  expect(routes).toContainEqual({ method: "GET", path: "/api/v1/wishlist" });
  expect(routes).toContainEqual({ method: "POST", path: "/api/v1/wishlist/*" });
  expect(routes).toContainEqual({ method: "DELETE", path: "/api/v1/wishlist/*" });
});

// ── extractFrontendApiCalls (pure) — real content from the actual live bug ─
const REAL_WISHLIST_HEART_TSX = `
const toggleSave = async (e) => {
  if (newSaved) {
    await apiFetch("/api/v1/wishlist", {
      method: "POST",
      body: JSON.stringify({ dropId }),
    });
  } else {
    await apiFetch(\`/api/v1/wishlist/\${dropId}\`, {
      method: "DELETE",
    });
  }
};
`;

test("extractFrontendApiCalls extracts the real calls found in the actual live bug — both the broken POST and the correct DELETE", () => {
  const calls = extractFrontendApiCalls([REAL_WISHLIST_HEART_TSX]);
  expect(calls).toContainEqual({ method: "POST", path: "/api/v1/wishlist" });
  expect(calls).toContainEqual({ method: "DELETE", path: "/api/v1/wishlist/*" });
});

test("extractFrontendApiCalls defaults to GET when no method is given, matching a typical fetch client convention", () => {
  const calls = extractFrontendApiCalls([`await apiFetch("/api/v1/wishlist");`]);
  expect(calls).toEqual([{ method: "GET", path: "/api/v1/wishlist" }]);
});

// ── findContractMismatches (pure) — the actual regression test for the real bug ─
test("findContractMismatches catches the exact real bug: frontend POSTs to a path the backend never registered", () => {
  const backendRoutes = extractBackendRoutes(
    { "wishlist.routes.ts": 'router.get("/wishlist", g);\nrouter.post("/wishlist/:dropId", a);\nrouter.delete("/wishlist/:dropId", r);\n' },
    extractRouteMounts(REAL_INDEX_TS),
    "/api/v1",
  );
  const frontendCalls = extractFrontendApiCalls([REAL_WISHLIST_HEART_TSX]);
  const mismatches = findContractMismatches(frontendCalls, backendRoutes);

  expect(mismatches).toHaveLength(1);
  expect(mismatches[0]!.frontendCall).toEqual({ method: "POST", path: "/api/v1/wishlist" });
});

test("findContractMismatches reports nothing when every frontend call has a matching backend route", () => {
  const backendRoutes = [{ method: "GET", path: "/api/v1/wishlist" }, { method: "DELETE", path: "/api/v1/wishlist/*" }];
  const frontendCalls = [{ method: "GET", path: "/api/v1/wishlist" }, { method: "DELETE", path: "/api/v1/wishlist/*" }];
  expect(findContractMismatches(frontendCalls, backendRoutes)).toEqual([]);
});

// ── checkCrossLayerContract (real filesystem, end-to-end) ────────────────
let tempBuildDir: string | null = null;
afterEach(() => {
  if (tempBuildDir) rmSync(tempBuildDir, { recursive: true, force: true });
  tempBuildDir = null;
});

test("checkCrossLayerContract catches the real bug end-to-end from real files on disk", () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-contract-check-test-"));
  mkdirSync(join(tempBuildDir, "backend", "src", "routes"), { recursive: true });
  mkdirSync(join(tempBuildDir, "frontend", "components"), { recursive: true });
  writeFileSync(join(tempBuildDir, "backend", "src", "app.ts"), 'app.use("/api/v1", routes);\n');
  writeFileSync(join(tempBuildDir, "backend", "src", "routes", "index.ts"), REAL_INDEX_TS);
  writeFileSync(join(tempBuildDir, "backend", "src", "routes", "wishlist.routes.ts"), 'router.get("/wishlist", g);\nrouter.post("/wishlist/:dropId", a);\nrouter.delete("/wishlist/:dropId", r);\n');
  writeFileSync(join(tempBuildDir, "frontend", "components", "WishlistHeart.tsx"), REAL_WISHLIST_HEART_TSX);

  const result = checkCrossLayerContract({ buildDir: tempBuildDir, frontendFilesWritten: ["components/WishlistHeart.tsx"] });

  expect(result.checked).toBe(true);
  expect(result.mismatches).toHaveLength(1);
  expect(result.mismatches[0]!.frontendCall.path).toBe("/api/v1/wishlist");
});

test("checkCrossLayerContract is inconclusive (not a false pass or false fail) when there's nothing to compare", () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-contract-check-test-"));
  mkdirSync(join(tempBuildDir, "backend", "src", "routes"), { recursive: true });
  mkdirSync(join(tempBuildDir, "frontend", "components"), { recursive: true });
  writeFileSync(join(tempBuildDir, "frontend", "components", "Hero.tsx"), "export function Hero() { return <h1>Hi</h1>; }\n");

  const result = checkCrossLayerContract({ buildDir: tempBuildDir, frontendFilesWritten: ["components/Hero.tsx"] });

  expect(result.checked).toBe(false);
  expect(result.mismatches).toEqual([]);
});

test("checkCrossLayerContract only inspects the NEWLY WRITTEN frontend files, not the whole app — pre-existing calls already work in production and aren't what's being verified", () => {
  tempBuildDir = mkdtempSync(join(tmpdir(), "nexsidi-contract-check-test-"));
  mkdirSync(join(tempBuildDir, "backend", "src", "routes"), { recursive: true });
  mkdirSync(join(tempBuildDir, "frontend", "components"), { recursive: true });
  writeFileSync(join(tempBuildDir, "backend", "src", "app.ts"), 'app.use("/api/v1", routes);\n');
  writeFileSync(join(tempBuildDir, "backend", "src", "routes", "index.ts"), 'import ordersRoutes from "./orders.routes";\nconst router = require("express").Router();\nrouter.use("/", ordersRoutes);\nexport default router;\n');
  writeFileSync(join(tempBuildDir, "backend", "src", "routes", "orders.routes.ts"), 'router.get("/orders", g);\n');
  // A pre-existing, already-working file with a call to a route that isn't in
  // OUR minimal fixture backend — must not be flagged, since it wasn't touched.
  writeFileSync(join(tempBuildDir, "frontend", "components", "PreExisting.tsx"), 'apiFetch("/api/v1/cart", { method: "GET" });\n');
  writeFileSync(join(tempBuildDir, "frontend", "components", "NewOne.tsx"), 'apiFetch("/api/v1/orders", { method: "GET" });\n');

  const result = checkCrossLayerContract({ buildDir: tempBuildDir, frontendFilesWritten: ["components/NewOne.tsx"] });

  expect(result.checked).toBe(true);
  expect(result.mismatches).toEqual([]); // NewOne's call matches; PreExisting was never scanned at all
});
