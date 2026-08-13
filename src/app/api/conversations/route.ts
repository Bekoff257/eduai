import { NextRequest, NextResponse } from "next/server";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listConversations, type ConversationStatus } from "@/lib/services/conversations";

const VALID_STATUSES: ConversationStatus[] = ["open", "closed", "needs_attention"];

export async function GET(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status = VALID_STATUSES.includes(statusParam as ConversationStatus)
    ? (statusParam as ConversationStatus)
    : undefined;
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const result = await listConversations(auth.organization.id, { status, page, pageSize: 30 });
  return NextResponse.json({ ok: true, ...result });
}
