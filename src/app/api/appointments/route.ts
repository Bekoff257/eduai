import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listAppointments } from "@/lib/services/appointments";

export async function GET(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get("timeframe") === "past" ? "past" : "upcoming";
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const nowIso = new Date().toISOString();

  const result = await listAppointments(auth.organization.id, {
    from: timeframe === "upcoming" ? nowIso : undefined,
    to: timeframe === "past" ? nowIso : undefined,
    page,
    pageSize: 20,
  });

  return NextResponse.json({ ok: true, ...result });
}
