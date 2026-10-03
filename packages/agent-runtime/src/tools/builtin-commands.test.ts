import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execRunCommand } from "./command.ts";
import { createEvidenceLedger } from "../enforce/evidence.ts";

// 2026-10-03 (Ledgerly benchmark run 4): the worker runs from PowerShell,
// where Git's usr\bin (cat, ls, head…) is not on PATH. The frontend's
// required checks `cat app/not-found.tsx` failed although the files existed,
// so finished work could never pass — the same silent cause behind run 3 and
// run 2's `ls ../backend` ENOENT. These read-only commands are built into the
// tool now and behave the same on every machine.

function dir() {
  const d = mkdtempSync(join(tmpdir(), "builtin-cmd-"));
  mkdirSync(join(d, "app"));
  writeFileSync(join(d, "app", "not-found.tsx"), "line 1\nline 2\nline 3\n");
  writeFileSync(join(d, "app", "icon.svg"), "<svg/>\n");
  return d;
}

test("cat prints a file and counts as a passed required check, with no cat.exe needed", async () => {
  const d = dir();
  const prev = process.env.PATH;
  process.env.PATH = "";
  try {
    const ledger = createEvidenceLedger();
    const r = await execRunCommand(d, { command: "cat app/not-found.tsx" }, ledger);
    expect(r.status).toBe("success");
    expect(String(r.output)).toContain("line 2");
    expect(ledger.hasSuccessfulCommand("cat app/not-found.tsx")).toBe(true);
  } finally {
    process.env.PATH = prev;
    rmSync(d, { recursive: true, force: true });
  }
});

test("cat of a missing file fails like the real command", async () => {
  const d = dir();
  try {
    const ledger = createEvidenceLedger();
    const r = await execRunCommand(d, { command: "cat app/error.tsx" }, ledger);
    expect(r.status).toBe("error");
    expect(String(r.output)).toContain("No such file");
    expect(ledger.hasSuccessfulCommand("cat app/error.tsx")).toBe(false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("ls, head, tail, wc -l and pwd work the same everywhere", async () => {
  const d = dir();
  try {
    expect(String((await execRunCommand(d, { command: "ls app" })).output)).toContain("not-found.tsx");
    expect(String((await execRunCommand(d, { command: "head -n 1 app/not-found.tsx" })).output).trim()).toBe("line 1");
    expect(String((await execRunCommand(d, { command: "tail -n 1 app/not-found.tsx" })).output).trim()).toBe("line 3");
    expect(String((await execRunCommand(d, { command: "wc -l app/not-found.tsx" })).output)).toContain("3");
    expect((await execRunCommand(d, { command: "pwd" })).status).toBe("success");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("the folder rules still apply to the built-in commands", async () => {
  const d = dir();
  try {
    const r = await execRunCommand(join(d, "app"), { command: "cat ../secret.txt" });
    expect(r.status).toBe("error");
    expect(r.summary).toContain("outside your folder");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
