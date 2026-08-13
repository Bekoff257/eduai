import { NextResponse, type NextRequest } from "next/server";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/dashboard/session-cookie";

/**
 * Redirects requests to /app/* that don't carry a verified Firebase
 * session cookie to /login. This is NOT the only auth check —
 * src/app/app/layout.tsx (and every dashboard Route Handler, via
 * src/lib/dashboard/auth.ts) independently re-verifies the token
 * server-side too, per Next.js's own guidance that a matcher
 * misconfiguration or refactor can silently lose proxy coverage. Proxy
 * defaults to the Node.js runtime in this Next.js version, so
 * firebase-admin's verifyIdToken() (real cryptographic verification, not
 * just decoding) works here without any Edge-runtime workaround.
 */
export async function proxy(request: NextRequest) {
  const isProtectedRoute = request.nextUrl.pathname.startsWith("/app");
  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  const idToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const decoded = idToken ? await verifyFirebaseIdToken(idToken) : null;

  if (!decoded) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets, image optimization,
     * and common metadata files — matching them would needlessly run auth
     * verification on every asset request.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
