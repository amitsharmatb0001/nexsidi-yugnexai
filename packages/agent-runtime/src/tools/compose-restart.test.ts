import { test, expect } from "bun:test";
import { removeRestartPolicies, prepareComposeForUp } from "./compose-ports.ts";

// 2026-10-08 (Amit): every generated app woke up as soon as Docker started. Cause: the compose files the deploy
// agent writes carry `restart: always` or `restart: unless-stopped` (14 of 17 existing apps, and the dev stack), and
// Docker restarts such containers whenever it starts. The owner starts what they want, by hand — so no generated
// compose file may carry a restart policy. Enforced in code before every `up`; a prompt rule alone was ignored.

const withRestart = (policy: string) =>
  `services:\n  postgres:\n    image: postgres:16\n    restart: ${policy}\n    ports:\n      - "127.0.0.1:5437:5432"\n  backend:\n    build: ./backend\n    restart: ${policy}\n    depends_on:\n      - postgres\n`;

test("removeRestartPolicies removes always, unless-stopped, on-failure (with and without a count) and quoted forms", () => {
  for (const policy of ["always", "unless-stopped", "on-failure", "on-failure:5", '"always"', "'unless-stopped'", "always # keep it alive"]) {
    const r = removeRestartPolicies(withRestart(policy));
    expect(r.removed).toBe(2);
    expect(r.content).not.toContain("restart:");
    expect(r.content).toContain("image: postgres:16");
    expect(r.content).toContain("depends_on:");
  }
});

test("removeRestartPolicies keeps `restart: no` and `restart: \"no\"` (already what we want) and is idempotent", () => {
  const already = withRestart('"no"');
  const r = removeRestartPolicies(already);
  expect(r.removed).toBe(0);
  expect(r.content).toBe(already);
  const once = removeRestartPolicies(withRestart("always")).content;
  expect(removeRestartPolicies(once).removed).toBe(0);
});

test("removeRestartPolicies also removes a deploy.restart_policy block with its children, and nothing else", () => {
  const compose =
    "services:\n  backend:\n    build: ./backend\n    deploy:\n      restart_policy:\n        condition: any\n        delay: 5s\n      resources:\n        limits:\n          memory: 512M\n    ports:\n      - \"127.0.0.1:3300:3001\"\n";
  const r = removeRestartPolicies(compose);
  expect(r.removed).toBe(1);
  expect(r.content).not.toContain("restart_policy");
  expect(r.content).not.toContain("condition: any");
  expect(r.content).not.toContain("delay: 5s");
  expect(r.content).toContain("resources:");
  expect(r.content).toContain("memory: 512M");
  expect(r.content).toContain('"127.0.0.1:3300:3001"');
});

test("removeRestartPolicies does not touch a key that only contains the word restart", () => {
  const compose = "services:\n  backend:\n    environment:\n      RESTART_DELAY: 5\n      NODE_OPTIONS: --restart-on-crash\n    labels:\n      note: restart: soon\n";
  const r = removeRestartPolicies(compose);
  expect(r.removed).toBe(0);
  expect(r.content).toBe(compose);
});

test("removeRestartPolicies keeps CRLF line endings", () => {
  const r = removeRestartPolicies(withRestart("always").replace(/\n/g, "\r\n"));
  expect(r.removed).toBe(2);
  expect(r.content).toContain("\r\n");
  expect(r.content.replace(/\r\n/g, "")).not.toContain("\n");
});

test("prepareComposeForUp removes the restart policies and reports how many", () => {
  const files = new Map<string, string>([["/app/docker-compose.yml", withRestart("unless-stopped")]]);
  const fs = { exists: (p: string) => files.has(p.replace(/\\/g, "/")), read: (p: string) => files.get(p.replace(/\\/g, "/"))!, write: (p: string, c: string) => { files.set(p.replace(/\\/g, "/"), c); } };
  const r = prepareComposeForUp("/app", fs);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.restartRemoved).toBe(2);
  expect(files.get("/app/docker-compose.yml")).not.toContain("restart:");
});
