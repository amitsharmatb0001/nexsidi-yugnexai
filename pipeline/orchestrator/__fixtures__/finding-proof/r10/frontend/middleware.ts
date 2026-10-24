import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPaths = ["/sign-in", "/sign-up", "/about", "/contact", "/menu"];
const adminPaths = ["/staff"];

function decodeRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    let base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    const json = atob(base64);
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path.startsWith(p)) || path === "/";
  const token = request.cookies.get("token")?.value;

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  if (token && (path === "/sign-in" || path === "/sign-up")) {
    return NextResponse.redirect(new URL("/my-orders", request.url));
  }
  const role = token ? decodeRole(token) : null;
  if (token && adminPaths.some((p) => path.startsWith(p)) && role !== "staff" && role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|[^?]*\.(?:css|js|png|jpg|svg|ico|webp|woff2?)).*)",
    "/(api|trpc)(.*)",
  ],
};