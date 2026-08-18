import { test, expect } from "bun:test";
import { sortNodes, defaultExpanded, type ApiNode } from "./FileExplorer.tsx";

function dir(name: string, children: ApiNode[] = []): ApiNode {
  return { name, path: name, type: "directory", children };
}
function file(name: string): ApiNode {
  return { name, path: name, type: "file" };
}

test("sortNodes puts directories before files", () => {
  const sorted = sortNodes([file("readme.md"), dir("src"), file("app.ts"), dir("db")]);
  expect(sorted.map((n) => n.name)).toEqual(["db", "src", "app.ts", "readme.md"]);
});

test("sortNodes orders alphabetically within each group", () => {
  const sorted = sortNodes([file("z.ts"), file("a.ts"), file("m.ts")]);
  expect(sorted.map((n) => n.name)).toEqual(["a.ts", "m.ts", "z.ts"]);
});

test("sortNodes does not mutate the caller's array", () => {
  const original = [file("b.ts"), dir("a")];
  const snapshot = [...original];
  sortNodes(original);
  expect(original).toEqual(snapshot);
});

test("defaultExpanded opens top-level and second-level directories, not the whole tree", () => {
  const tree: ApiNode[] = [
    { name: "backend", path: "backend", type: "directory", children: [
      { name: "src", path: "backend/src", type: "directory", children: [
        { name: "routes", path: "backend/src/routes", type: "directory", children: [] },
      ] },
    ] },
  ];

  const open = defaultExpanded(tree);

  expect(open).toContain("backend");
  expect(open).toContain("backend/src");
  // Third level stays collapsed so a deep project doesn't dump hundreds of
  // rows on first paint.
  expect(open).not.toContain("backend/src/routes");
});

test("defaultExpanded ignores files", () => {
  expect(defaultExpanded([file("docker-compose.yml"), dir("db")])).toEqual(["db"]);
});
