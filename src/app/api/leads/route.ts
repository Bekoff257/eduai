import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listLeads, type LeadStatus } from "@/lib/services/leads";

const VALID_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "appointment_booked",
  "converted",
  "lost",
];

export async function GET(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status = VALID_STATUSES.includes(statusParam as LeadStatus)
    ? (statusParam as LeadStatus)
    : undefined;
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const result = await listLeads(auth.organization.id, { status, page, pageSize: 20 });
  return NextResponse.json({ ok: true, ...result });
}
