import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { getMemberId } from "@/lib/dashboard/organizations";
import { getConversation, touchConversationLastMessageAt } from "@/lib/services/conversations";
import { getCustomer } from "@/lib/services/customers";
import { appendMessage } from "@/lib/services/messages";
import { getTelegramIntegrationByOrganizationId } from "@/lib/services/telegram-integrations";
import { sendTelegramMessage } from "@/lib/telegram/client";

const sendMessageSchema = z.object({
  content: z.string().trim().min(1, "Message cannot be empty").max(4000),
});

/**
 * Sends a staff reply into a conversation and relays it to the customer
 * over Telegram — the dashboard equivalent of the webhook's step 9/10.
 * Does NOT require the conversation to already be in human mode (a staff
 * member should be able to send one message without necessarily taking
 * over permanently), but doing so repeatedly without taking over means the
 * AI could still respond to the customer's next message — the UI nudges
 * toward taking over first, but this endpoint itself only sends a message.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { conversationId } = await params;

  const parsed = sendMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const conversation = await getConversation(auth.organization.id, conversationId);
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const [customer, integration, memberId] = await Promise.all([
    getCustomer(auth.organization.id, conversation.customerId),
    getTelegramIntegrationByOrganizationId(auth.organization.id),
    getMemberId(auth.user.uid, auth.organization.id),
  ]);

  if (!customer || customer.telegramChatId === null) {
    return NextResponse.json({ ok: false, error: "This customer has no Telegram chat to reply to" }, { status: 400 });
  }
  if (!integration) {
    return NextResponse.json({ ok: false, error: "No Telegram bot connected for this organization" }, { status: 400 });
  }

  const stored = await appendMessage(auth.organization.id, {
    conversationId,
    sender: "staff",
    senderMemberId: memberId ?? undefined,
    content: parsed.data.content,
  });
  if (!stored.ok) {
    return NextResponse.json({ ok: false, error: "Failed to store message" }, { status: 500 });
  }

  await touchConversationLastMessageAt(auth.organization.id, conversationId);

  const sendResult = await sendTelegramMessage({
    botToken: integration.botToken,
    chatId: customer.telegramChatId,
    text: parsed.data.content,
  });
  if (!sendResult.ok) {
    return NextResponse.json(
      { ok: true, message: stored.message, telegramWarning: "Message saved but failed to deliver via Telegram" },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true, message: stored.message });
}
