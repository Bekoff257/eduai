// End-to-end smoke test of the Telegram webhook pipeline's DATA LAYER
// (tenant resolution -> customer upsert -> conversation -> message storage
// -> idempotency), run against a real local Supabase instance with the
// seeded fixtures. This does NOT call OpenRouter — the AI agent step
// (src/lib/ai/agent.ts) requires a real OPENROUTER_API_KEY and network
// access, which this script does not attempt, so the agent's tool-calling
// behavior itself is verified by code review and typecheck only, not by
// live execution. What this DOES verify end-to-end: everything in
// src/app/api/telegram/webhook/[token]/route.ts up through step 5 (message
// storage + idempotency), replicated here since the route itself can't be
// invoked without a running Next.js server and a real Telegram secret.
//
// Run with: node scripts/smoke-test-webhook-pipeline.mjs
// Requires: local Supabase running with migrations + seed applied.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG_A = "00000000-0000-0000-0000-00000000000a";

let pass = 0;
let fail = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (cond) pass++;
  else fail++;
}

async function main() {
  // Step 1: resolve organization from webhook_token (mirrors
  // getTelegramIntegrationByWebhookToken).
  const { data: integration, error: integrationError } = await supabase
    .from("telegram_integrations")
    .select("id, organization_id, bot_token, webhook_token, webhook_secret, is_active")
    .eq("organization_id", ORG_A)
    .eq("is_active", true)
    .maybeSingle();

  check("Telegram integration resolves for Org A", !integrationError && !!integration);
  if (!integration) {
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  // Step 2: simulate an inbound message from a NEW Telegram chat id (one
  // not in the seed data) to exercise the create path, not just lookup.
  const newChatId = 999001;
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .upsert(
      {
        organization_id: ORG_A,
        telegram_chat_id: newChatId,
        telegram_username: "smoketest_user",
        full_name: "Smoke Test",
      },
      { onConflict: "organization_id,telegram_chat_id" }
    )
    .select("id, organization_id, telegram_chat_id")
    .single();

  check("Customer upsert succeeds for a new Telegram chat", !customerError && !!customer);
  check("Upserted customer belongs to Org A", customer?.organization_id === ORG_A);

  // Step 3: find/create open conversation.
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({ organization_id: ORG_A, customer_id: customer.id })
    .select("id, organization_id, customer_id, mode, status")
    .single();

  check("Conversation created", !conversationError && !!conversation);
  check("Conversation mode defaults to 'ai'", conversation?.mode === "ai");

  // Step 4: store the incoming message with a telegram_update_id, then
  // attempt the SAME insert again to verify idempotency (the real
  // appendMessage() treats the resulting 23505 as a handled outcome, not
  // an unhandled throw — this script checks the raw DB behavior it relies
  // on).
  const fakeUpdateId = Math.floor(Math.random() * 1_000_000_000);
  const { error: firstInsertError } = await supabase.from("messages").insert({
    organization_id: ORG_A,
    conversation_id: conversation.id,
    sender: "customer",
    content: "Hello, this is a smoke test message.",
    telegram_message_id: 1,
    telegram_update_id: fakeUpdateId,
  });
  check("First message insert succeeds", !firstInsertError);

  const { error: duplicateInsertError } = await supabase.from("messages").insert({
    organization_id: ORG_A,
    conversation_id: conversation.id,
    sender: "customer",
    content: "Hello, this is a smoke test message. (duplicate delivery)",
    telegram_message_id: 1,
    telegram_update_id: fakeUpdateId,
  });
  check(
    "Duplicate telegram_update_id insert is rejected (23505) — idempotency constraint works",
    duplicateInsertError?.code === "23505"
  );

  const { data: messagesForConversation } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversation.id);
  check(
    "Exactly one message stored despite the duplicate delivery attempt",
    messagesForConversation?.length === 1
  );

  // Cleanup: remove the rows this smoke test created so re-running it (or
  // db:test afterward) starts from a clean slate again relative to seed.sql.
  await supabase.from("messages").delete().eq("conversation_id", conversation.id);
  await supabase.from("conversations").delete().eq("id", conversation.id);
  await supabase.from("customers").delete().eq("id", customer.id);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
