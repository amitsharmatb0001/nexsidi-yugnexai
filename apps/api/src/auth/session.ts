import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "nexsidi_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions(environment = process.env.NODE_ENV ?? "development") {
  return {
    httpOnly: true,
    secure: environment === "production",
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function sessionTokenFromRequest(request: Request): string | undefined {
  const cookies = request.headers.get("cookie");
  if (!cookies) return undefined;

  for (const item of cookies.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return value.join("=") || undefined;
  }

  return undefined;
}
