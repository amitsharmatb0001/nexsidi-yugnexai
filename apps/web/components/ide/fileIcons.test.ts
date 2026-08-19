import { test, expect } from "bun:test";
import { fileMark } from "./fileIcons.ts";

test("fileMark resolves by extension", () => {
  expect(fileMark("app.tsx").tag).toBe("TS");
  expect(fileMark("schema.sql").tag).toBe("SQ");
  expect(fileMark("package.json").tag).toBe("{}");
});

test("fileMark is case-insensitive, so Dockerfile and dockerfile agree", () => {
  expect(fileMark("Dockerfile").tag).toBe("DK");
  expect(fileMark("dockerfile").tag).toBe("DK");
});

test("fileMark matches whole names where the name carries the meaning", () => {
  expect(fileMark("docker-compose.yml").tag).toBe("DK");
  // and not the generic yml mark it would otherwise get
  expect(fileMark("config.yml").tag).toBe("YM");
});

test("fileMark keys off the last dot-segment so .env.local resolves", () => {
  expect(fileMark(".env.local").tag).toBe("EN");
  expect(fileMark(".env.example").tag).toBe("EN");
});

test("fileMark falls back rather than throwing on an unknown or extensionless name", () => {
  expect(fileMark("LICENSE").tag).toBe("··");
  expect(fileMark("weird.").tag).toBe("··");
  expect(fileMark("").tag).toBe("··");
});

test("every mark is at most two characters, so the tree column stays aligned", () => {
  for (const n of ["a.ts", "b.json", "c.sql", "Dockerfile", "x.unknown", ".env.local"]) {
    expect(fileMark(n).tag.length).toBeLessThanOrEqual(2);
  }
});
