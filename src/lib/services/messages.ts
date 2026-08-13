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
