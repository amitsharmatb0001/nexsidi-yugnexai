// Bun-side client for the Node browser worker (browser/worker.mjs).
//
// The pipeline runs under Bun, where Playwright's browser layer does not work
// (proven — see worker.mjs header). This spawns the worker as a Node
// subprocess and drives it over newline-delimited JSON on stdio, so the
// agent's browser tools run their Playwright work under Node while the rest of
// the harness stays on Bun.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface BrowserResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

// Pure framing helper — split a growing stdout buffer into complete JSON
// lines and hand each parsed object to a callback, returning the leftover
// partial line. Separated out so the request/response correlation is
// unit-testable without spawning a real subprocess (see client.test.ts).
export function drainJsonLines(
  buffer: string,
  onMessage: (msg: { id: unknown } & BrowserResponse) => void,
): string {
  let idx: number;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      onMessage(JSON.parse(line));
    } catch {
      // ignore non-JSON noise on stdout (shouldn't happen — worker keeps
      // Chrome's stderr separate — but never let it crash the client)
    }
  }
  return buffer;
}

const WORKER_PATH = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

export class BrowserSession {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = "";
  private ready: Promise<void>;
  private closed = false;

  constructor(nodeBin = "node") {
    this.proc = spawn(nodeBin, [WORKER_PATH], { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;

    let readyResolved = false;
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    this.ready = new Promise((res, rej) => {
      resolveReady = () => { readyResolved = true; res(); };
      rejectReady = rej;
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => {
      this.buffer = drainJsonLines(this.buffer + chunk, (msg) => {
        if (msg.id === "ready") { resolveReady(); return; }
        const entry = this.pending.get(msg.id as number);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(msg.id as number);
        if (msg.ok) entry.resolve(msg.result);
        else entry.reject(new Error(msg.error ?? "browser worker error"));
      });
    });

    let stderrTail = "";
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (c: string) => {
      stderrTail = (stderrTail + c).slice(-500);
      if (process.env.NEXSIDI_BROWSER_DEBUG) process.stderr.write(`[worker-stderr] ${c}`);
    });

    this.proc.on("error", (err) => { rejectReady(err); this.failAll(err); });
    this.proc.on("exit", (code) => {
      this.closed = true;
      // CRITICAL: if the worker dies before the ready handshake (bad worker
      // path, missing playwright, crash), reject `ready` too — otherwise
      // every `await this.ready` hangs forever with no error. Surface the
      // worker's stderr so the cause is visible, not a silent timeout.
      const err = new Error(`browser worker exited (code ${code})${stderrTail ? ` — stderr: ${stderrTail.trim()}` : ""}`);
      if (!readyResolved) rejectReady(err);
      this.failAll(err);
    });
  }

  private failAll(err: Error) {
    for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(err); }
    this.pending.clear();
  }

  async send(action: string, args: Record<string, unknown> = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    await this.ready;
    if (this.closed) throw new Error("browser worker is closed");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`browser worker timed out after ${timeoutMs}ms on '${action}'`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, action, ...args }) + "\n");
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try { await this.send("close", {}, 5_000); } catch { /* best effort */ }
    this.closed = true;
    this.proc.kill("SIGTERM");
  }
}
