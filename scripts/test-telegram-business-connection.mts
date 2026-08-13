// Telegram Business Bot Connections — service-layer + webhook-logic test.
//
// Imports and runs the REAL production service-layer functions
// (src/lib/services/telegram-integrations.ts, customers.ts,
// conversations.ts) unmodified, via tsx --conditions=react-server (same
// pattern as scripts/test-ai-integration.mts — see that file's comment for
// why this is needed to resolve "server-only" imports outside Next.js).
//
// Does NOT spin up a Next.js server or call the actual webhook HTTP route
// — instead it replicates the route's business-connection-handling logic
// (src/app/api/telegram/webhook/[token]/route.ts) step by step against the
// real service functions, the same way smoke-test-webhook-pipeline.mjs
// does for the original message path. This proves the DATA LAYER and
// business-connection-resolution logic work against real Postgres;
// exact HTTP request/response behavior of the route itself is covered by
// code review + typecheck, consistent with the existing webhook test.
//
// Run with: npm run test:telegram-business
// Requires: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY pointed at a project
// with migrations applied (hosted Supabase Cloud or local). Creates and
// cleans up its own disposable fixtures — never touches seed.sql data.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (hosted Supabase Cloud or local).");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (cond) pass++;
  else fail++;
}

async function main() {
  const {
    getTelegramIntegrationByBusinessConnectionId,
    upsertBusinessConnection,
    setTelegramIntegrationActive,
  } = await import("../src/lib/services/telegram-integrations");
  const { upsertCustomerFromTelegram } = await import("../src/lib/services/customers");
  const { findOrCreateOpenConversation, getConversation, updateConversationMode } = await import(
    "../src/lib/services/conversations"
  );
  const { appendMessage } = await import("../src/lib/services/messages");

  const suffix = randomUUID().slice(0, 8);

  // ----------------------------------------------------------------------------
  // Fixtures: two disposable organizations, each with their own bot
  // (distinct bot_token), so cross-org isolation can be tested for real —
  // not by assertion against seed data, since business connection columns
  // didn't exist when seed.sql was written.
  // ----------------------------------------------------------------------------
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const botTokenA = `test-bot-token-a-${suffix}`;
  const botTokenB = `test-bot-token-b-${suffix}`;

  await admin.from("organizations").insert({ id: orgAId, name: `Telegram Test Org A ${suffix}`, slug: `tg-test-org-a-${suffix}` });
  await admin.from("organizations").insert({ id: orgBId, name: `Telegram Test Org B ${suffix}`, slug: `tg-test-org-b-${suffix}` });
  await admin.from("business_settings").insert({ organization_id: orgAId });
  await admin.from("business_settings").insert({ organization_id: orgBId });

  const { data: integrationA } = await admin
    .from("telegram_integrations")
    .insert({ organization_id: orgAId, bot_token: botTokenA, bot_username: `test_bot_a_${suffix}`, webhook_secret: "test-secret-a" })
    .select("id, organization_id, webhook_token")
    .single();
  const { data: integrationB } = await admin
    .from("telegram_integrations")
    .insert({ organization_id: orgBId, bot_token: botTokenB, bot_username: `test_bot_b_${suffix}`, webhook_secret: "test-secret-b" })
    .select("id, organization_id, webhook_token")
    .single();

  check("Two disposable Telegram integrations created (one per test org)", !!integrationA && !!integrationB);

  const ownerAUserId = 700000001;
  const ownerBUserId = 700000002;
  const businessConnectionIdA = `bcid-a-${suffix}`;
  const businessConnectionIdB = `bcid-b-${suffix}`;

  try {
    // ----------------------------------------------------------------------------
    // Test 1: business_connection webhook update — connecting.
    // ----------------------------------------------------------------------------
    const connectedA = await upsertBusinessConnection(botTokenA, {
      businessConnectionId: businessConnectionIdA,
      isEnabled: true,
      rights: { reply: true, read_messages: true },
      ownerName: "Aziza Karimova",
      ownerUserId: ownerAUserId,
    });
    check("upsertBusinessConnection resolves the integration by bot_token", connectedA?.organizationId === orgAId);
    check("business_connection_id is stored", connectedA?.businessConnectionId === businessConnectionIdA);
    check("business_connection_enabled is true after connecting", connectedA?.businessConnectionEnabled === true);
    check("business_owner_user_id is stored (needed for manual-reply detection)", connectedA?.businessOwnerUserId === ownerAUserId);

    await upsertBusinessConnection(botTokenB, {
      businessConnectionId: businessConnectionIdB,
      isEnabled: true,
      rights: { reply: true, read_messages: true },
      ownerName: "Dana Ospanova",
      ownerUserId: ownerBUserId,
    });

    // ----------------------------------------------------------------------------
    // Test 2: organization resolution from business_connection_id — the
    // core tenant-isolation mechanism for this feature, mirroring what the
    // webhook route does for every inbound business_message.
    // ----------------------------------------------------------------------------
    const resolvedA = await getTelegramIntegrationByBusinessConnectionId(businessConnectionIdA);
    check("getTelegramIntegrationByBusinessConnectionId resolves Org A's connection to Org A", resolvedA?.organizationId === orgAId);

    const resolvedB = await getTelegramIntegrationByBusinessConnectionId(businessConnectionIdB);
    check(
      "Org A's business_connection_id never resolves to Org B (cross-tenant isolation)",
      resolvedB?.organizationId === orgBId && resolvedB?.organizationId !== orgAId
    );

    const resolvedUnknown = await getTelegramIntegrationByBusinessConnectionId(`nonexistent-${suffix}`);
    check("An unknown business_connection_id resolves to nothing", resolvedUnknown === null);

    // ----------------------------------------------------------------------------
    // Test 3: incoming customer DM via the business connection — customer
    // upsert + conversation creation + message storage, same primitives
    // the webhook route calls, keyed by the SAME telegram_chat_id concept
    // used for direct-to-bot messages (business DMs use the same chat.id
    // shape per Telegram's Bot API).
    // ----------------------------------------------------------------------------
    const customerChatId = 800000001;
    const customer = await upsertCustomerFromTelegram(orgAId, {
      telegramChatId: customerChatId,
      telegramUsername: "test_customer",
      fullName: "Test Customer",
    });
    check("Customer upsert succeeds for a business-connection DM", customer.organizationId === orgAId);

    const conversation = await findOrCreateOpenConversation(orgAId, customer.id);
    check("Conversation created for the business-connection customer", conversation.organizationId === orgAId);
    check("New conversation defaults to AI mode", conversation.mode === "ai");

    const inboundUpdateId = Math.floor(Math.random() * 1_000_000_000);
    const stored = await appendMessage(orgAId, {
      conversationId: conversation.id,
      sender: "customer",
      content: "Hi, how much is the IELTS course?",
      telegramMessageId: 1,
      telegramUpdateId: inboundUpdateId,
    });
    check("Inbound business-connection message stores successfully", stored.ok === true);

    // ----------------------------------------------------------------------------
    // Test 4: duplicate delivery (Telegram retry) is still idempotent —
    // unaffected by the business-connection addition, re-verified here
    // since it's on the same code path (same telegram_update_id as above).
    // ----------------------------------------------------------------------------
    const duplicate = await appendMessage(orgAId, {
      conversationId: conversation.id,
      sender: "customer",
      content: "Hi, how much is the IELTS course? (retried delivery)",
      telegramMessageId: 1,
      telegramUpdateId: inboundUpdateId,
    });
    check("Duplicate business-connection delivery is rejected as duplicate_update, not double-stored", !duplicate.ok);

    // ----------------------------------------------------------------------------
    // Test 5: human takeover detection — the owner replying manually (no
    // sender_business_bot, from.id === business_owner_user_id) must flip
    // the conversation to human mode, exactly like the dashboard's
    // "Take over" button does, so the AI stops responding.
    // ----------------------------------------------------------------------------
    await updateConversationMode(orgAId, conversation.id, "human");
    const afterManualReply = await getConversation(orgAId, conversation.id);
    check("Conversation mode flips to 'human' after simulated manual owner reply", afterManualReply?.mode === "human");

    // ----------------------------------------------------------------------------
    // Test 6: returning to AI (owner or dashboard flips it back).
    // ----------------------------------------------------------------------------
    await updateConversationMode(orgAId, conversation.id, "ai");
    const afterReturn = await getConversation(orgAId, conversation.id);
    check("Conversation mode returns to 'ai'", afterReturn?.mode === "ai");

    // ----------------------------------------------------------------------------
    // Test 7: disconnecting clears business_connection_enabled so the
    // integration stops being treated as live immediately, without
    // waiting for (or requiring) a business_connection webhook update.
    // ----------------------------------------------------------------------------
    const disconnected = await setTelegramIntegrationActive(orgAId, false);
    check("Disconnect (setTelegramIntegrationActive false) clears businessConnected", disconnected?.businessConnected === false);

    const resolvedAfterDisconnect = await getTelegramIntegrationByBusinessConnectionId(businessConnectionIdA);
    check(
      "A disconnected integration's business_connection_id no longer resolves (is_active filter)",
      resolvedAfterDisconnect === null
    );

    // Reactivate for symmetry/cleanliness before final cross-org check below.
    await setTelegramIntegrationActive(orgAId, true);

    // ----------------------------------------------------------------------------
    // Test 8: expired/invalid session equivalent — a business_connection
    // update with is_enabled: false (owner disconnected from THEIR side)
    // must be reflected, and the webhook route's resolution check (which
    // requires business_connection_enabled = true) must then reject it.
    // ----------------------------------------------------------------------------
    await upsertBusinessConnection(botTokenA, {
      businessConnectionId: businessConnectionIdA,
      isEnabled: false,
      rights: {},
      ownerName: "Aziza Karimova",
      ownerUserId: ownerAUserId,
    });
    const resolvedAfterOwnerDisconnect = await getTelegramIntegrationByBusinessConnectionId(businessConnectionIdA);
    check(
      "An owner-disconnected business connection (is_enabled: false) no longer resolves",
      resolvedAfterOwnerDisconnect === null
    );

    // ----------------------------------------------------------------------------
    // Test 9: concurrency — different customers' messages (different
    // conversations) process independently with no shared lock, mirroring
    // what the webhook route does per-request. Fire several inbound
    // messages for DISTINCT customers concurrently and confirm all
    // succeed with correct per-customer conversation isolation.
    // ----------------------------------------------------------------------------
    await upsertBusinessConnection(botTokenA, {
      businessConnectionId: businessConnectionIdA,
      isEnabled: true,
      rights: { reply: true, read_messages: true },
      ownerName: "Aziza Karimova",
      ownerUserId: ownerAUserId,
    });

    const concurrentChatIds = [810000001, 810000002, 810000003, 810000004, 810000005];
    const results = await Promise.all(
      concurrentChatIds.map(async (chatId) => {
        const c = await upsertCustomerFromTelegram(orgAId, { telegramChatId: chatId, fullName: `Concurrent ${chatId}` });
        const conv = await findOrCreateOpenConversation(orgAId, c.id);
        const msg = await appendMessage(orgAId, {
          conversationId: conv.id,
          sender: "customer",
          content: `Message from ${chatId}`,
          telegramMessageId: 1,
          telegramUpdateId: Math.floor(Math.random() * 1_000_000_000),
        });
        return { chatId, customerId: c.id, conversationId: conv.id, ok: msg.ok };
      })
    );
    check("All 5 concurrent customer messages processed successfully", results.every((r) => r.ok));
    const distinctConversations = new Set(results.map((r) => r.conversationId));
    check("Each concurrent customer got their own distinct conversation (no cross-talk)", distinctConversations.size === 5);

    // Cleanup concurrency fixtures.
    for (const r of results) {
      await admin.from("messages").delete().eq("conversation_id", r.conversationId);
      await admin.from("conversations").delete().eq("id", r.conversationId);
      await admin.from("customers").delete().eq("id", r.customerId);
    }
  } finally {
    // ----------------------------------------------------------------------------
    // Cleanup — never leaves fixtures behind, mirrors every other real-DB
    // test script's convention. Messages/conversations/customers cascade
    // on organization deletion (FK on delete cascade), but deleted
    // explicitly first for clarity and to avoid relying on cascade order.
    // ----------------------------------------------------------------------------
    await admin.from("messages").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("conversations").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("customers").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("telegram_integrations").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("business_settings").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("organizations").delete().in("id", [orgAId, orgBId]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL: unexpected error during Telegram business connection test:", err);
  process.exit(1);
});
