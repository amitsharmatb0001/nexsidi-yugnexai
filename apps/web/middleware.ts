import { NextResponse, type NextRequest } from "next/server";

const publicPaths = new Set(["/", "/sign-in", "/sign-up", "/compare"]);

function isPublicBuildPage(pathname: string): boolean {
  return /^\/build\/[a-f0-9]+$/.test(pathname);
}

export default function middleware(request: NextRequest) {
  if (publicPaths.has(request.nextUrl.pathname)) return NextResponse.next();
  if (isPublicBuildPage(request.nextUrl.pathname)) return NextResponse.next();
  if (request.cookies.has("nexsidi_session")) return NextResponse.next();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
