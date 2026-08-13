import "server-only";

/**
 * Serializes processing of messages from the SAME Telegram chat within
 * this server process, so two near-simultaneous inbound messages (rapid
 * customer double-send, or a Telegram retry racing a genuinely new
 * message) can't both read stale conversation state and each invoke the
 * agent independently. Keyed by (organizationId, telegramChatId) — the
 * identity available before a conversation/customer row is guaranteed to
 * exist yet, which is exactly when the race matters (two concurrent
 * findOrCreateOpenConversation calls for a brand-new chat could otherwise
 * both attempt to create the conversation).
 *
 * This does NOT serialize different customers/conversations against each
 * other — every other (organizationId, telegramChatId) key proceeds
 * immediately in parallel, so this has no effect on the "10 customers
 * message at once" case, only on repeated messages within one chat.
 *
 * In-process only, like the per-chat send throttle in
 * src/lib/telegram/client.ts — does not coordinate across multiple server
 * instances. Acceptable for the same reason: this app runs as a single
 * Next.js deployment target, not a horizontally-scaled fleet.
 */
const chatLocks = new Map<string, Promise<void>>();

function lockKey(organizationId: string, telegramChatId: number): string {
  return `${organizationId}:${telegramChatId}`;
}

export async function withConversationLock<T>(
  organizationId: string,
  telegramChatId: number,
  fn: () => Promise<T>
): Promise<T> {
  const key = lockKey(organizationId, telegramChatId);
  const previous = chatLocks.get(key) ?? Promise.resolve();

  let release: () => void;
  const ourTurn = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Everyone queued behind us waits for `previous` (whoever was ahead of
  // us) to finish, then for us to finish (`ourTurn`).
  const queuedAfterUs = previous.then(() => ourTurn);
  chatLocks.set(key, queuedAfterUs);

  await previous;
  try {
    return await fn();
  } finally {
    release!();
    // Only clear the map entry if no one queued behind us in the
    // meantime — otherwise we'd drop the next waiter's promise chain.
    if (chatLocks.get(key) === queuedAfterUs) {
      chatLocks.delete(key);
    }
  }
}
