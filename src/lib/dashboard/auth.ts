import "server-only";
import { cookies } from "next/headers";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { resolveOrganization, type OrganizationResolution } from "@/lib/dashboard/organizations";
import { SESSION_COOKIE_NAME } from "@/lib/dashboard/session-cookie";

export interface DashboardUser {
  uid: string;
  email: string | null;
}

export type DashboardAuthResult =
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: DashboardUser; organization: OrganizationResolution };

/**
 * The single entry point for "who is making this dashboard request, and
 * what organization do they belong to." Every /app/* Server Component and
 * every dashboard-facing Route Handler calls this — never
 * verifyFirebaseIdToken()/resolveOrganization() directly — so there is
 * exactly one place that defines what counts as an authenticated,
 * authorized dashboard request.
 *
 * Flow: read the httpOnly session cookie (set by POST /api/auth/session
 * right after a real Firebase sign-in) -> verify it server-side via
 * firebase-admin (never trust the cookie's mere presence, or its contents
 * unverified) -> resolve organization membership via the service-role
 * client, filtered by the VERIFIED uid. No organizationId or uid is ever
 * accepted as an argument from anything browser-controlled.
 */
export async function getDashboardAuth(): Promise<DashboardAuthResult> {
  const cookieStore = await cookies();
  const idToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!idToken) {
    return { status: "unauthenticated" };
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded) {
    return { status: "unauthenticated" };
  }

  const organization = await resolveOrganization(decoded.uid);

  return {
    status: "authenticated",
    user: { uid: decoded.uid, email: decoded.email ?? null },
    organization,
  };
}
