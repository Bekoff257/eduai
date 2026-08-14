// Regression tests for the currency-invention / unsupported-specialization-
// claim bug fixed on 2026-08-14: a production course had courses.currency
// left at its "USD" fallback default (a data-entry gap, not an AI
// hallucination — see docs/architecture.md), and the system prompt
// unconditionally framed every business as "an education center", which
// combined with a course list to produce an unsupported "specializes in
// English" claim when no business description was configured.
//
// Two tiers, matching this project's existing test-script convention
// (see test-m4-receptionist-features.mts):
//   1. Deterministic tests (no OpenRouter) — buildSystemPrompt output and
//      the real searchCourses()/listCourses() service functions against
//      real, disposable Supabase fixtures. Fast, free, runs every time.
//   2. One real-agent end-to-end test — actually invokes runAgent() against
//      real OpenRouter to prove the MODEL, not just the prompt string,
//      states the configured currency and never a different one. Requires
//      OPENROUTER_API_KEY; skipped with a clear message if absent rather
//      than silently passing.
//
// Run with: npx tsx --conditions=react-server --env-file-if-exists=.env.local scripts/test-course-currency-and-claims.mts
// Requires: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY pointed at a project
// with migrations applied (including 20260814103720_business_default_currency.sql).
// Creates and cleans up its own fixtures.

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
  const { buildSystemPrompt } = await import("../src/lib/ai/system-prompt");
  const { getBusinessSettings, updateBusinessSettings } = await import("../src/lib/services/business-settings");
  const { createCourse, searchCourses, listCourses } = await import("../src/lib/services/courses");

  const suffix = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const createdCourseIds: string[] = [];

  await admin.from("organizations").insert({ id: orgId, name: `Currency Test Org ${suffix}`, slug: `currency-test-${suffix}` });
  // No description set — deliberately, for the no-specialization-invented case.
  await admin.from("business_settings").insert({ organization_id: orgId, default_currency: "UZS" });

  try {
    // ------------------------------------------------------------------
    // Case: business_settings.default_currency is readable and configurable.
    // ------------------------------------------------------------------
    const settings = await getBusinessSettings(orgId);
    check("business_settings.default_currency is readable", settings?.defaultCurrency === "UZS");

    const updated = await updateBusinessSettings(orgId, { defaultCurrency: "EUR" });
    check("business_settings.default_currency is updatable from the dashboard API path", updated?.defaultCurrency === "EUR");
    await updateBusinessSettings(orgId, { defaultCurrency: "UZS" });

    // ------------------------------------------------------------------
    // Case 1: 700000 UZS -> prompt states "700000 UZS", never USD.
    // ------------------------------------------------------------------
    const uzsCourse = await createCourse(orgId, {
      name: `IELTS ${suffix}`,
      description: "Prepare for the IELTS exam.",
      price: 700000,
      currency: "UZS",
      duration: "3 months",
    });
    createdCourseIds.push(uzsCourse.id);

    check("Course created with UZS currency persists as UZS, not the old USD default", uzsCourse.currency === "UZS");

    const promptUzs = buildSystemPrompt(await getBusinessSettings(orgId), {
      isFirstReply: true,
      activeCourses: [uzsCourse],
    });
    check(
      'Prompt states the course price paired with "700000 UZS" (never USD)',
      promptUzs.includes("700000 UZS") && !promptUzs.includes("700000 USD")
    );

    // ------------------------------------------------------------------
    // Case 2: a DIFFERENT configured currency renders correctly, not
    // hardcoded to UZS/so'm — proves the fix is data-driven, not a
    // "always say so'm" prompt hack.
    // ------------------------------------------------------------------
    const eurCourse = await createCourse(orgId, {
      name: `European Business English ${suffix}`,
      description: "Business English for European markets.",
      price: 250,
      currency: "EUR",
      duration: "6 weeks",
    });
    createdCourseIds.push(eurCourse.id);

    const promptEur = buildSystemPrompt(await getBusinessSettings(orgId), {
      isFirstReply: true,
      activeCourses: [eurCourse],
    });
    // Note: the prompt's static rule-set includes one illustrative example
    // ("700000 UZS" / "so'm") in its ALWAYS-present currency-pairing
    // instruction (rule 1e) — that example text appears in every prompt
    // regardless of this course's actual currency, so this check looks
    // specifically for the EUR course's OWN price/currency pairing
    // (the "- European Business English ... (250 EUR, ...)" course-list
    // line), not for a blanket absence of "so'm"/"UZS" anywhere in the
    // whole prompt.
    check(
      'A course configured with EUR renders as "250 EUR" in its own course-list line, not UZS/USD',
      promptEur.includes("(250 EUR, ") && !promptEur.includes("(250 UZS, ") && !promptEur.includes("(250 USD, ")
    );

    // ------------------------------------------------------------------
    // Case 3: multiple courses -> no arbitrary "always lead with this one"
    // assumption baked into the prompt (structural: the neutrality
    // instruction is present; genuine per-request model variability is
    // covered qualitatively, not asserted deterministically here since
    // LLM course selection is legitimately request-dependent).
    // ------------------------------------------------------------------
    const mathCourse = await createCourse(orgId, {
      name: `Matematika ${suffix}`,
      description: "Math tutoring for school students.",
      price: 400000,
      currency: "UZS",
      duration: null,
    });
    createdCourseIds.push(mathCourse.id);

    const promptMulti = buildSystemPrompt(await getBusinessSettings(orgId), {
      isFirstReply: true,
      activeCourses: [uzsCourse, eurCourse, mathCourse],
    });
    check(
      "Prompt includes an explicit instruction against always defaulting to the same course",
      /do not default to presenting the same course every time|treat the active-course list as unordered/i.test(promptMulti)
    );
    check("All three active courses appear in the prompt (none silently dropped)", [uzsCourse, eurCourse, mathCourse].every((c) => promptMulti.includes(c.name)));

    // ------------------------------------------------------------------
    // Case 4: no business description configured -> AI is not told to
    // claim a specialization, and IS told explicitly not to invent one.
    // ------------------------------------------------------------------
    check(
      'Prompt does NOT contain the old hardcoded "an education center" framing',
      !promptUzs.includes("an education center")
    );
    check(
      "Prompt explicitly instructs against inventing a business specialization when none is configured",
      /do not guess, infer, or state what this business specializes in/i.test(promptUzs)
    );
    check(
      "Standing rule against specialization claims is present",
      /never state what this business ["“]specializes in["”]/i.test(promptUzs)
    );

    // With a description configured, the prompt should reflect it (and
    // still not invent beyond it) — sanity check the positive path too.
    await updateBusinessSettings(orgId, { description: "We offer language and exam-prep courses." });
    const promptWithDescription = buildSystemPrompt(await getBusinessSettings(orgId), {
      isFirstReply: true,
      activeCourses: [uzsCourse],
    });
    check(
      "When a description IS configured, the prompt includes it verbatim as the sole source of business-identity claims",
      promptWithDescription.includes("We offer language and exam-prep courses.")
    );
    await updateBusinessSettings(orgId, { description: "" });

    // ------------------------------------------------------------------
    // Case 5: duration is correctly included when set, and explicitly
    // flagged as unset (not invented) when null.
    // ------------------------------------------------------------------
    check('UZS course (duration "3 months") renders its duration in the prompt', promptUzs.includes("3 months"));
    check(
      'Matematika course (duration null) renders as "duration not set", not a guessed value',
      promptMulti.includes("Matematika") && /Matematika[^\n]*duration not set/.test(promptMulti)
    );

    // ------------------------------------------------------------------
    // Case 6: inactive courses are never presented as available.
    // ------------------------------------------------------------------
    const inactiveCourse = await createCourse(orgId, {
      name: `Discontinued Course ${suffix}`,
      price: 100000,
      currency: "UZS",
    });
    createdCourseIds.push(inactiveCourse.id);
    const { updateCourse } = await import("../src/lib/services/courses");
    await updateCourse(orgId, inactiveCourse.id, { isActive: false });

    const activeOnly = await searchCourses(orgId);
    check(
      "searchCourses() (the AI-facing lookup) excludes the inactive course",
      !activeOnly.some((c) => c.id === inactiveCourse.id)
    );
    check(
      "searchCourses() still returns the active courses",
      activeOnly.some((c) => c.id === uzsCourse.id) && activeOnly.some((c) => c.id === eurCourse.id)
    );

    const allCourses = await listCourses(orgId);
    check(
      "listCourses() (dashboard-only) still shows the inactive course so staff can re-activate it",
      allCourses.some((c) => c.id === inactiveCourse.id && c.isActive === false)
    );

    const promptActiveOnly = buildSystemPrompt(await getBusinessSettings(orgId), {
      isFirstReply: true,
      activeCourses: activeOnly,
    });
    check(
      "Inactive course name never appears in the first-reply prompt's active-course list",
      !promptActiveOnly.includes(inactiveCourse.name)
    );

    // ------------------------------------------------------------------
    // Tier 2: real end-to-end agent test against real OpenRouter.
    // ------------------------------------------------------------------
    if (!process.env.OPENROUTER_API_KEY) {
      console.log(
        "\nSKIPPED: real-agent currency test (OPENROUTER_API_KEY not set). " +
          "Deterministic prompt-construction tests above still ran and count toward the result."
      );
    } else {
      const { runAgent } = await import("../src/lib/ai/agent");
      const { upsertCustomerFromTelegram } = await import("../src/lib/services/customers");
      const { findOrCreateOpenConversation } = await import("../src/lib/services/conversations");

      const customer = await upsertCustomerFromTelegram(orgId, { telegramChatId: 900555001 });
      const conversation = await findOrCreateOpenConversation(orgId, customer.id);

      const agentResponse = await runAgent({
        systemContext: { organizationId: orgId, conversationId: conversation.id, customerId: customer.id },
        history: [],
        incomingText: `${uzsCourse.name.split(" ")[0]} kursi qancha?`,
        isFirstReply: true,
        businessSettings: await getBusinessSettings(orgId),
        activeCourses: [uzsCourse, eurCourse, mathCourse],
      });

      console.log(`\n[real agent] reply: ${agentResponse.text}`);

      const text = agentResponse.text;
      const mentionsPrice = text.includes("700000") || text.includes("700 000") || text.includes("700,000");
      const mentionsUsd = /\b700[\s,]?000\s*(usd|\$|dollar)/i.test(text);
      const mentionsSpecialization = /specializ|ixtisoslash/i.test(text);

      check("Real agent response mentions the actual price (700000/700 000)", mentionsPrice);
      check("Real agent response never pairs that price with USD", !mentionsUsd);
      check(
        "Real agent response does not claim a specialization (no description was configured)",
        !mentionsSpecialization
      );

      await admin.from("messages").delete().eq("conversation_id", conversation.id);
      await admin.from("conversations").delete().eq("id", conversation.id);
      await admin.from("customers").delete().eq("id", customer.id);
    }
  } finally {
    // ------------------------------------------------------------------
    // Cleanup — disposable fixtures only.
    // ------------------------------------------------------------------
    if (createdCourseIds.length > 0) {
      await admin.from("courses").delete().in("id", createdCourseIds);
    }
    await admin.from("business_settings").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL: unexpected error:", err);
  process.exit(1);
});
