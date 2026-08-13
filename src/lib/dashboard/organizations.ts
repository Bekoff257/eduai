import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface DashboardOrganization {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "staff";
}

/**
 * Resolves which organization(s) a VERIFIED Firebase uid belongs to, using
 * the service-role client with an explicit .eq("firebase_uid", ...) filter
 * — the same pattern already used and tested for the Telegram webhook.
 * There is no RLS gate for this query (service_role bypasses RLS by
 * design), so firebaseUid MUST already be the result of a real
 * verifyFirebaseIdToken() call server-side — never a value read from a
 * cookie/header/param without that verification step, and never supplied
 * by the browser as a plain, unverified argument. Every caller of this
 * function in this codebase goes through src/lib/dashboard/auth.ts, which
 * enforces that.
 */
export async function getMyOrganizations(firebaseUid: string): Promise<DashboardOrganization[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, slug)")
    .eq("firebase_uid", firebaseUid)
    .eq("is_active", true);

  if (error) {
    throw new Error(`getMyOrganizations failed: ${error.message}`);
  }

  interface Row {
    role: DashboardOrganization["role"];
    // organization_members.organization_id -> organizations.id is many-to-one,
    // but without generated Supabase types the client can't express that
    // statically for an embedded resource, so it infers an array. Narrowed
    // to the real one-or-none shape at runtime below.
    organizations: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
  }

  return ((data ?? []) as Row[])
    .map((row) => {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      return org ? { id: org.id, name: org.name, slug: org.slug, role: row.role } : null;
    })
    .filter((org): org is DashboardOrganization => org !== null);
}

/** Resolves the organization_members row id for a verified (firebaseUid,
 * organizationId) pair — needed anywhere the dashboard needs to record
 * WHO performed an action (messages.sender_member_id,
 * human_takeovers.member_id), since those columns reference
 * organization_members.id, not a Firebase uid directly. */
export async function getMemberId(
  firebaseUid: string,
  organizationId: string
): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("id")
    .eq("firebase_uid", firebaseUid)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`getMemberId failed: ${error.message}`);
  return data?.id ?? null;
}

export interface OrganizationMember {
  id: string;
  displayName: string | null;
  email: string | null;
  role: "owner" | "admin" | "staff";
  isActive: boolean;
}

/** For the Organization Settings "Members" section — lists every active
 * member of an organization. organizationId must already be a verified,
 * resolved id (never client-supplied) per this file's usual rule. */
export async function listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("id, display_name, email, role, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`listOrganizationMembers failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
  }));
}

export type OrganizationResolution =
  | { status: "none" }
  | { status: "single"; organization: DashboardOrganization }
  | { status: "multiple"; organizations: DashboardOrganization[] };

/**
 * The dashboard's single-organization-per-session assumption: if the
 * caller belongs to zero orgs, or more than one, that is surfaced as a
 * distinct state for the UI to render explicitly (see
 * src/app/app/layout.tsx) rather than silently guessing which one to use.
 * No org-selection mechanism exists yet — deliberately, per M3.1 scope.
 */
export async function resolveOrganization(firebaseUid: string): Promise<OrganizationResolution> {
  const organizations = await getMyOrganizations(firebaseUid);

  if (organizations.length === 0) return { status: "none" };
  if (organizations.length === 1) return { status: "single", organization: organizations[0] };
  return { status: "multiple", organizations };
}
