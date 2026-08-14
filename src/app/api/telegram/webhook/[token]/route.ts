import { NextRequest, NextResponse } from "next/server";
import {
  getTelegramIntegrationByWebhookToken,
  getTelegramIntegrationByBusinessConnectionId,
  upsertBusinessConnection,
} from "@/lib/services/telegram-integrations";
import { upsertCustomerFromTelegram, updateCustomer, resolveCustomerLanguage } from "@/lib/services/customers";
import {
  findOrCreateOpenConversation,
  touchConversationLastMessageAt,
  updateConversationMode,
  updateConversationStatus,
} from "@/lib/services/conversations";
import { appendMessage, listRecentMessages, hasReceivedPriorReply } from "@/lib/services/messages";
import { getBusinessSettings } from "@/lib/services/business-settings";
import { searchCourses } from "@/lib/services/courses";
import { normalizeTelegramUpdate } from "@/lib/telegram/normalize";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { stripMarkdownForTelegram } from "@/lib/telegram/format";
import { withConversationLock } from "@/lib/telegram/conversation-lock";
import { runAgent } from "@/lib/ai/agent";
import { startTimer, timed } from "@/lib/timing";
import type { TelegramUpdate } from "@/lib/telegram/webhook-types";
import type { InboundMessage } from "@/lib/ai/types";

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Telegram webhook entrypoint, one per organization identified by the
 * opaque [token] path segment (telegram_integrations.webhook_token).
 *
 * Handles two kinds of updates now:
 *  - update.message: a direct DM to the bot itself (legacy path, still
 *    supported — an org can still be messaged at the bot directly).
 *  - update.business_connection / update.business_message: Telegram
 *    Business Bot Connections — the product's actual requirement. A
 *    business owner connects this bot to their OWN personal Telegram
 *    account (via their own Settings -> Telegram Business -> Chatbots, not
 *    anything on our dashboard), and DMs to that account arrive here as
 *    business_message, with replies sent via business_connection_id so
 *    they appear, to the customer, as if the owner typed them — no bot
 *    label. See docs/architecture.md for why this replaces the earlier
 *    MTProto/user-account approach that was evaluated and rejected.
 *
 * Always returns 200 once the organization/secret are verified, even if
 * downstream processing fails — Telegram retries non-2xx responses, and a
 * retry storm on a genuine processing error (vs. an auth failure) would
 * not fix itself. See docs/architecture.md#failure-handling.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const requestDone = startTimer("webhook.total");
  try {
    return await handleWebhookRequest(request, params);
  } finally {
    requestDone();
  }
}

async function handleWebhookRequest(
  request: NextRequest,
  params: Promise<{ token: string }>
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // 1. Resolve the organization from the URL token ALONE. Nothing in the
  // request body is trusted for tenant identification.
  const integration = await timed("supabase.getTelegramIntegrationByWebhookToken", () =>
    getTelegramIntegrationByWebhookToken(token)
  );
  if (!integration) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // 2. Verify the request actually came from Telegram for this
  // integration — the URL token alone is not sufficient authentication,
  // since webhook URLs can leak (logs, proxies, etc).
  const providedSecret = request.headers.get(TELEGRAM_SECRET_HEADER);
  if (!providedSecret || providedSecret !== integration.webhookSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    // A business_connection update announces a NEW connection, a
    // reconfiguration (rights/chat scope changed), or a disconnect
    // (is_enabled: false) — always process this regardless of what else
    // is in the payload (Telegram sends it as its own update, not
    // alongside a message).
    if (update.business_connection) {
      const bc = update.business_connection;
      await upsertBusinessConnection(integration.botToken, {
        businessConnectionId: bc.id,
        isEnabled: bc.is_enabled,
        rights: bc.rights ?? {},
        ownerName: [bc.user.first_name, bc.user.last_name].filter(Boolean).join(" ").trim() || null,
        ownerUserId: bc.user.id,
      });
      return NextResponse.json({ ok: true });
    }

    // Re-resolve organizationId: a business_message belongs to the
    // business owner's connected account, identified by
    // business_connection_id — NOT by the bot's own webhook_token (that
    // still identifies which BOT/org owns this webhook URL, but the
    // business_connection_id is what proves this specific message belongs
    // to an active, enabled connection for that org's owner). Re-checking
    // via a second lookup (rather than trusting integration.organizationId
    // directly) means a stale/disabled connection is rejected even if the
    // webhook URL itself is still valid.
    let organizationId = integration.organizationId;
    if (update.business_message?.business_connection_id) {
      const businessIntegration = await getTelegramIntegrationByBusinessConnectionId(
        update.business_message.business_connection_id
      );
      if (!businessIntegration || businessIntegration.organizationId !== integration.organizationId) {
        // Connection disabled, unknown, or (should be impossible given the
        // webhook_token match above, but never trust silently) belongs to
        // a different org than this webhook URL's bot. Ack and drop.
        return NextResponse.json({ ok: true });
      }
      organizationId = businessIntegration.organizationId;

      // The owner replying MANUALLY in their own Telegram app arrives as a
      // business_message too (same chat, same connection) — Telegram gives
      // no explicit "human took over" event, so this is detected by
      // comparing from.id to the connection's own owner id (see the
      // business_owner_user_id migration/column doc comment). Must be
      // checked BEFORE normalizeTelegramUpdate/processInboundTelegramMessage,
      // which otherwise has no way to distinguish this from a genuine
      // customer message on the same chat shape.
      const fromId = update.business_message.from?.id;
      const isOwnBotEcho = Boolean(update.business_message.sender_business_bot);
      if (!isOwnBotEcho && fromId !== undefined && fromId === businessIntegration.businessOwnerUserId) {
        const telegramChatId = update.business_message.chat.id;
        await withConversationLock(organizationId, telegramChatId, async () => {
          const customer = await upsertCustomerFromTelegram(organizationId, { telegramChatId });
          const conversation = await findOrCreateOpenConversation(organizationId, customer.id);
          await handleOwnerManualReply(organizationId, conversation.id);
        });
        return NextResponse.json({ ok: true });
      }
    }

    const inbound = normalizeTelegramUpdate(organizationId, update);

    // Not a plain text message (edited message, photo, sticker, echo of
    // our own business reply, etc) — ack and skip.
    if (!inbound) {
      return NextResponse.json({ ok: true });
    }

    // Serialize processing per-chat (not globally, not per-org) — two
    // near-simultaneous messages in the SAME chat (rapid customer
    // double-send, or a delivery racing a genuinely new message) must not
    // both read the conversation's state and each invoke the agent
    // independently. Different customers' chats never wait on each other.
    await withConversationLock(inbound.organizationId, Number(inbound.externalUserId), () =>
      processInboundTelegramMessage(integration.botToken, inbound, update.update_id)
    );
  } catch (err) {
    // Never let a processing failure surface as a non-2xx to Telegram —
    // that just causes a retry storm without fixing the underlying issue.
    console.error("Telegram webhook processing failed:", err);
  }

  return NextResponse.json({ ok: true });
}

async function processInboundTelegramMessage(
  botToken: string,
  inbound: InboundMessage,
  updateId: number
) {
  const organizationId = inbound.organizationId;
  const telegramChatId = Number(inbound.externalUserId);
  const businessConnectionId = inbound.metadata.businessConnectionId as string | undefined;

  // 3. Find/create the customer for this Telegram chat.
  const customer = await timed("supabase.upsertCustomerFromTelegram", () =>
    upsertCustomerFromTelegram(organizationId, {
      telegramChatId,
      telegramUsername: inbound.metadata.telegramUsername as string | undefined,
      fullName: [inbound.metadata.telegramFirstName, inbound.metadata.telegramLastName]
        .filter(Boolean)
        .join(" ")
        .trim() || undefined,
    })
  );

  // 4. Find/create the open conversation for this customer.
  const conversation = await timed("supabase.findOrCreateOpenConversation", () =>
    findOrCreateOpenConversation(organizationId, customer.id)
  );

  // 5. Store the incoming message. Idempotent on (organization_id,
  // telegram_update_id) — if Telegram retries this exact update, this
  // returns duplicate_update and we stop here without re-invoking the AI
  // or sending a second reply.
  const stored = await timed("supabase.appendMessage(customer)", () =>
    appendMessage(organizationId, {
      conversationId: conversation.id,
      sender: "customer",
      content: inbound.text,
      telegramMessageId: Number(inbound.messageId),
      telegramUpdateId: updateId,
    })
  );

  if (!stored.ok) {
    return;
  }

  // Not awaited — this is a last-updated timestamp used only for dashboard
  // sort order, not read again anywhere later in this request, so the
  // reply does not need to wait on it. Errors are logged, never thrown,
  // matching touchConversationLastMessageAt's own fire-and-forget-safe
  // write (a missed timestamp bump is not worth delaying a customer for).
  void timed("supabase.touchConversationLastMessageAt(1)", () =>
    touchConversationLastMessageAt(organizationId, conversation.id)
  ).catch((err) => console.error("touchConversationLastMessageAt(1) failed:", err));

  // 6. HUMAN mode: store the message (done above) but never invoke the
  // agent — checked here, before any AI call, so AI and a human can never
  // both respond to the same message.
  if (conversation.mode === "human") {
    return;
  }

  // 7. Business settings (also carries the AI kill switch), recent history,
  // the first-reply signal, and the active-course snapshot are mutually
  // independent reads — fetched concurrently rather than sequentially.
  // getBusinessSettings can gate whether we proceed at all (ai_enabled),
  // but that gate doesn't depend on the others, so fetching all four
  // together and checking the gate after is strictly faster in the common
  // case (AI enabled) at the cost of extra queries in the rare case (AI
  // disabled for this org).
  //
  // activeCourses is fetched unconditionally here (even though it's only
  // USED when isFirstReply turns out true below) because isFirstReply
  // itself isn't known until hasReceivedPriorReply resolves — but since
  // this is one more concurrent query in an already-parallel Promise.all,
  // it costs no additional wall-clock time for the majority (returning-
  // customer) case, only a small amount of extra Supabase load. This is
  // what lets a first reply that needs no OTHER tool answer in a single
  // OpenRouter round instead of a mandatory "call search_courses, then
  // answer" two-round trip — see system-prompt.ts and agent.ts.
  const [settings, recentMessages, hasPriorReply, activeCourses] = await Promise.all([
    timed("supabase.getBusinessSettings(webhook)", () => getBusinessSettings(organizationId)),
    timed("supabase.listRecentMessages", () => listRecentMessages(organizationId, conversation.id, 21)),
    // Whether this customer has EVER received an ai/staff message, across
    // all their conversations, not just this conversation's history (which
    // can be misleadingly empty if a prior conversation was closed and this
    // is a new one for a returning customer). Drives the proactive
    // first-time introduction in the system prompt — see
    // src/lib/ai/system-prompt.ts.
    timed("supabase.hasReceivedPriorReply", () => hasReceivedPriorReply(organizationId, customer.id)),
    timed("supabase.searchCourses(webhook)", () => searchCourses(organizationId)),
  ]);

  if (settings && !settings.aiEnabled) {
    return;
  }

  // Excluding the message we just stored — it's passed separately as the
  // current turn.
  const history = recentMessages.filter((m) => m.id !== stored.message.id).reverse();
  const isFirstReply = !hasPriorReply;

  // 7b. Resolve the customer's language for THIS reply — pure, synchronous,
  // no extra OpenRouter call (see src/lib/language-detect.ts and
  // resolveCustomerLanguage in services/customers.ts for the full
  // precedence rules: explicit request > stored explicit preference >
  // confident detection > stored detected preference > org default).
  const resolvedLanguage = resolveCustomerLanguage(customer, inbound.text, settings);
  if (resolvedLanguage.changed) {
    // Not awaited — same reasoning as touchConversationLastMessageAt below;
    // the reply's own wording already reflects resolvedLanguage (passed to
    // runAgent directly), so nothing downstream in THIS request depends on
    // this write completing before the customer gets their answer. A
    // missed persist here just means the same detection runs again next
    // message, which is harmless.
    void updateCustomer(organizationId, customer.id, {
      language: resolvedLanguage.language,
      languageSource: resolvedLanguage.source,
    }).catch((err) => console.error("updateCustomer(language) failed:", err));
  }

  // 8. Run the AI agent with controlled tools. businessSettings/
  // activeCourses are passed through from the fetches above so the agent
  // doesn't re-fetch the same data (or, for courses, so a first reply that
  // needs no other tool can answer in one OpenRouter round — see above).
  const agentResponse = await timed("agent.runAgent", () =>
    runAgent({
      systemContext: {
        organizationId,
        conversationId: conversation.id,
        customerId: customer.id,
      },
      history,
      incomingText: inbound.text,
      isFirstReply,
      businessSettings: settings,
      activeCourses: isFirstReply ? activeCourses : undefined,
      languageContext: {
        customerLanguage: resolvedLanguage.language,
        languageSource: resolvedLanguage.source,
        supportedLanguages: settings?.languages ?? ["en"],
        defaultLanguage: settings?.defaultLanguage ?? "en",
      },
    })
  );

  // 9. Store the AI's response. Markdown-stripped here (once, before both
  // storage and the Telegram send below) since sendTelegramMessage sends
  // with no parse_mode — the model sometimes emits **bold**/`code`-style
  // syntax that would otherwise show up as literal asterisks/backticks to
  // the customer, and staff reading the same stored text in the dashboard
  // Inbox shouldn't see raw Markdown either.
  const replyText = stripMarkdownForTelegram(agentResponse.text);

  await timed("supabase.appendMessage(ai)", () =>
    appendMessage(organizationId, {
      conversationId: conversation.id,
      sender: "ai",
      content: replyText,
    })
  );

  // Not awaited — same reasoning as touchConversationLastMessageAt(1)
  // above; the customer's reply has already been sent by the time this
  // settles, so there's nothing left downstream to block on.
  void timed("supabase.touchConversationLastMessageAt(2)", () =>
    touchConversationLastMessageAt(organizationId, conversation.id)
  ).catch((err) => console.error("touchConversationLastMessageAt(2) failed:", err));

  // 10. Send the response back through Telegram. For a business
  // connection, business_connection_id makes this appear, to the
  // customer, exactly as if the owner typed it — no bot attribution.
  // sendTelegramMessage already retries transient failures/FLOOD_WAIT
  // internally (src/lib/telegram/client.ts) — a failure reaching here is
  // one that retrying didn't fix, not a fluke.
  const sendResult = await timed("telegram.sendMessage", () =>
    sendTelegramMessage({
      botToken,
      chatId: telegramChatId,
      text: replyText,
      businessConnectionId,
    })
  );

  if (!sendResult.ok) {
    console.error("Failed to send Telegram response:", sendResult.description);
  }

  // The AI genuinely couldn't help (fell back to its safe failure text —
  // see AgentResponse.needsHumanAttention), or its reply never reached
  // the customer even after retries — either way, a person should look at
  // this conversation. Surfaced in the dashboard's Conversations filter
  // (see docs/architecture.md), not just a log line.
  if (agentResponse.needsHumanAttention || !sendResult.ok) {
    await updateConversationStatus(organizationId, conversation.id, "needs_attention");
  }
}

/**
 * Detects when the business owner replied to a customer MANUALLY, in
 * their own Telegram app, rather than through our AI. Telegram gives no
 * explicit "human took over" event for business connections — this is
 * inferred, as documented, from an outgoing business_message in a
 * connected chat that lacks sender_business_bot (only messages OUR bot
 * sent carry that field). Called from the webhook's business_message
 * branch when the message is outgoing (from the owner, not the customer).
 *
 * Flips the conversation to human mode using the same mechanism the
 * dashboard's "Take over" button uses, so the AI stops responding in this
 * conversation until returned — without this, the AI would keep replying
 * alongside the owner's own manual replies.
 */
async function handleOwnerManualReply(organizationId: string, conversationId: string) {
  await updateConversationMode(organizationId, conversationId, "human");
}
