import "server-only";
import { NextResponse } from "next/server";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import type { DashboardOrganization } from "@/lib/dashboard/organizations";
import type { DashboardUser } from "@/lib/dashboard/auth";

export type OrgApiAuthResult =
  | { ok: true; user: DashboardUser; organization: DashboardOrganization }
  | { ok: false; response: NextResponse };

/**
 * Shared auth guard for dashboard Route Handlers that mutate data scoped
 * to a single resolved organization (courses, leads, telegram settings,
 * etc). Wraps getDashboardAuth() — the only source of a verified
 * organizationId in this codebase — and collapses its three possible
 * states (unauthenticated / no org / multiple orgs) into a single ready-
 * made error response, since a mutation route has no meaningful UI to
 * render for those cases the way a page does.
 *
 * Callers still need to check `organization.role` themselves for
 * admin-only actions (e.g. Telegram connect) — this only proves WHO is
 * calling and WHICH single organization they belong to, not what they're
 * allowed to do within it.
 */
export async function requireOrgApiAuth(): Promise<OrgApiAuthResult> {
  const auth = await getDashboardAuth();

  if (auth.status === "unauthenticated") {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 }),
    };
  }

  if (auth.organization.status !== "single") {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "No single organization resolved for this account" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user: auth.user, organization: auth.organization.organization };
}

/** For actions restricted to owner/admin (e.g. Telegram bot connect,
 * organization settings, member management). */
export function requireAdminRole(organization: DashboardOrganization): NextResponse | null {
  if (organization.role !== "owner" && organization.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "This action requires an owner or admin role" },
      { status: 403 }
    );
  }
  return null;
}
