// MILESTONE 2.75 — real concurrency test for atomic appointment booking.
//
// Proves the invariant "successful bookings <= capacity" holds under
// GENUINE concurrent requests (Promise.all firing real network calls to
// real local Postgres simultaneously, not sequential awaits dressed up as
// "concurrent"), not just sequential correctness. Also verifies tenant
// isolation and the pre-existing appointment behaviors (same-customer
// double-booking, group_not_found) still work through the new RPC path.
//
// Run with: npm run test:appointments
// Requires: local Supabase running with migrations + seed applied.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Existing seed fixture (supabase/seed.sql) — Org A, "IELTS Preparation" course.
const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_A_COURSE = "00000000-0000-0000-0000-0000000a0001";
const ORG_A_EXISTING_CUSTOMER = "00000000-0000-0000-0000-0000000a0021";
const ORG_A_EXISTING_GROUP = "00000000-0000-0000-0000-0000000a0011"; // capacity 15, used for pre-existing-behavior checks
const ORG_B_CUSTOMER = "00000000-0000-0000-0000-0000000b0021";

let pass = 0;
let fail = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (cond) pass++;
  else fail++;
}

async function bookAppointment(organizationId, customerId, courseGroupId, scheduledAt) {
  return supabase
    .rpc("book_appointment_atomic", {
      p_organization_id: organizationId,
      p_customer_id: customerId,
      p_course_group_id: courseGroupId,
      p_scheduled_at: scheduledAt,
      p_lead_id: null,
      p_notes: null,
    })
    .single();
}

async function main() {
  // ----------------------------------------------------------------------------
  // Setup: a DEDICATED capacity-limited group + N distinct customers, kept
  // separate from the shared seed fixtures other tests rely on. capacity=1
  // means the invariant is easy to state precisely: of N concurrent
  // bookings, exactly 1 must succeed and N-1 must fail with 'group_full'.
  // ----------------------------------------------------------------------------
  const testGroupId = randomUUID();
  const CONCURRENCY = 5;
  const SCHEDULED_AT = "2026-10-05T18:00:00Z";
  const createdCustomerIds = [];

  const { error: groupError } = await supabase.from("course_groups").insert({
    id: testGroupId,
    organization_id: ORG_A,
    course_id: ORG_A_COURSE,
    name: "Concurrency Test Group (capacity 1)",
    days_of_week: [1],
    start_time: "18:00",
    end_time: "19:00",
    capacity: 1,
  });
  if (groupError) {
    console.error("FAIL: could not create test course_group:", groupError.message);
    process.exit(1);
  }
  console.log(`[setup] created capacity=1 test group ${testGroupId}`);

  for (let i = 0; i < CONCURRENCY; i++) {
    const customerId = randomUUID();
    const { error } = await supabase.from("customers").insert({
      id: customerId,
      organization_id: ORG_A,
      telegram_chat_id: 900000 + i,
      full_name: `Concurrency Test Customer ${i}`,
    });
    if (error) {
      console.error(`FAIL: could not create test customer ${i}:`, error.message);
      process.exit(1);
    }
    createdCustomerIds.push(customerId);
  }
  console.log(`[setup] created ${CONCURRENCY} distinct test customers`);

  async function cleanup() {
    await supabase.from("appointments").delete().eq("course_group_id", testGroupId);
    await supabase.from("course_groups").delete().eq("id", testGroupId);
    for (const id of createdCustomerIds) {
      await supabase.from("customers").delete().eq("id", id);
    }
    console.log("[cleanup] removed test group, test appointments, and test customers");
  }

  try {
    // ----------------------------------------------------------------------------
    // Test 1: genuine concurrency. CONCURRENCY distinct customers all call
    // book_appointment_atomic() for the SAME capacity=1 group at the SAME
    // time via Promise.all — real parallel network requests to real
    // Postgres, not sequential awaits.
    // ----------------------------------------------------------------------------
    console.log(`\n[test 1] firing ${CONCURRENCY} concurrent booking attempts for a capacity=1 group...`);

    const results = await Promise.all(
      createdCustomerIds.map((customerId) =>
        bookAppointment(ORG_A, customerId, testGroupId, SCHEDULED_AT)
      )
    );

    const succeeded = results.filter((r) => r.data?.ok === true);
    const failedGroupFull = results.filter((r) => r.data?.ok === false && r.data.reason === "group_full");
    const unexpectedErrors = results.filter((r) => r.error || (r.data?.ok === false && r.data.reason !== "group_full"));

    for (const [i, r] of results.entries()) {
      console.log(
        `  customer ${i}: ${r.error ? `ERROR ${r.error.message}` : JSON.stringify(r.data)}`
      );
    }

    check(`Exactly 1 of ${CONCURRENCY} concurrent bookings succeeded`, succeeded.length === 1);
    check(
      `Exactly ${CONCURRENCY - 1} of ${CONCURRENCY} concurrent bookings failed with 'group_full'`,
      failedGroupFull.length === CONCURRENCY - 1
    );
    check("No unexpected errors or failure reasons", unexpectedErrors.length === 0);

    // ----------------------------------------------------------------------------
    // Test 2: verify actual database state matches — no duplicate/over-
    // capacity appointment rows exist, regardless of what the RPC claimed.
    // ----------------------------------------------------------------------------
    const { data: actualAppointments, error: countError } = await supabase
      .from("appointments")
      .select("id, customer_id, status")
      .eq("course_group_id", testGroupId)
      .eq("status", "scheduled");

    if (countError) {
      console.error("FAIL: could not verify appointment count:", countError.message);
      process.exit(1);
    }

    check(
      "Exactly 1 scheduled appointment row exists in the database for the capacity=1 group",
      actualAppointments.length === 1
    );

    // ----------------------------------------------------------------------------
    // Test 3: tenant isolation — a customer from ORG_B cannot book into an
    // ORG_A course_group, even by supplying ORG_A's real group id (the
    // function must scope by organization_id, not just existence).
    // ----------------------------------------------------------------------------
    const crossOrgResult = await bookAppointment(ORG_B, ORG_B_CUSTOMER, testGroupId, "2026-10-06T18:00:00Z");
    check(
      "Cross-org booking attempt (Org B customer + Org A group id) is rejected as group_not_found",
      crossOrgResult.data?.ok === false && crossOrgResult.data.reason === "group_not_found"
    );

    const { data: crossOrgAppointments } = await supabase
      .from("appointments")
      .select("id")
      .eq("course_group_id", testGroupId)
      .eq("customer_id", ORG_B_CUSTOMER);
    check("No appointment row was created for the rejected cross-org attempt", (crossOrgAppointments ?? []).length === 0);

    // ----------------------------------------------------------------------------
    // Test 4: pre-existing behavior still works — same customer, same
    // group, same slot twice is 'already_booked' (uq_appointments_customer_
    // group_slot, unchanged by this migration), using the ORIGINAL shared
    // seed fixtures (capacity 15, plenty of room) so this isn't confused
    // with the capacity check.
    // ----------------------------------------------------------------------------
    const firstBooking = await bookAppointment(
      ORG_A,
      ORG_A_EXISTING_CUSTOMER,
      ORG_A_EXISTING_GROUP,
      "2026-11-02T18:00:00Z"
    );
    check("Existing-behavior check: a fresh booking on the shared seed group still succeeds", firstBooking.data?.ok === true);

    const duplicateBooking = await bookAppointment(
      ORG_A,
      ORG_A_EXISTING_CUSTOMER,
      ORG_A_EXISTING_GROUP,
      "2026-11-02T18:00:00Z"
    );
    check(
      "Existing-behavior check: same customer booking the same group+slot twice still fails as already_booked",
      duplicateBooking.data?.ok === false && duplicateBooking.data.reason === "already_booked"
    );

    // Clean up this one, since it used the shared seed fixture, not the
    // disposable test group/customers cleaned up in finally{}.
    if (firstBooking.data?.appointment_id) {
      await supabase.from("appointments").delete().eq("id", firstBooking.data.appointment_id);
    }

    // ----------------------------------------------------------------------------
    // Test 5: booking into a non-existent group fails cleanly, not with a
    // raw Postgres error surfaced to the caller.
    // ----------------------------------------------------------------------------
    const nonExistentGroupResult = await bookAppointment(
      ORG_A,
      ORG_A_EXISTING_CUSTOMER,
      randomUUID(),
      "2026-11-03T18:00:00Z"
    );
    check(
      "Booking into a non-existent group fails cleanly as group_not_found (not a raw DB error)",
      nonExistentGroupResult.data?.ok === false && nonExistentGroupResult.data.reason === "group_not_found"
    );
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("FAIL: unexpected error during concurrency test:", err);
  process.exit(1);
});
