import { NextResponse } from "next/server";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listConversationsForCustomer } from "@/lib/services/conversations";
import { listLeadsForCustomer } from "@/lib/services/leads";
import { listAppointmentsForCustomer } from "@/lib/services/appointments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { customerId } = await params;

  const [conversations, leads, appointments] = await Promise.all([
    listConversationsForCustomer(auth.organization.id, customerId),
    listLeadsForCustomer(auth.organization.id, customerId),
    listAppointmentsForCustomer(auth.organization.id, customerId),
  ]);

  return NextResponse.json({ ok: true, conversations, leads, appointments });
}
