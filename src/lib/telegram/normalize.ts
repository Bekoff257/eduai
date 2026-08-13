import type { TelegramUpdate, TelegramMessage } from "@/lib/telegram/webhook-types";
import type { InboundMessage } from "@/lib/ai/types";

/**
 * Telegram -> normalized InboundMessage. This is the ONLY place that knows
 * about Telegram's payload shape — the agent and tools never see it. A
 * second channel later means writing a sibling normalize function that
 * also produces an InboundMessage, not touching agent.ts or tools/*.
 *
 * Handles both a direct DM to the bot (update.message) and a DM to a
 * business owner's connected personal account (update.business_message) —
 * same InboundMessage shape either way; the webhook route branches on
 * which one populated organizationId/routing before calling this, and on
 * whether metadata.businessConnectionId is present when sending the reply.
 *
 * Returns null for updates that aren't a plain text message (e.g. edited
 * messages, non-text content, channel posts) — the webhook route should
 * acknowledge these to Telegram without processing them. Also returns null
 * for a business_message that was sent BY OUR OWN BOT (sender_business_bot
 * present) — that's an echo of our own reply, not an inbound customer
 * message, and must never be re-processed as one.
 */
export function normalizeTelegramUpdate(
  organizationId: string,
  update: TelegramUpdate
): InboundMessage | null {
  const message = update.message ?? update.business_message;
  if (!message || typeof message.text !== "string" || message.text.length === 0) {
    return null;
  }
  if (message.sender_business_bot) {
    return null;
  }

  return {
    channel: "telegram",
    organizationId,
    externalUserId: String(message.chat.id),
    messageId: String(message.message_id),
    text: message.text,
    timestamp: new Date(message.date * 1000).toISOString(),
    metadata: buildMetadata(update, message),
  };
}

function buildMetadata(update: TelegramUpdate, message: TelegramMessage): Record<string, unknown> {
  return {
    updateId: update.update_id,
    telegramMessageId: message.message_id,
    telegramChatId: message.chat.id,
    telegramFromUserId: message.from?.id,
    telegramUsername: message.from?.username,
    telegramFirstName: message.from?.first_name,
    telegramLastName: message.from?.last_name,
    businessConnectionId: message.business_connection_id,
  };
}
