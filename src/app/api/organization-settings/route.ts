import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth, requireAdminRole } from "@/lib/dashboard/api-auth";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getBusinessSettings, updateBusinessSettings } from "@/lib/services/business-settings";
import { listOrganizationMembers } from "@/lib/dashboard/organizations";

export async function GET() {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const [settings, members] = await Promise.all([
    getBusinessSettings(auth.organization.id),
    listOrganizationMembers(auth.organization.id),
  ]);

  return NextResponse.json({
    ok: true,
    organization: auth.organization,
    settings,
    members,
  });
}

const updateSchema = z.object({
  organizationName: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().max(100).optional(),
});

export async function PATCH(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const roleError = requireAdminRole(auth.organization);
  if (roleError) return roleError;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  if (parsed.data.organizationName !== undefined) {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("organizations")
      .update({ name: parsed.data.organizationName })
      .eq("id", auth.organization.id);
    if (error) {
      return NextResponse.json({ ok: false, error: "Failed to update organization name" }, { status: 500 });
    }
  }

  if (parsed.data.timezone !== undefined) {
    await updateBusinessSettings(auth.organization.id, { timezone: parsed.data.timezone });
  }

  return NextResponse.json({ ok: true });
}
