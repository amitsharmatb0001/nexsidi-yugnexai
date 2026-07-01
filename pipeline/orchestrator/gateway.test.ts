import { test, expect } from "bun:test";
import { writeGatewayRequest, readGatewayDecision } from "./gateway.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_PROJECT = "test-gateway-proj";
const BUILD_DIR = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";

test("readGatewayDecision returns null when no decision file exists yet", () => {
  expect(readGatewayDecision(TEST_PROJECT, "02-gateway")).toBeNull();
});

test("readGatewayDecision parses a proceed decision", () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "02-gateway.decision.json"), JSON.stringify({ decision: "proceed" }), "utf-8");
  expect(readGatewayDecision(TEST_PROJECT, "02-gateway")).toEqual({ decision: "proceed" });
  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});

test("readGatewayDecision parses a review decision with feedback", () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "02-gateway.decision.json"), JSON.stringify({ decision: "review", feedback: "change the color" }), "utf-8");
  expect(readGatewayDecision(TEST_PROJECT, "02-gateway")).toEqual({ decision: "review", feedback: "change the color" });
  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});

test("writeGatewayRequest throws on a path-traversal projectId", () => {
  expect(() => writeGatewayRequest("../../escaped-project", "02-gateway", "test summary")).toThrow();
});

test("readGatewayDecision throws on a path-traversal projectId", () => {
  expect(() => readGatewayDecision(TEST_PROJECT + "/../escaped", "02-gateway")).toThrow();
});

test("readGatewayDecision throws a clear error on malformed decision JSON on disk", () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "corrupt-gateway.decision.json"), "{ not valid json", "utf-8");

  expect(() => readGatewayDecision(TEST_PROJECT, "corrupt-gateway")).toThrow(
    /Gateway decision corrupt: test-gateway-proj\/corrupt-gateway/
  );

  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});
