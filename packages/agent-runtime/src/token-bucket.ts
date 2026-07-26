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

class FileLock {
  private lockPath: string;
  constructor(baseDir: string) {
    this.lockPath = join(baseDir, "shared-token-bucket.lock");
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
    while (true) {
      try {
        mkdirSync(this.lockPath);
        break;
      } catch {
        attempts++;
        if (attempts > 30) {
          try { rmdirSync(this.lockPath); } catch {}
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
    const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
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
