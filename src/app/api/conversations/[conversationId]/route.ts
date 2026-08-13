import { NextResponse } from "next/server";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { getConversation } from "@/lib/services/conversations";
import { getCustomer } from "@/lib/services/customers";
import { listRecentMessages } from "@/lib/services/messages";
import { getOpenHumanTakeover } from "@/lib/services/human-takeovers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { conversationId } = await params;

  const conversation = await getConversation(auth.organization.id, conversationId);
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const [customer, recentMessages, openTakeover] = await Promise.all([
    getCustomer(auth.organization.id, conversation.customerId),
    listRecentMessages(auth.organization.id, conversationId, 100),
    getOpenHumanTakeover(auth.organization.id, conversationId),
  ]);

  return NextResponse.json({
    ok: true,
    conversation,
    customer,
    messages: recentMessages.reverse(),
    openTakeover,
  });
}
