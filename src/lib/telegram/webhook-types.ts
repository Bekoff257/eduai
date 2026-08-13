/**
 * Minimal subset of the Telegram Bot API "Update" shape actually used.
 * Not exhaustive — extend as needed, but keep it minimal and typed rather
 * than treating the payload as `any`, since it is unauthenticated input at
 * this point (secret_token header is verified separately by the caller).
 *
 * business_connection / business_message / edited_business_message /
 * deleted_business_messages are Telegram Business Bot Connections fields
 * (Bot API 7.2+) — see docs/architecture.md. A business_message is a DM to
 * a business owner's OWN connected Telegram account (not a chat with the
 * bot directly); business_connection announces when an owner connects,
 * reconfigures, or disconnects the bot from their account.
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  business_connection?: TelegramBusinessConnection;
  business_message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  /** Present on a business_message when set. Populated only on messages
   * sent BY THIS BOT on the business account's behalf — its absence on an
   * outgoing message in a connected chat is how we detect the human owner
   * replied manually (see webhook route). */
  sender_business_bot?: { id: number };
  /** Ties this message to a specific connected business account —
   * required as the business_connection_id parameter when sending a reply
   * so it's delivered as/from the owner's account rather than the bot. */
  business_connection_id?: string;
}

export interface TelegramBusinessConnection {
  id: string;
  user: { id: number; username?: string; first_name?: string; last_name?: string };
  user_chat_id: number;
  date: number;
  rights?: Record<string, boolean>;
  is_enabled: boolean;
}
