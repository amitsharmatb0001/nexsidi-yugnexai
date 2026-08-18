import { test, expect } from "bun:test";
import { toPosixPath } from "./artifacts.ts";

// 2026-08-19: real bug found live — the artifact tree emitted paths straight
// off Node's join(), so on Windows every path used backslashes
// ("backend\src\controllers\admin.ts"). The web client splits on "/" to build
// its folder tree, so nothing nested: the explorer showed one flat row per
// file with the raw backslash path as its label. The same string is echoed
// back as ?path= on the file endpoint, so this wire format has to be
// platform-independent either way.

test("toPosixPath converts Windows separators to forward slashes", () => {
  expect(toPosixPath("backend\\src\\controllers\\admin.ts")).toBe("backend/src/controllers/admin.ts");
});

test("toPosixPath leaves an already-POSIX path unchanged", () => {
  expect(toPosixPath("backend/src/app.ts")).toBe("backend/src/app.ts");
});

test("toPosixPath normalises mixed separators, which Windows joins can produce", () => {
  expect(toPosixPath("frontend\\app/dashboard\\page.tsx")).toBe("frontend/app/dashboard/page.tsx");
});

test("toPosixPath collapses repeated separators rather than emitting empty segments", () => {
  // An empty segment would render as a nameless folder in the client's tree.
  expect(toPosixPath("db\\\\migrations\\0000_initial.sql")).toBe("db/migrations/0000_initial.sql");
});

test("toPosixPath handles a bare filename at the project root", () => {
  expect(toPosixPath("docker-compose.yml")).toBe("docker-compose.yml");
});

test("toPosixPath produces segments a client can split on '/' to nest correctly", () => {
  // The actual property the explorer depends on.
  expect(toPosixPath("backend\\src\\routes\\index.ts").split("/")).toEqual([
    "backend",
    "src",
    "routes",
    "index.ts",
  ]);
});
