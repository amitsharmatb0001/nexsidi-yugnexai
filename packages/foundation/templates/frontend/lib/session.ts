const COOKIE = "token";
const DAY_SECONDS = 24 * 60 * 60;

export interface SessionUser {
  id: string;
  email: string;
  role: string;
}

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export function setToken(token: string): void {
  document.cookie = `${COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${DAY_SECONDS}; SameSite=Lax`;
}

export function clearToken(): void {
  document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** Who the token says is signed in, for showing the right links. The server checks every request itself. */
export function currentUser(): SessionUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const part = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part)) as { sub?: unknown; email?: unknown; role?: unknown; exp?: number };
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null;
    return { id: String(payload.sub), email: String(payload.email), role: String(payload.role) };
  } catch {
    return null;
  }
}
