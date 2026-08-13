import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { updateCustomer } from "@/lib/services/customers";

const updateCustomerSchema = z.object({
  fullName: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  language: z.string().trim().max(10).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { customerId } = await params;

  const parsed = updateCustomerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const customer = await updateCustomer(auth.organization.id, customerId, parsed.data);
  if (!customer) {
    return NextResponse.json({ ok: false, error: "Customer not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, customer });
}
