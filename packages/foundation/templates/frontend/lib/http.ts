import { getToken } from "./session";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** A refused or failed request; `message` is the server's words, fit to show. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Calls the API at its full path ("/api/v1/menu") and returns what is inside `data`. A refusal or failure throws ApiError.
 * A signed-in browser sends its token; pass `token` when calling from the server.
 */
export async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const token = options.token ?? getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: "no-store",
  });
  const answer = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !answer?.success) throw new ApiError(res.status, answer?.error ?? "Something went wrong, please try again");
  return answer.data as T;
}
