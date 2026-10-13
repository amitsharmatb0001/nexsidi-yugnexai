import { test, expect } from "bun:test";
import { projectNamesFromDocker } from "./docker-names.ts";

test("project names are read from volume names and from compose labels", () => {
  const names = projectNamesFromDocker(
    ["shopbill_postgres_data_fresh", "ledgerly-2_postgres_data", "52c4d13c5e0d_postgres_data", "plainvolume"],
    ["shopbill", "", "ledgerly-2", "eager-varahamihira-967edb"],
  );
  expect(names.sort()).toEqual(["52c4d13c5e0d", "eager-varahamihira-967edb", "ledgerly-2", "shopbill"]);
});

test("a volume with no compose prefix, and blank lines, are ignored", () => {
  expect(projectNamesFromDocker(["plainvolume", "  "], ["", "  "])).toEqual([]);
});
