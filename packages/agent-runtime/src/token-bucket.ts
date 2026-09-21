import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";

// NIM's actual published limit is 40 requests/minute per model, not a token
// budget. The previous token-based implementation allowed ~400 RPM worth of
// normal-sized requests before throttling — barely any throttling at all.
// This replaces it with a request counter: 40 requests/minute, shared across
// all parallel agents using the same shared file path.

interface BucketState {
  requests: number;      // requests consumed in the current window
  windowStart: number;   // epoch ms when the current 60-second window began
}

// Exported so token-bucket.test.ts can construct one directly with a short
// maxWaitMs override — the real 60s default would make a test proving the
// timeout actually fires prohibitively slow to run.
export class FileLock {
  private lockPath: string;
  private maxWaitMs: number;
  constructor(baseDir: string, maxWaitMs = 60_000) {
    this.lockPath = join(baseDir, "shared-token-bucket.lock");
    this.maxWaitMs = maxWaitMs;
  }

  public async acquire(): Promise<void> {
    // 2026-07-25 (P5.W5.5): mkdirSync(this.lockPath) below throws ENOENT
    // (not EEXIST) when its PARENT directory doesn't exist yet — a brand
    // new BUILD_DIR nobody has created. The catch below treats every
    // failure as "another process holds the lock" and retries forever;
    // ENOENT never resolves itself no matter how many times it's retried,
    // so a caller with a fresh BUILD_DIR hung here permanently with zero
    // log output. Ensuring the parent exists up front makes every
    // subsequent mkdirSync failure a genuine EEXIST (real contention),
    // which the retry loop already handles correctly.
    mkdirSync(dirname(this.lockPath), { recursive: true });
    let attempts = 0;
    // 2026-08-30: real, live, repeated (3x in one night) silent hang inside
    // runAgent — "Starting — model: X" logged, then nothing for 8-14+
    // minutes: no error, no usage line, no escalation, no log line at all.
    // Root cause not confirmed (this codebase's other rate-limit/timeout
    // paths were checked live and ruled out — see loop.ts's comment at its
    // bucket.acquire() call site), but this exact loop is the ONE remaining
    // candidate that had NO cap and NO log output of its own: the >30-
    // attempts branch already tries to break a stale lock via rmdirSync,
    // but on failure that error is silently swallowed (`catch {}`) and the
    // SAME uncapped loop just continues — if rmdirSync never succeeds (a
    // permissions issue, a race with another process, anything), this can
    // spin at 100ms intervals literally forever with zero visible evidence
    // it's even running. Same defense-in-depth reasoning as tonight's
    // earlier fix to the OTHER (differently-named, differently-located)
    // token bucket's own unbounded wait: cap it, throw with a message that
    // actually says what's stuck, so a hang here is diagnosable and
    // recoverable (via the existing deploy_activity_error retry path)
    // instead of silent and permanent.
    const deadline = Date.now() + this.maxWaitMs;
    while (true) {
      try {
        mkdirSync(this.lockPath);
        break;
      } catch (err) {
        attempts++;
        if (attempts > 30) {
          try { rmdirSync(this.lockPath); } catch {}
        }
        if (Date.now() >= deadline) {
          throw new Error(`[token-bucket] FileLock.acquire timed out after ${this.maxWaitMs}ms waiting for ${this.lockPath} (${attempts} attempts) — last error: ${String(err)}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  public release(): void {
    try { rmdirSync(this.lockPath); } catch {}
  }
}

export class SharedTokenBucket {
  private filePath: string;
  private lock: FileLock;
  private readonly maxRequestsPerMinute = 40; // NIM's actual RPM limit

  constructor() {
    const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
    this.filePath = join(buildDir, "shared-token-bucket.json");
    this.lock = new FileLock(buildDir);
  }

  private readState(): BucketState {
    if (!existsSync(this.filePath)) {
      return { requests: 0, windowStart: Date.now() };
    }
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return { requests: 0, windowStart: Date.now() };
    }
  }

  private writeState(state: BucketState): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf-8");
    } catch {}
  }

  // Blocks until there is capacity for one request in the current 60-second
  // window. Resets the window counter when 60 seconds have elapsed.
  // Skips rate limiting entirely when NIM_API_KEY is absent (test environments
  // mock the LLM client so there is no real API to protect).
  public async acquire(_estimatedTokens?: number): Promise<void> {
    if (!process.env["NIM_API_KEY"]) return;
    while (true) {
      await this.lock.acquire();
      let acquired = false;
      let waitMs = 0;
      try {
        const state = this.readState();
        const now = Date.now();
        const windowElapsed = now - state.windowStart;

        if (windowElapsed >= 60_000) {
          // New window — reset counter
          state.requests = 1;
          state.windowStart = now;
          this.writeState(state);
          acquired = true;
        } else if (state.requests < this.maxRequestsPerMinute) {
          state.requests += 1;
          this.writeState(state);
          acquired = true;
        } else {
          waitMs = 60_000 - windowElapsed + 100;
        }
      } finally {
        this.lock.release();
      }

      if (acquired) break;
      console.log(`[rate-limiter] NIM 40 RPM limit reached. Waiting ${Math.round(waitMs / 1000)}s for next window...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
