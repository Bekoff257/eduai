import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { updateLead } from "@/lib/services/leads";

const updateLeadSchema = z.object({
  status: z
    .enum(["new", "contacted", "qualified", "appointment_booked", "converted", "lost"])
    .optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { leadId } = await params;

  const parsed = updateLeadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const lead = await updateLead(auth.organization.id, leadId, parsed.data);
  if (!lead) {
    return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, lead });
}
