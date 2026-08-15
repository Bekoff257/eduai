import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listRunsForAutomation } from "@/lib/services/automations";

export async function GET(request: NextRequest, { params }: { params: Promise<{ automationId: string }> }) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { automationId } = await params;

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const { runs, totalCount } = await listRunsForAutomation(auth.organization.id, automationId, { page });
  return NextResponse.json({ ok: true, runs, totalCount });
}
