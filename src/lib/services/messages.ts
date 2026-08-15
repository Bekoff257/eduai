import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type MessageSender = "customer" | "ai" | "staff" | "system";

export interface Message {
  id: string;
  organizationId: string;
  conversationId: string;
  sender: MessageSender;
  content: string;
  createdAt: string;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  conversation_id: string;
  sender: MessageSender;
  content: string;
  created_at: string;
}): Message {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    sender: row.sender,
    content: row.content,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = "id, organization_id, conversation_id, sender, content, created_at";

export type AppendMessageResult =
  | { ok: true; message: Message }
  | { ok: false; reason: "duplicate_update" };

/**
 * telegramUpdateId, when provided, relies on the existing unique partial
 * index uq_messages_org_telegram_update (organization_id, telegram_update_id)
 * for idempotency — Telegram may retry the same webhook delivery, and this
 * makes a duplicate insert a no-op (23505) rather than a duplicate message
 * or a duplicate AI response.
 */
export async function appendMessage(
  organizationId: string,
  input: {
    conversationId: string;
    sender: MessageSender;
    senderMemberId?: string;
    content: string;
    telegramMessageId?: number;
    telegramUpdateId?: number;
  }
): Promise<AppendMessageResult> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: input.conversationId,
      sender: input.sender,
      sender_member_id: input.senderMemberId ?? null,
      content: input.content,
      telegram_message_id: input.telegramMessageId ?? null,
      telegram_update_id: input.telegramUpdateId ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, reason: "duplicate_update" };
    }
    throw new Error(`appendMessage failed: ${error.message}`);
  }

  return { ok: true, message: mapRow(data) };
}

/**
 * Whether this customer has ever received an ai/staff reply, across ALL
 * of their conversations — not just the current one. Used to decide
 * whether the agent should deliver its proactive first-time introduction
 * (see system-prompt.ts) versus behave as it does for an ongoing/
 * returning conversation. Deliberately NOT based on "is the current
 * conversation's history empty": a conversation can be closed (dashboard
 * action) and a genuinely returning customer's next message opens a new
 * one with empty history, which must not re-trigger the intro.
 *
 * messages has no customer_id column directly (only conversation_id) —
 * joins through conversations, which does have customer_id, via
 * PostgREST's embedded-resource filter syntax.
 */
export async function hasReceivedPriorReply(
  organizationId: string,
  customerId: string
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from("messages")
    .select("id, conversations!inner(customer_id)", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("conversations.customer_id", customerId)
    .in("sender", ["ai", "staff"]);

  if (error) throw new Error(`hasReceivedPriorReply failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Whether the customer has sent a message in this conversation strictly
 * after `sinceIso` — used by the M6 automation engine's customer_replied
 * stop condition (src/lib/automation/stop-conditions.ts) to detect "the
 * customer already responded, so a scheduled follow-up must not fire."
 * Conversation-scoped rather than customer-scoped like hasReceivedPriorReply
 * above: a reply in a DIFFERENT conversation for the same customer isn't
 * evidence they saw or responded to THIS automation's messages.
 */
export async function hasCustomerRepliedSince(
  organizationId: string,
  conversationId: string,
  sinceIso: string
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("sender", "customer")
    .gt("created_at", sinceIso);

  if (error) throw new Error(`hasCustomerRepliedSince failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Most-recent-first is how Postgres returns it fastest (index on
 * (conversation_id, created_at)); callers that need chronological order
 * for building AI conversation history should reverse the result.
 */
export async function listRecentMessages(
  organizationId: string,
  conversationId: string,
  limit = 20
): Promise<Message[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("messages")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listRecentMessages failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}
