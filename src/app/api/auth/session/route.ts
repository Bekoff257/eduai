import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/dashboard/session-cookie";

/**
 * Called by the browser right after a successful Firebase sign-in/sign-up
 * (see src/lib/dashboard/browser-auth.ts) to persist the Firebase ID token
 * in an httpOnly cookie, so subsequent Server Component/Route Handler
 * requests can read it without the browser exposing it to page JS.
 *
 * The token itself is verified here before being stored — an invalid
 * token is rejected outright rather than persisted and only discovered
 * bad on the next page load.
 */
export async function POST(request: NextRequest) {
  const { idToken } = (await request.json().catch(() => ({}))) as { idToken?: string };

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cookieStore = await cookies();
  // Firebase ID tokens are short-lived (1 hour) — the cookie mirrors that,
  // and the browser re-POSTs a fresh token periodically (see
  // src/lib/dashboard/browser-auth.ts's onIdTokenChanged listener) rather
  // than this route ever minting/extending anything itself.
  cookieStore.set(SESSION_COOKIE_NAME, idToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  return NextResponse.json({ ok: true });
}

/** Called on sign-out to clear the session cookie. */
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
