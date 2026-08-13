import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;

  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0];
    return adminApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables"
    );
  }

  adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  return adminApp;
}

/**
 * Verifies a Firebase ID token server-side. This is the ONLY point where a
 * dashboard request's identity is trusted — every server-side dashboard
 * code path (src/lib/dashboard/auth.ts) calls this before doing anything
 * else, and never trusts a uid supplied any other way (cookie contents
 * alone, request body, query params). Returns null on any verification
 * failure (expired, malformed, wrong project, revoked) rather than
 * throwing, so callers have one simple "not authenticated" branch.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken | null> {
  try {
    return await getAuth(getAdminApp()).verifyIdToken(idToken, true);
  } catch {
    return null;
  }
}
