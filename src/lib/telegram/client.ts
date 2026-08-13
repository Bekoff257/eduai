import "server-only";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/** Telegram's own documented per-chat limit is roughly 1 message/second.
 * Tracked per (botToken, chatId) pair in-process — good enough for a
 * single Next.js server process; does not coordinate across multiple
 * server instances, which would need a shared store (e.g. Postgres) if
 * this app were ever horizontally scaled. Not attempted here since this
 * app runs as a single Next.js deployment target. */
const MIN_MS_BETWEEN_SENDS_PER_CHAT = 1100;
const lastSendAtByChat = new Map<string, number>();

function throttleKey(botToken: string, chatId: number | string): string {
  return `${botToken}:${chatId}`;
}

async function waitForChatThrottle(botToken: string, chatId: number | string): Promise<void> {
  const key = throttleKey(botToken, chatId);
  const lastSendAt = lastSendAtByChat.get(key);
  if (lastSendAt !== undefined) {
    const elapsed = Date.now() - lastSendAt;
    if (elapsed < MIN_MS_BETWEEN_SENDS_PER_CHAT) {
      await sleep(MIN_MS_BETWEEN_SENDS_PER_CHAT - elapsed);
    }
  }
  lastSendAtByChat.set(key, Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_SEND_ATTEMPTS = 3;
/** Fallback backoff when Telegram's response doesn't include a
 * parameters.retry_after (e.g. a plain network error, not a 429) —
 * standard exponential backoff. */
const BASE_BACKOFF_MS = 500;

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
  result?: { username?: string };
}

/**
 * Thin wrapper around the Telegram Bot API. Each organization has its own
 * bot token (stored in telegram_integrations), so the token is passed in
 * per-call rather than read from a single global env var.
 *
 * Retries transient failures (network errors, 5xx, and Telegram's own
 * 429/FLOOD_WAIT with its documented retry_after field) up to
 * MAX_SEND_ATTEMPTS times with backoff, and throttles sends to the same
 * chat to roughly Telegram's own ~1 msg/sec per-chat limit — relevant now
 * that a single conversation can receive an AI reply AND a follow-up/
 * reminder in quick succession, not just one message per webhook call.
 * Does not retry a genuine rejection (e.g. bad chat id, blocked bot,
 * expired business connection) — only failures where retrying has a
 * realistic chance of succeeding.
 */
export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: number | string;
  text: string;
  /** When set, the message is sent AS the connected business account
   * (looks to the customer like the owner typed it themselves — no bot
   * label) rather than from the bot's own identity. Comes from the
   * inbound business_message's business_connection_id, passed straight
   * through — never invented/guessed by our code. Omit for a normal
   * direct-to-bot chat. */
  businessConnectionId?: string;
}): Promise<{ ok: boolean; description?: string }> {
  const { botToken, chatId, text, businessConnectionId } = params;

  await waitForChatThrottle(botToken, chatId);

  let lastResult: { ok: boolean; description?: string } = { ok: false, description: "not attempted" };

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    let data: TelegramApiResponse | null = null;
    let networkError: unknown = null;

    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
        }),
      });
      data = (await res.json()) as TelegramApiResponse;
    } catch (err) {
      networkError = err;
    }

    if (data?.ok) {
      return { ok: true };
    }

    lastResult = { ok: false, description: data?.description ?? (networkError instanceof Error ? networkError.message : "network error") };

    const isLastAttempt = attempt === MAX_SEND_ATTEMPTS;
    if (isLastAttempt) break;

    const retryable = networkError !== null || (data?.error_code !== undefined && data.error_code >= 500) || data?.error_code === 429;
    if (!retryable) {
      // A real rejection (bad request, forbidden, unknown chat, etc) —
      // retrying identical input will not help.
      break;
    }

    const retryAfterMs = data?.parameters?.retry_after ? data.parameters.retry_after * 1000 : null;
    const backoffMs = retryAfterMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1);
    console.error(
      `sendTelegramMessage: attempt ${attempt}/${MAX_SEND_ATTEMPTS} failed (${lastResult.description}), retrying in ${backoffMs}ms`
    );
    await sleep(backoffMs);
  }

  return lastResult;
}

/**
 * Verifies a bot token is real and usable before it's stored — Telegram's
 * getMe returns the bot's own identity (including its @username) if the
 * token is valid, or ok: false if it isn't. Used by the dashboard's
 * "connect Telegram bot" flow so a typo'd/revoked token is rejected with a
 * clear error instead of being saved and failing silently later. Not
 * retried — a bad/revoked token should fail immediately and clearly, not
 * after several delayed attempts.
 */
export async function getTelegramBotInfo(
  botToken: string
): Promise<{ ok: true; username: string | null } | { ok: false; description?: string }> {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getMe`);
  const data = (await res.json()) as TelegramApiResponse;

  if (!data.ok) {
    return { ok: false, description: data.description };
  }
  return { ok: true, username: data.result?.username ?? null };
}

export async function setTelegramWebhook(params: {
  botToken: string;
  url: string;
  secretToken: string;
}): Promise<{ ok: boolean; description?: string }> {
  const { botToken, url, secretToken } = params;

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });

  const data = (await res.json()) as TelegramApiResponse;
  return { ok: data.ok, description: data.description };
}
