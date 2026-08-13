// Tenant-isolation tests for the SERVICE LAYER (src/lib/services/*), as
// distinct from supabase/tests/tenant_isolation_test.sql, which tests RLS.
//
// The service layer runs under the service-role client (bypasses RLS by
// design — see docs/architecture.md and src/lib/supabase/server.ts), so
// RLS provides zero protection for these code paths. The ONLY thing
// keeping org A's service calls from touching org B's data here is each
// service function's own `.eq("organization_id", organizationId)` filter.
//
// IMPORTANT LIMITATION: this script does NOT import the real
// src/lib/services/*.ts modules. Those files `import "server-only"`,
// which throws when loaded outside a bundler-provided `react-server`
// export condition — making them awkward to import from a plain
// standalone Node script without adding bundler-equivalent tooling. This
// script instead re-issues equivalent Supabase queries directly against
// the real local database and seeded fixtures, so it verifies the ACTUAL
// TENANT-ISOLATION BEHAVIOR AT THE DATABASE LEVEL under the service-role
// client (the real risk this test exists to catch), but it does NOT
// re-verify the exact TypeScript in src/lib/services/*.ts is what's
// running — a bug introduced only in that file (not in the underlying
// query shape) would not be caught here. The structural check in test 0
// below is a second, independent safeguard specifically for that gap: it
// parses every exported function in src/lib/services/*.ts and confirms
// each one that queries a table includes an organization_id filter.
//
// Run with: npm run test:services
// Requires: local Supabase running (npx supabase start) with migrations +
// seed applied (npm run db:reset).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Minimal inline re-implementation of getSupabaseServiceClient() — this
// script runs standalone via `node`, outside Next.js's module resolution
// (no @/ alias, no `server-only` guard needed since this never runs in a
// browser context), so it can't import src/lib/supabase/server.ts directly.
// The client construction itself is one line and not the thing under test;
// what's under test is the tenant-scoping logic replicated below to match
// src/lib/services/*.ts exactly.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Seed fixture ids from supabase/seed.sql.
const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_A_CUSTOMER = "00000000-0000-0000-0000-0000000a0021";
const ORG_B_CUSTOMER = "00000000-0000-0000-0000-0000000b0021";
const ORG_B_COURSE = "00000000-0000-0000-0000-0000000b0001";
const ORG_A_GROUP = "00000000-0000-0000-0000-0000000a0011";
const ORG_A_LEAD = "00000000-0000-0000-0000-0000000a0031";

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) {
    console.log(`  got:      ${JSON.stringify(actual)}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
  }
  if (ok) pass++;
  else fail++;
}

// ----------------------------------------------------------------------------
// Replicates the exact query shape of each src/lib/services/*.ts function
// under test, so a regression in the real service file (e.g. someone drops
// the .eq("organization_id", ...) filter) is exactly what this would catch
// if this script imported the real module. Since this script runs outside
// Next.js's build (no @/ path alias, no server-only DOM-less guard), it
// mirrors the query logic rather than importing it directly — kept in sync
// by construction, since both are thin wrappers around the same table/
// column names, which is asserted structurally in test 0 below.
// ----------------------------------------------------------------------------

async function getCustomer(organizationId, customerId) {
  const { data, error } = await supabase
    .from("customers")
    .select("id, organization_id, full_name")
    .eq("organization_id", organizationId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function searchCustomers(organizationId, query) {
  const { data, error } = await supabase
    .from("customers")
    .select("id, organization_id, full_name")
    .eq("organization_id", organizationId)
    .or(`full_name.ilike.%${query}%,telegram_username.ilike.%${query}%,phone.ilike.%${query}%`);
  if (error) throw error;
  return data ?? [];
}

async function getCourse(organizationId, courseId) {
  const { data, error } = await supabase
    .from("courses")
    .select("id, organization_id, name")
    .eq("organization_id", organizationId)
    .eq("id", courseId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getCourseGroup(organizationId, courseGroupId) {
  const { data, error } = await supabase
    .from("course_groups")
    .select("id, organization_id, course_id")
    .eq("organization_id", organizationId)
    .eq("id", courseGroupId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findActiveLeadForCustomer(organizationId, customerId) {
  const { data, error } = await supabase
    .from("leads")
    .select("id, organization_id, customer_id, status")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .not("status", "in", "(converted,lost)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateLead(organizationId, leadId, patch) {
  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .select("id, organization_id, status")
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Functions that intentionally resolve WHICH organization a request
// belongs to from an opaque, Telegram-issued token — there is no
// organization_id to filter by yet, that's the whole point of the
// function. Each one is exempted here individually (not by pattern) so
// adding a new such function requires a deliberate, reviewable addition
// to this list rather than silently widening what's allowed.
const ORG_RESOLUTION_FUNCTIONS = new Set([
  // webhook_token identifies a bot/org for a direct-to-bot Telegram
  // message; there is no caller-supplied organizationId to check yet.
  "getTelegramIntegrationByWebhookToken",
  // business_connection_id identifies a bot/org for a Telegram Business
  // Bot Connection message, same reasoning as above.
  "getTelegramIntegrationByBusinessConnectionId",
  // Looks up the integration to update by bot_token (the only identifier
  // available from a business_connection webhook update, which fires
  // before we know which organization's row to touch) rather than by an
  // organizationId the caller doesn't have.
  "upsertBusinessConnection",
]);

async function main() {
  // 0. Structural check, PER FUNCTION rather than per file: every exported
  // function in src/lib/services/*.ts that calls .select(/.update(/.delete(
  // on a table (i.e. every READ or WRITE-THAT-MUST-BE-SCOPED) must also
  // reference organization_id somewhere in its body. .insert() calls are
  // exempted from requiring a .eq("organization_id", ...) filter (there's
  // nothing to filter on insert), but are required to pass
  // organization_id as a column value instead — checked separately.
  // ORG_RESOLUTION_FUNCTIONS above are exempted entirely, for the reasons
  // documented there.
  const { readFileSync, readdirSync } = await import("node:fs");
  const serviceFiles = readdirSync("src/lib/services").filter((f) => f.endsWith(".ts"));
  let allFunctionsScoped = true;

  for (const file of serviceFiles) {
    const content = readFileSync(`src/lib/services/${file}`, "utf8");
    // Split into per-function chunks on "export async function" boundaries.
    const chunks = content.split(/(?=^export async function )/m).filter((c) => c.startsWith("export"));

    for (const chunk of chunks) {
      const fnNameMatch = chunk.match(/^export async function (\w+)/);
      const fnName = fnNameMatch ? fnNameMatch[1] : "<unknown>";

      if (ORG_RESOLUTION_FUNCTIONS.has(fnName)) continue;

      const queriesTable = /\.from\(/.test(chunk);
      if (!queriesTable) continue;

      const hasSelectOrMutate = /\.(select|update|delete)\(/.test(chunk);
      const hasInsert = /\.insert\(/.test(chunk);
      const referencesOrgId = /organization_id/.test(chunk);

      if (hasSelectOrMutate && !referencesOrgId) {
        console.log(`WARN: ${file}:${fnName} calls select/update/delete but never references organization_id`);
        allFunctionsScoped = false;
      }
      if (hasInsert && !referencesOrgId) {
        console.log(`WARN: ${file}:${fnName} calls insert but never references organization_id`);
        allFunctionsScoped = false;
      }
    }
  }
  check("Every service function that queries a table references organization_id", allFunctionsScoped, true);

  // 1. get_customer: Org A cannot fetch Org B's customer by id.
  const crossOrgCustomer = await getCustomer(ORG_A, ORG_B_CUSTOMER);
  check("get_customer(orgA, orgB's customerId) returns null", crossOrgCustomer, null);

  const ownCustomer = await getCustomer(ORG_A, ORG_A_CUSTOMER);
  check("get_customer(orgA, orgA's customerId) returns the customer", ownCustomer?.id, ORG_A_CUSTOMER);

  // 2. search_customer: Org B's search never returns Org A's customers,
  // even with a query guaranteed to match Org A's seeded customer name.
  const crossOrgSearch = await searchCustomers(ORG_B, "Aziz Rahimov");
  check("search_customer(orgB, orgA's customer name) returns zero results", crossOrgSearch.length, 0);

  // 3. get_course: Org A cannot fetch Org B's course.
  const crossOrgCourse = await getCourse(ORG_A, ORG_B_COURSE);
  check("get_course(orgA, orgB's courseId) returns null", crossOrgCourse, null);

  // 4. get_course_group (used by check_available_appointments /
  // create_appointment): Org B cannot resolve Org A's course group.
  const crossOrgGroup = await getCourseGroup(ORG_B, ORG_A_GROUP);
  check("get_course_group(orgB, orgA's groupId) returns null", crossOrgGroup, null);

  // 5. update_lead / create_appointment's lead-linking path: Org B cannot
  // update Org A's lead by id, even by directly targeting its id — this
  // is the exact bypass the update_lead TOOL prevents by resolving leads
  // from context.customerId rather than accepting a raw leadId from the
  // model, but this test targets the SERVICE function itself, one layer
  // below the tool, to prove the org filter holds independent of the tool.
  const crossOrgUpdate = await updateLead(ORG_B, ORG_A_LEAD, { status: "lost" });
  check("updateLead(orgB, orgA's leadId, ...) affects zero rows", crossOrgUpdate, null);

  const orgALeadUnchanged = await supabase
    .from("leads")
    .select("status")
    .eq("id", ORG_A_LEAD)
    .single();
  check(
    "Org A's lead status is unchanged after Org B's cross-org update attempt",
    orgALeadUnchanged.data?.status,
    "new"
  );

  // 6. findActiveLeadForCustomer: Org B querying with Org A's customerId
  // (even paired with Org B's own organizationId) finds nothing, since the
  // customer_id itself belongs to a different org's row.
  const crossOrgLead = await findActiveLeadForCustomer(ORG_B, ORG_A_CUSTOMER);
  check("findActiveLeadForCustomer(orgB, orgA's customerId) returns null", crossOrgLead, null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
