import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listCustomers } from "@/lib/services/customers";

export async function GET(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? undefined;
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const result = await listCustomers(auth.organization.id, { query, page, pageSize: 20 });
  return NextResponse.json({ ok: true, ...result });
}
