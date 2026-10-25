// Run watchdog (temporary, not committed). Reads the worker log continuously
// and prints every step. It does not rely on the pipeline recognising its own
// loops: it stops the worker itself when
//   A. spend rose more than LIMIT_SINCE_GUARD since the last [guard] line,
//   B. one agent started more than MAX_STARTS times within the window,
//   C. the log shows the same line pattern repeating (identical tool call 12x).
// Zero model calls, so it costs nothing.
import { existsSync, openSync, readSync, statSync, closeSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { checkBudget } from "../packages/agent-runtime/src/cost-budget.ts";

const LOG = process.argv[2]!;
const PROJECT = process.argv[3]!;
const LIMIT_SINCE_GUARD = Number(process.env.LIMIT_SINCE_GUARD ?? 9);
const MAX_STARTS = 8;
const WINDOW_MS = 30 * 60_000;

let pos = existsSync(LOG) ? statSync(LOG).size : 0;
let buf = "";
let rejected = 0;
let escalations = 0;
const starts = new Map<string, number[]>();
const lastCalls: string[] = [];

const spend = async () => (await checkBudget(PROJECT)).spentUsd;
let lastGuardSpend = await spend();
const START_SPEND = lastGuardSpend;
const MAX_DELTA = Number(process.env.MAX_DELTA ?? 3);
let lastPrinted = lastGuardSpend;
console.log(`[watch] started. spend $${lastGuardSpend.toFixed(2)}. stop rules: +$${process.env.MAX_DELTA ?? 3} since start, any quota-watch line, 3 rejected requests, 2 escalations, , >${MAX_STARTS} starts of one agent / 30 min, 12 identical tool calls in a row`);

const SHOW = /\[GUARD HOLD\]|\[guard\]|\[workflow\]|\[activity:|budget_exceeded|\[stage6\]|\[qa-fix-loop\]|\[dispute|\[disputes\]|\[settle\]|\[blocked\]|\[auth-smoke\]|markProjectDone|Unhandled|\] (Starting|DONE after|Stopped)|task_complete REJECTED|Stuck:|Max iterations/;

function stop(reason: string): void {
  console.log(`[WATCHDOG STOP] ${reason}`);
  try {
    writeFileSync(join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", PROJECT, "WATCHDOG-STOPPED.txt"), `${new Date().toISOString()} ${reason}\n`);
  } catch {}
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pipeline.worker.ts' -and $_.Name -match 'bun' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: "ignore" });
    console.log("[WATCHDOG STOP] worker process stopped");
  } catch (e) {
    console.log(`[WATCHDOG STOP] could not stop the worker automatically: ${String(e).slice(0, 120)}`);
  }
  process.exit(0);
}

function onLine(line: string): void {
  const now = Date.now();
  if (SHOW.test(line)) console.log(line.slice(0, 260));
  // Amit, 4 Oct: if the cycle repeats, stop immediately. Any sign of a repeat or a hold ends the run.
  // Amit, 4 Oct: one confirming pass after this fix, then stop. The guard line for live round N is printed
  // BEFORE any fix for that round is paid for, so stopping on round >= MAX_LIVE_ROUND costs nothing more.
  const round = line.match(/\[guard\] live round (\d+):/);
  if (round && Number(round[1]) >= Number(process.env.MAX_LIVE_ROUND ?? 6)) stop(`live round ${round[1]} found findings again — stopping before any fix is paid for`);
  // 5 Oct (the 2-hour loop): the pool being exhausted starts a 5-minute poll-and-resume cycle that restarts agents and
  // spends money for nothing. Any quota-watch line, or repeated rejected requests, ends the run at once.
  if (line.includes("[quota-watch]")) stop("every model in the pool failed and the quota-watch cycle began — stopping before it restarts agents");
  if (line.includes("rejected a request ending with a model turn")) { rejected++; if (rejected >= 3) stop("the API rejected the request shape 3 times"); }
  if (line.includes("one-time retry")) { escalations++; if (escalations >= 2) stop("an agent escalated to its provider twice"); }
  if (line.includes("[GUARD HOLD]")) stop("the progress guard held the work — a finding came back or a round cost too much");
  if (line.includes("Stuck loop detected")) stop("the live fix loop saw the same findings again");
  const esc = line.match(/\[activity:escalate\] project=\S+ reason=(deploy_stuck|guard_hold|stuck_state|budget_exceeded|deploy_failed)/);
  if (esc) stop(`the run escalated: ${esc[1]}`);
  if (line.includes("[guard]")) void spend().then((s) => { lastGuardSpend = s; }).catch(() => {});

  const m = line.match(/^\[([\w-]+):(?:gemini-)?agent\] Starting/);
  if (m) {
    const key = m[1]!;
    const list = (starts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    list.push(now);
    starts.set(key, list);
    if (list.length > MAX_STARTS) stop(`${key} started ${list.length} times in 30 minutes — looping`);
  }

  const call = line.match(/^\[([\w-]+):(?:gemini-)?agent\] Tool call: (.{0,160})/);
  if (call) {
    lastCalls.push(`${call[1]}:${call[2]}`);
    if (lastCalls.length > 12) lastCalls.shift();
    if (lastCalls.length === 12 && lastCalls.every((c) => c === lastCalls[0])) stop(`12 identical tool calls in a row: ${lastCalls[0]!.slice(0, 120)}`);
  }
}

setInterval(() => {
  if (!existsSync(LOG)) return;
  const size = statSync(LOG).size;
  if (size < pos) pos = 0;
  if (size === pos) return;
  const fd = openSync(LOG, "r");
  const chunk = Buffer.alloc(size - pos);
  readSync(fd, chunk, 0, chunk.length, pos);
  closeSync(fd);
  pos = size;
  buf += chunk.toString("utf-8");
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() ?? "";
  for (const l of lines) onLine(l);
}, 2000);

setInterval(async () => {
  try {
    const s = await spend();
    if (Math.abs(s - lastPrinted) >= 0.25) {
      console.log(`[watch] spend $${s.toFixed(2)} (+$${(s - lastGuardSpend).toFixed(2)} since last guard line)`);
      lastPrinted = s;
    }
    if (s - START_SPEND >= MAX_DELTA) stop(`spend rose $${(s - START_SPEND).toFixed(2)} since this run started (Amit's limit: $${MAX_DELTA})`);
    if (s - lastGuardSpend > LIMIT_SINCE_GUARD) stop(`spend rose $${(s - lastGuardSpend).toFixed(2)} since the last guard line (limit $${LIMIT_SINCE_GUARD})`);
  } catch (e) {
    console.log(`[watch] could not read spend: ${String(e).slice(0, 100)}`);
  }
}, 20_000);
