// Dashboard authentication + organization resolution tests.
//
// Drives the REAL running Next.js dev server over HTTP (proxy.ts, the
// /app/* layout, and the dashboard page all execute for real — nothing
// here is mocked). Identity is Firebase Authentication: test users are
// created via firebase-admin (server-side, no REST call needed) and
// signed in via Firebase's real Identity Toolkit REST API
// (accounts:signInWithPassword) to obtain a genuine Firebase ID token —
// the same token shape the browser client SDK would produce — which is
// then POSTed to /api/auth/session exactly as the real browser flow does
// (src/lib/dashboard/browser-auth.ts), to obtain the real httpOnly
// session cookie. Organization fixtures are created directly in Supabase
// (service-role) for two disposable orgs, cleaned up afterward.
//
// Run with: npm run test:dashboard
// Requires:
//   - A Next.js dev server already running (npm run dev) — this test does
//     not start one itself; it targets whatever APP_URL points at.
//   - Real Firebase credentials: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
//     FIREBASE_PRIVATE_KEY (Admin SDK, for creating/deleting test users)
//     and NEXT_PUBLIC_FIREBASE_API_KEY (Web API Key, for the REST
//     password-sign-in call) — see .env.example.
//   - Real Supabase Cloud credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// This test creates and deletes real Firebase user accounts and real rows
// in whatever Supabase project SUPABASE_URL points at — do not run it
// against a production project.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

function requireEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!FIREBASE_API_KEY) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!process.env.FIREBASE_PROJECT_ID) missing.push("FIREBASE_PROJECT_ID");
  if (!process.env.FIREBASE_CLIENT_EMAIL) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!process.env.FIREBASE_PRIVATE_KEY) missing.push("FIREBASE_PRIVATE_KEY");

  if (missing.length > 0) {
    console.error(
      `FAIL: missing required environment variable(s): ${missing.join(", ")}\n\n` +
        "This test needs real Firebase Admin SDK credentials (to create/delete\n" +
        "test users) and a real Firebase Web API Key (to sign in via the REST\n" +
        "API). It will NOT mock Firebase — set these in .env.local (see\n" +
        ".env.example) and try again."
    );
    process.exit(1);
  }
}

async function main() {
  requireEnv();

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Imported after requireEnv() so a missing-env failure is reported
  // cleanly rather than as a firebase-admin initialization crash.
  const { getApps, initializeApp, cert } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");

  const firebaseApp = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
  const firebaseAuth = getAuth(firebaseApp);

  let pass = 0;
  let fail = 0;
  function check(label, cond) {
    console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
    if (cond) pass++;
    else fail++;
  }

  async function appIsReachable() {
    try {
      const res = await fetch(APP_URL, { redirect: "manual" });
      return res.status > 0;
    } catch {
      return false;
    }
  }

  /** Creates a real Firebase user, signs in via the real Identity Toolkit
   * REST API to get a real ID token, then POSTs it to /api/auth/session
   * exactly as the browser does — returns the resulting Set-Cookie header
   * value to attach to subsequent requests. */
  async function createAndSignInFirebaseUser(email, password) {
    const userRecord = await firebaseAuth.createUser({ email, password, emailVerified: true });

    const signInRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const signInBody = await signInRes.json();
    if (!signInRes.ok || !signInBody.idToken) {
      throw new Error(`Firebase sign-in failed: ${JSON.stringify(signInBody)}`);
    }

    const sessionRes = await fetch(`${APP_URL}/api/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: signInBody.idToken }),
    });
    const setCookie = sessionRes.headers.get("set-cookie");
    if (!sessionRes.ok || !setCookie) {
      throw new Error(`/api/auth/session failed: ${sessionRes.status}`);
    }

    // Forward only the cookie name=value pair (strip Set-Cookie attributes
    // like Path/HttpOnly/Max-Age) for use as a request Cookie header.
    const cookieHeader = setCookie.split(";")[0];

    return { uid: userRecord.uid, cookieHeader };
  }

  if (!(await appIsReachable())) {
    console.error(
      `FAIL: ${APP_URL} is not reachable.\n\n` +
        "This test drives a REAL running Next.js dev server rather than mocking\n" +
        "HTTP behavior. Start one first: npm run dev (or set APP_URL to point at\n" +
        "an already-running instance), then retry."
    );
    process.exit(1);
  }
  console.log(`[setup] app reachable at ${APP_URL}`);

  // ----------------------------------------------------------------------------
  // Test 1: unauthenticated user cannot access /app/dashboard.
  // ----------------------------------------------------------------------------
  const unauthedRes = await fetch(`${APP_URL}/app/dashboard`, { redirect: "manual" });
  check(
    "Unauthenticated request to /app/dashboard is redirected (not 200)",
    unauthedRes.status >= 300 && unauthedRes.status < 400
  );
  const location = unauthedRes.headers.get("location") ?? "";
  check("Unauthenticated redirect target is /login", location.includes("/login"));

  // ----------------------------------------------------------------------------
  // Setup: two fresh, disposable Firebase users, each with their own
  // organization, created directly (not via the /signup flow, to keep this
  // test independent of that page's UI) so this test doesn't depend on or
  // mutate the shared seed fixtures other tests rely on.
  // ----------------------------------------------------------------------------
  const suffix = randomUUID().slice(0, 8);
  const userAEmail = `dashtest-a-${suffix}@example.com`;
  const userBEmail = `dashtest-b-${suffix}@example.com`;
  const password = "test-password-123!";

  const userA = await createAndSignInFirebaseUser(userAEmail, password);
  const userB = await createAndSignInFirebaseUser(userBEmail, password);

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  await admin.from("organizations").insert({ id: orgAId, name: `Dashtest Org A ${suffix}`, slug: `dashtest-org-a-${suffix}` });
  await admin.from("organizations").insert({ id: orgBId, name: `Dashtest Org B ${suffix}`, slug: `dashtest-org-b-${suffix}` });
  await admin.from("organization_members").insert({ organization_id: orgAId, firebase_uid: userA.uid, role: "owner" });
  await admin.from("organization_members").insert({ organization_id: orgBId, firebase_uid: userB.uid, role: "owner" });
  await admin.from("business_settings").insert({ organization_id: orgAId });
  await admin.from("business_settings").insert({ organization_id: orgBId });

  // Give Org A one customer + one conversation so the dashboard count
  // check has real, non-zero data to verify against.
  const customerId = randomUUID();
  await admin.from("customers").insert({
    id: customerId,
    organization_id: orgAId,
    telegram_chat_id: 700000 + Math.floor(Math.random() * 100000),
    full_name: "Dashboard Test Customer",
  });
  await admin.from("conversations").insert({ organization_id: orgAId, customer_id: customerId });

  console.log(`[setup] created two disposable Firebase users/orgs (Org A: ${orgAId}, Org B: ${orgBId})`);

  async function cleanup() {
    await admin.from("conversations").delete().eq("organization_id", orgAId);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("organization_members").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("business_settings").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("organizations").delete().in("id", [orgAId, orgBId]);
    await firebaseAuth.deleteUser(userA.uid).catch(() => {});
    await firebaseAuth.deleteUser(userB.uid).catch(() => {});
    console.log("[cleanup] removed test Firebase users, organizations, and fixtures");
  }

  try {
    // ----------------------------------------------------------------------------
    // Test 2 & 3: authenticated user (Org A owner) can access the
    // dashboard, and it resolves Org A specifically (not a hardcoded org,
    // not Org B) — i.e. organization resolution comes from THIS user's
    // real, server-verified Firebase identity.
    // ----------------------------------------------------------------------------
    const dashboardResA = await fetch(`${APP_URL}/app/dashboard`, {
      headers: { Cookie: userA.cookieHeader },
      redirect: "manual",
    });
    check("Authenticated Org A user can access /app/dashboard (200, no redirect)", dashboardResA.status === 200);

    const dashboardHtmlA = await dashboardResA.text();
    check(
      "Dashboard resolves and renders Org A's real organization name",
      dashboardHtmlA.includes(`Dashtest Org A ${suffix}`)
    );
    check(
      "Dashboard does NOT render Org B's organization name for Org A's user",
      !dashboardHtmlA.includes(`Dashtest Org B ${suffix}`)
    );

    // ----------------------------------------------------------------------------
    // Test 4 & 5: Org B's user cannot see Org A's data — tenant isolation
    // through the real HTTP + server-side-verified-Firebase-uid path, not
    // a direct DB query.
    // ----------------------------------------------------------------------------
    const dashboardResB = await fetch(`${APP_URL}/app/dashboard`, {
      headers: { Cookie: userB.cookieHeader },
      redirect: "manual",
    });
    const dashboardHtmlB = await dashboardResB.text();

    check("Authenticated Org B user can access /app/dashboard (200)", dashboardResB.status === 200);
    check("Org B's dashboard shows Org B's own name", dashboardHtmlB.includes(`Dashtest Org B ${suffix}`));
    check(
      "Org B's dashboard never renders Org A's organization name (tenant isolation over real HTTP)",
      !dashboardHtmlB.includes(`Dashtest Org A ${suffix}`)
    );

    // Org A has 1 customer/1 conversation seeded above; Org B has zero.
    check(
      "Org A's dashboard shows its real customer count (1), not zero",
      dashboardHtmlA.includes(">1<")
    );

    // ----------------------------------------------------------------------------
    // Test 6: user cannot arbitrarily choose another organization. There is
    // no client-facing parameter for this at all (no ?organizationId=,
    // no header) — verify a forged query param is simply ignored and Org
    // B's user still only ever sees Org B.
    // ----------------------------------------------------------------------------
    const forgedRes = await fetch(`${APP_URL}/app/dashboard?organizationId=${orgAId}`, {
      headers: { Cookie: userB.cookieHeader },
      redirect: "manual",
    });
    const forgedHtml = await forgedRes.text();
    check(
      "A forged ?organizationId= query param has no effect — Org B's user still only sees Org B",
      !forgedHtml.includes(`Dashtest Org A ${suffix}`) && forgedHtml.includes(`Dashtest Org B ${suffix}`)
    );

    // ----------------------------------------------------------------------------
    // Test 7: the session cookie is verified server-side, not just
    // trusted for its presence — a tampered/invalid token is rejected.
    // ----------------------------------------------------------------------------
    const tamperedRes = await fetch(`${APP_URL}/app/dashboard`, {
      headers: { Cookie: "firebase-id-token=not-a-real-token" },
      redirect: "manual",
    });
    check(
      "A tampered/invalid session cookie is rejected (redirected, not treated as authenticated)",
      tamperedRes.status >= 300 && tamperedRes.status < 400
    );

    // ----------------------------------------------------------------------------
    // Test 8: a user belonging to NO organization sees the correct empty
    // state, not a crash or a silently-created organization.
    // ----------------------------------------------------------------------------
    const orphanEmail = `dashtest-orphan-${suffix}@example.com`;
    const orphan = await createAndSignInFirebaseUser(orphanEmail, password);

    const orphanRes = await fetch(`${APP_URL}/app/dashboard`, {
      headers: { Cookie: orphan.cookieHeader },
      redirect: "manual",
    });
    const orphanHtml = await orphanRes.text();

    check(
      "User with no organization gets a 200 empty state (not a crash or redirect loop)",
      orphanRes.status === 200
    );
    check(
      "Empty state shows the correct 'no organization' message",
      orphanHtml.includes("don&#x27;t belong to an organization") ||
        orphanHtml.includes("don't belong to an organization")
    );

    const { data: orphanOrgCheck } = await admin
      .from("organization_members")
      .select("id")
      .eq("firebase_uid", orphan.uid);
    check("No organization was silently created for the orphan user", (orphanOrgCheck ?? []).length === 0);

    await firebaseAuth.deleteUser(orphan.uid).catch(() => {});
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL: unexpected error during dashboard auth test:", err);
  process.exit(1);
});
