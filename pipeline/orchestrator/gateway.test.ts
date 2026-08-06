import { test, expect } from "bun:test";
import { writeGatewayRequest, readGatewayDecision } from "./gateway.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_PROJECT = "test-gateway-proj";
const BUILD_DIR = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";

test("readGatewayDecision returns null when no decision file exists yet", async () => {
  expect(await readGatewayDecision(TEST_PROJECT, "02-gateway")).toBeNull();
});

test("readGatewayDecision parses a proceed decision", async () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "02-gateway.decision.json"), JSON.stringify({ decision: "proceed" }), "utf-8");
  expect(await readGatewayDecision(TEST_PROJECT, "02-gateway")).toEqual({ decision: "proceed" });
  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});

test("readGatewayDecision parses a review decision with feedback", async () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "02-gateway.decision.json"), JSON.stringify({ decision: "review", feedback: "change the color" }), "utf-8");
  expect(await readGatewayDecision(TEST_PROJECT, "02-gateway")).toEqual({ decision: "review", feedback: "change the color" });
  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});

test("writeGatewayRequest throws on a path-traversal projectId", () => {
  expect(() => writeGatewayRequest("../../escaped-project", "02-gateway", "test summary")).toThrow();
});

test("readGatewayDecision throws on a path-traversal projectId", async () => {
  await expect(readGatewayDecision(TEST_PROJECT + "/../escaped", "02-gateway")).rejects.toThrow();
});

test("readGatewayDecision throws a clear error on malformed decision JSON on disk", async () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "corrupt-gateway.decision.json"), "{ not valid json", "utf-8");

  await expect(readGatewayDecision(TEST_PROJECT, "corrupt-gateway")).rejects.toThrow(
    /Gateway decision corrupt: test-gateway-proj\/corrupt-gateway/
  );

  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});

test("readGatewayDecision retries on unparseable JSON before giving up (race-tolerance backstop)", async () => {
  const dir = join(BUILD_DIR, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  // Simulates an external writer caught mid-write: content never becomes valid,
  // so this proves the retry loop still gives up and throws after exhausting
  // its attempts, rather than retrying forever or silently swallowing the error.
  writeFileSync(join(dir, "retry-gateway.decision.json"), "{ still not valid json", "utf-8");

  const start = Date.now();
  await expect(readGatewayDecision(TEST_PROJECT, "retry-gateway")).rejects.toThrow(
    /Gateway decision corrupt: test-gateway-proj\/retry-gateway/
  );
  const elapsed = Date.now() - start;

  // 3 attempts total means 2 retry delays (~50ms each) elapse before the
  // final throw — proves the retries actually happened, not an immediate throw.
  expect(elapsed).toBeGreaterThanOrEqual(90);

  rmSync(join(BUILD_DIR, TEST_PROJECT), { recursive: true, force: true });
});
