import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const publicPaths = ["/sign-in", "/sign-up"];

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path.startsWith(p));

  if (!userId && !isPublic) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/((?!_next|favicon.ico|[^?]*\.(?:css|js|png|jpg|svg|ico|webp|woff2?)).*)", "/(api|trpc)(.*)"],
};
