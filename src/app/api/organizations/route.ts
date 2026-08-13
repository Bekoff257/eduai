import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { SESSION_COOKIE_NAME } from "@/lib/dashboard/session-cookie";

// organizations.slug check constraint: ^[a-z0-9]+(-[a-z0-9]+)*$
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Creates an organization and makes the CALLING (verified) Firebase user
 * its owner, via create_organization_with_owner() — now service_role-only
 * (see supabase/migrations/20260813073010_firebase_auth_migration.sql),
 * since there is no more Supabase-Auth session for that function's old
 * auth.uid()-based design to read. The owner uid always comes from a
 * verified session cookie here, never from the request body — a client
 * could send any businessName it wants, but never choose who becomes the
 * owner.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const idToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!idToken) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const { businessName } = (await request.json().catch(() => ({}))) as { businessName?: string };
  if (!businessName || typeof businessName !== "string" || businessName.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "Business name is required" }, { status: 400 });
  }

  const slug = slugify(businessName);
  if (!slug) {
    return NextResponse.json({ ok: false, error: "Business name is required" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_organization_with_owner", {
    org_name: businessName.trim(),
    org_slug: slug,
    owner_firebase_uid: decoded.uid,
  });

  if (error) {
    const message = error.message.toLowerCase().includes("duplicate")
      ? "That business name is already taken. Please choose another."
      : "Unable to set up your organization. Please try again.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, organizationId: data });
}
