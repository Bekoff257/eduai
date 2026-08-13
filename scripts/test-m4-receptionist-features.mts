// Milestone 4 — receptionist feature tests: follow-ups/reminders,
// business-hours logic, and the same-conversation concurrency lock.
//
// Imports and runs the real, unmodified src/lib/services/follow-ups.ts,
// leads.ts, customers.ts, conversations.ts, business-hours.ts, and
// src/lib/telegram/conversation-lock.ts (same tsx --conditions=react-server
// technique as test:ai and test:telegram-business — see those scripts'
// comments for why). checkBusinessHours and withConversationLock are pure
// functions with no DB dependency, tested directly with constructed
// inputs/timers; everything else runs against real, disposable fixtures
// on the same hosted Supabase Cloud project production uses.
//
// Run with: npm run test:m4
// Requires: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY pointed at a project
// with migrations applied. Creates and cleans up its own fixtures.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (hosted Supabase Cloud).");
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
  const { checkBusinessHours } = await import("../src/lib/business-hours");
  const { withConversationLock } = await import("../src/lib/telegram/conversation-lock");
  const { createLead } = await import("../src/lib/services/leads");
  const { createFollowUp, listDueFollowUps, markFollowUpSent, markFollowUpFailed, cancelFollowUp } =
    await import("../src/lib/services/follow-ups");
  const { upsertCustomerFromTelegram } = await import("../src/lib/services/customers");

  // ----------------------------------------------------------------------------
  // Business hours — pure logic, no DB. Uses a fixed reference instant and
  // a real IANA timezone so "what day/time is it there" is deterministic
  // regardless of what timezone this test happens to run in.
  // ----------------------------------------------------------------------------
  console.log("\n-- business hours --");

  // 2026-08-13 is a Thursday. Noon UTC = 17:00 in Asia/Tashkent (UTC+5).
  const thursdayNoonUtc = new Date("2026-08-13T12:00:00Z");

  check(
    "No days configured at all -> always open (fail open, not closed)",
    checkBusinessHours({}, "Asia/Tashkent", thursdayNoonUtc).isOpen === true
  );

  const openThursday = checkBusinessHours(
    { 4: { open: "09:00", close: "18:00" } }, // Thursday = 4
    "Asia/Tashkent",
    thursdayNoonUtc
  );
  check("17:00 local, hours 09:00-18:00 -> open", openThursday.isOpen === true);

  const closedThursdayEvening = checkBusinessHours(
    { 4: { open: "09:00", close: "16:00" } },
    "Asia/Tashkent",
    thursdayNoonUtc
  );
  check("17:00 local, hours 09:00-16:00 -> closed (past close)", closedThursdayEvening.isOpen === false);

  const explicitlyClosedDay = checkBusinessHours({ 4: { open: null, close: null } }, "Asia/Tashkent", thursdayNoonUtc);
  check("Explicit { open: null } for today -> closed", explicitlyClosedDay.isOpen === false);

  const otherDayConfiguredOnly = checkBusinessHours(
    { 1: { open: "09:00", close: "18:00" } }, // only Monday configured
    "Asia/Tashkent",
    thursdayNoonUtc
  );
  check(
    "Only a DIFFERENT day configured, today absent from map -> open (don't gate on missing config)",
    otherDayConfiguredOnly.isOpen === true
  );

  const badTimezone = checkBusinessHours({ 4: { open: "09:00", close: "18:00" } }, "Not/ARealZone", thursdayNoonUtc);
  check("Invalid timezone string -> fails open rather than throwing or wrongly closing", badTimezone.isOpen === true);

  // ----------------------------------------------------------------------------
  // Conversation lock — pure logic, no DB. Proves same-chat calls run
  // strictly one-at-a-time (no overlap) while different chats never wait
  // on each other.
  // ----------------------------------------------------------------------------
  console.log("\n-- conversation lock --");

  {
    const events: string[] = [];
    async function slowTask(label: string, ms: number) {
      events.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, ms));
      events.push(`${label}:end`);
    }

    const orgId = "lock-test-org";
    const chatId = 123456;
    const [r1, r2] = await Promise.all([
      withConversationLock(orgId, chatId, () => slowTask("A", 60)),
      withConversationLock(orgId, chatId, () => slowTask("B", 10)),
    ]);
    void r1;
    void r2;

    check(
      "Same-chat calls never interleave — B does not start until A fully ends",
      JSON.stringify(events) === JSON.stringify(["A:start", "A:end", "B:start", "B:end"])
    );
  }

  {
    const events: string[] = [];
    async function slowTask(label: string, ms: number) {
      events.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, ms));
      events.push(`${label}:end`);
    }

    const orgId = "lock-test-org";
    await Promise.all([
      withConversationLock(orgId, 111, () => slowTask("chat111", 50)),
      withConversationLock(orgId, 222, () => slowTask("chat222", 10)),
    ]);

    check(
      "Different chats run independently — the faster one finishes first, not blocked by the slower chat's lock",
      events.indexOf("chat222:end") < events.indexOf("chat111:end")
    );
  }

  // ----------------------------------------------------------------------------
  // Follow-ups — real DB, disposable fixtures on hosted Supabase Cloud.
  // ----------------------------------------------------------------------------
  console.log("\n-- follow-ups (real Supabase) --");

  const suffix = randomUUID().slice(0, 8);
  const orgAId = randomUUID();
  const orgBId = randomUUID();

  await admin.from("organizations").insert({ id: orgAId, name: `M4 Test Org A ${suffix}`, slug: `m4-test-org-a-${suffix}` });
  await admin.from("organizations").insert({ id: orgBId, name: `M4 Test Org B ${suffix}`, slug: `m4-test-org-b-${suffix}` });
  await admin.from("business_settings").insert({ organization_id: orgAId });
  await admin.from("business_settings").insert({ organization_id: orgBId });

  const { data: integrationA } = await admin
    .from("telegram_integrations")
    .insert({
      organization_id: orgAId,
      bot_token: `m4-test-bot-token-a-${suffix}`,
      webhook_secret: "test-secret",
      business_connection_id: `m4-bcid-a-${suffix}`,
      business_connection_enabled: true,
    })
    .select("id")
    .single();
  check("Test integration created for Org A", !!integrationA);

  try {
    const customerA = await upsertCustomerFromTelegram(orgAId, { telegramChatId: 900000001, fullName: "M4 Customer A" });
    const leadA = await createLead(orgAId, { customerId: customerA.id, source: "telegram" });

    const pastDue = new Date(Date.now() - 60_000).toISOString();
    const futureDue = new Date(Date.now() + 3_600_000).toISOString();

    const dueFollowUp = await createFollowUp(orgAId, {
      leadId: leadA.id,
      customerId: customerA.id,
      dueAt: pastDue,
      message: "Just checking in!",
    });
    check("createFollowUp succeeds and is pending", dueFollowUp.status === "pending");

    const notYetDueFollowUp = await createFollowUp(orgAId, {
      leadId: leadA.id,
      customerId: customerA.id,
      dueAt: futureDue,
    });
    check("A future-dated follow-up is also created (control for the due-query test below)", notYetDueFollowUp.status === "pending");

    const due = await listDueFollowUps(new Date().toISOString(), 500);
    const dueIds = new Set(due.map((f) => f.id));
    check("listDueFollowUps includes the past-due follow-up", dueIds.has(dueFollowUp.id));
    check("listDueFollowUps does NOT include the future-dated follow-up", !dueIds.has(notYetDueFollowUp.id));

    const dueRow = due.find((f) => f.id === dueFollowUp.id);
    check("Due follow-up carries the customer's real Telegram chat id", dueRow?.telegramChatId === 900000001);
    check(
      "Due follow-up carries the org's business_connection_id (so a reply looks like the owner sent it)",
      dueRow?.businessConnectionId === `m4-bcid-a-${suffix}`
    );

    await markFollowUpSent(orgAId, dueFollowUp.id);
    const { data: sentRow } = await admin.from("follow_ups").select("status, sent_at").eq("id", dueFollowUp.id).single();
    check("markFollowUpSent sets status to sent with a sent_at timestamp", sentRow?.status === "sent" && !!sentRow?.sent_at);

    const anotherFollowUp = await createFollowUp(orgAId, { leadId: leadA.id, customerId: customerA.id, dueAt: pastDue });
    await markFollowUpFailed(orgAId, anotherFollowUp.id);
    const { data: failedRow } = await admin.from("follow_ups").select("status").eq("id", anotherFollowUp.id).single();
    check("markFollowUpFailed sets status to failed", failedRow?.status === "failed");

    // Tenant isolation: Org B cannot mark or cancel Org A's follow-up by
    // guessing its id — every mutation is scoped by organization_id.
    const cancelledFromWrongOrg = await cancelFollowUp(orgBId, notYetDueFollowUp.id);
    check("cancelFollowUp from the WRONG org affects nothing (returns false)", cancelledFromWrongOrg === false);

    const { data: stillPending } = await admin
      .from("follow_ups")
      .select("status")
      .eq("id", notYetDueFollowUp.id)
      .single();
    check("Follow-up status is unchanged after the cross-org cancel attempt", stillPending?.status === "pending");

    const cancelledFromRightOrg = await cancelFollowUp(orgAId, notYetDueFollowUp.id);
    check("cancelFollowUp from the correct org succeeds", cancelledFromRightOrg === true);
  } finally {
    await admin.from("follow_ups").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("leads").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("customers").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("telegram_integrations").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("business_settings").delete().in("organization_id", [orgAId, orgBId]);
    await admin.from("organizations").delete().in("id", [orgAId, orgBId]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL: unexpected error during M4 feature test:", err);
  process.exit(1);
});
