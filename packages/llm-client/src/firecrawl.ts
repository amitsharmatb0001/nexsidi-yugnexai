// Phase 5 (full agentic upgrade): Firecrawl page-fetch, the shared
// primitive both agents/planner/src/index.ts and
// packages/agent-runtime/src/tools/research.ts call — previously
// duplicated (planner had its own copy; agent-runtime's version didn't
// exist yet). Lives here, not in agent-runtime, because the planner's own
// tsconfig.json sets a strict `rootDir: "src"` that cannot import outside
// its own package (confirmed live: TS6059 "File ... is not under rootDir"
// when this was first tried as an agent-runtime import) — @nexsidi/llm-client
// is the lowest-level package both sides already depend on cleanly.
export interface FirecrawlFetchResult {
  success: boolean;
  content?: string;
  title?: string;
  error?: string;
}

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1";
const FETCH_MAX_CHARS = 4000;

export async function firecrawlFetchUrl(
  rawUrl: string,
  opts?: { timeoutMs?: number },
): Promise<FirecrawlFetchResult> {
  const url = rawUrl.trim();
  if (!url) {
    return { success: false, error: "firecrawlFetchUrl requires a non-empty url" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { success: false, error: `firecrawlFetchUrl: '${url}' is not a valid URL` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { success: false, error: `firecrawlFetchUrl: unsupported protocol '${parsed.protocol}' — only http/https allowed` };
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { success: false, error: "firecrawlFetchUrl not configured — FIRECRAWL_API_KEY missing" };
  }

  const timeout = Math.min(opts?.timeoutMs ?? 15_000, 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${FIRECRAWL_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = (await res.json()) as {
      success: boolean;
      data?: { markdown: string; metadata?: { title?: string } };
      error?: string;
    };

    if (!data.success || !data.data?.markdown) {
      return { success: false, error: `could not fetch '${url}'${data.error ? ` (${data.error})` : ""}` };
    }

    return {
      success: true,
      content: data.data.markdown.slice(0, FETCH_MAX_CHARS),
      title: data.data.metadata?.title,
    };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: `fetch failed: ${String(err)}` };
  }
}
