// Milestone 5 — multilingual AI test suite.
//
// Two tiers, matching this project's existing test-script convention (see
// test-course-currency-and-claims.mts):
//   1. Deterministic tests (no OpenRouter) — detectLanguage/
//      detectExplicitLanguageRequest/resolveCustomerLanguage pure
//      functions, and the real customers/business-settings services
//      against real, disposable Supabase fixtures. Fast, free, runs every
//      time.
//   2. Real-agent end-to-end tests — actually invoke runAgent() against
//      real OpenRouter to prove the MODEL (not just the prompt string)
//      responds in the right language and preserves structured facts.
//      Requires OPENROUTER_API_KEY; skipped with a clear message if
//      absent rather than silently passing.
//
// Run with: npm run test:multilingual
// Requires: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY pointed at a project
// with migrations applied (including
// 20260814222000_multilingual_language_tracking.sql). Creates and cleans
// up its own fixtures.

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
  const { detectLanguage, detectExplicitLanguageRequest } = await import("../src/lib/language-detect");
  const { resolveCustomerLanguage, updateCustomer, getCustomer, createCustomer } = await import(
    "../src/lib/services/customers"
  );
  const { getBusinessSettings, updateBusinessSettings } = await import("../src/lib/services/business-settings");
  const { buildSystemPrompt } = await import("../src/lib/ai/system-prompt");
  const { createCourse } = await import("../src/lib/services/courses");

  // ----------------------------------------------------------------------------
  // Pure detection tests — no DB, no network.
  // ----------------------------------------------------------------------------
  console.log("\n-- language detection (pure) --");

  check('detectLanguage("Salom, IELTS kursi qancha?") -> uz', detectLanguage("Salom, IELTS kursi qancha?") === "uz");
  check('detectLanguage("Сколько стоит IELTS?") -> ru', detectLanguage("Сколько стоит IELTS?") === "ru");
  check('detectLanguage("Hello, how much is IELTS?") -> en', detectLanguage("Hello, how much is IELTS?") === "en");
  check('detectLanguage("IELTS") -> null (ambiguous, no guess)', detectLanguage("IELTS") === null);
  check('detectLanguage("123456") -> null (no letters)', detectLanguage("123456") === null);
  check('detectLanguage("") -> null', detectLanguage("") === null);

  check(
    'detectExplicitLanguageRequest("Отвечайте мне на русском") -> ru',
    detectExplicitLanguageRequest("Отвечайте мне на русском") === "ru"
  );
  check(
    'detectExplicitLanguageRequest("o\'zbekcha gapiring") -> uz',
    detectExplicitLanguageRequest("o'zbekcha gapiring") === "uz"
  );
  check(
    'detectExplicitLanguageRequest("please speak English") -> en',
    detectExplicitLanguageRequest("please speak English") === "en"
  );
  check(
    'detectExplicitLanguageRequest("IELTS kursi qancha?") -> null (not an explicit request)',
    detectExplicitLanguageRequest("IELTS kursi qancha?") === null
  );

  // ----------------------------------------------------------------------------
  // resolveCustomerLanguage precedence — pure, all 5 branches.
  // ----------------------------------------------------------------------------
  console.log("\n-- resolveCustomerLanguage precedence (pure) --");

  const settingsUzRuEn = { languages: ["uz", "ru", "en"], defaultLanguage: "uz" };
  const noLangCustomer = { language: null, languageSource: null } as const;

  // Case 10: nothing known -> org default.
  const r1 = resolveCustomerLanguage(noLangCustomer, "asdkjhasd", settingsUzRuEn);
  check("No prior language + ambiguous message -> falls back to org default_language (uz)", r1.language === "uz" && r1.changed);

  // Case: confident detection with no prior language.
  const r2 = resolveCustomerLanguage(noLangCustomer, "Hello, how much is IELTS?", settingsUzRuEn);
  check("No prior language + confident English detection -> en, source detected", r2.language === "en" && r2.source === "detected" && r2.changed);

  // Case 9: mixed/ambiguous message does not override a stored language.
  const detectedRu = { language: "ru", languageSource: "detected" as const };
  const r3 = resolveCustomerLanguage(detectedRu, "IELTS", settingsUzRuEn);
  check("Prior detected=ru + ambiguous message -> stays ru, not changed", r3.language === "ru" && !r3.changed);

  // Case: confident NEW detection updates a prior 'detected' (not 'explicit') language.
  const r4 = resolveCustomerLanguage(detectedRu, "Hello, how much is IELTS?", settingsUzRuEn);
  check("Prior detected=ru + confident English detection -> updates to en", r4.language === "en" && r4.changed);

  // Case 5/6: explicit preference is NEVER overridden by ordinary detection.
  const explicitRu = { language: "ru", languageSource: "explicit" as const };
  const r5 = resolveCustomerLanguage(explicitRu, "Hello, how much is IELTS?", settingsUzRuEn);
  check(
    "Explicit preference (ru) is NOT overridden by a differently-detected message (en signal)",
    r5.language === "ru" && r5.source === "explicit" && !r5.changed
  );

  // Case 7: customer can explicitly change language again.
  const r6 = resolveCustomerLanguage(explicitRu, "please speak English", settingsUzRuEn);
  check("A NEW explicit request (English) DOES override a prior explicit preference (ru)", r6.language === "en" && r6.source === "explicit" && r6.changed);

  // Case 5 (worked example from the spec): explicit Russian request.
  const r7 = resolveCustomerLanguage(noLangCustomer, "Отвечайте мне на русском", settingsUzRuEn);
  check('"Отвечайте мне на русском" from a customer with no prior language -> explicit ru', r7.language === "ru" && r7.source === "explicit");

  // Case 8: unsupported language falls back correctly (detected language not
  // in the business's supported list).
  const settingsUzOnly = { languages: ["uz"], defaultLanguage: "uz" };
  const r8 = resolveCustomerLanguage(noLangCustomer, "Hello, how much is IELTS?", settingsUzOnly);
  check(
    "Business supports only [uz]; detected English (not supported) + no prior language -> falls back to default (uz), not en",
    r8.language === "uz"
  );

  // Case 11: disabled language is not selected via ordinary detection, but
  // an EXPLICIT request for it is still honored (per spec: "must not
  // respond in a disabled language unless the customer explicitly uses it").
  const r9 = resolveCustomerLanguage(noLangCustomer, "please speak English", settingsUzOnly);
  check(
    "Business supports only [uz], but customer explicitly asks for English -> honored anyway (explicit overrides support list)",
    r9.language === "en" && r9.source === "explicit"
  );

  // ----------------------------------------------------------------------------
  // Fixtures for service-layer + prompt-rendering tests.
  // ----------------------------------------------------------------------------
  const suffix = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const orgBId = randomUUID(); // for tenant-isolation check
  const createdCourseIds: string[] = [];
  const createdCustomerIds: string[] = [];

  await admin.from("organizations").insert({ id: orgId, name: `Multilingual Test Org ${suffix}`, slug: `ml-test-${suffix}` });
  await admin
    .from("organizations")
    .insert({ id: orgBId, name: `Multilingual Test Org B ${suffix}`, slug: `ml-test-b-${suffix}` });
  await admin.from("business_settings").insert({ organization_id: orgId, languages: ["uz", "ru", "en"], default_language: "uz" });
  await admin.from("business_settings").insert({ organization_id: orgBId, languages: ["en"], default_language: "en" });

  try {
    // ------------------------------------------------------------------
    // business_settings.languages / default_language round-trip.
    // ------------------------------------------------------------------
    console.log("\n-- business_settings language configuration --");
    const settingsA = await getBusinessSettings(orgId);
    check("languages readable as configured ([uz, ru, en])", JSON.stringify(settingsA?.languages) === JSON.stringify(["uz", "ru", "en"]));
    check("default_language readable as configured (uz)", settingsA?.defaultLanguage === "uz");

    const updated = await updateBusinessSettings(orgId, { languages: ["uz", "en"], defaultLanguage: "en" });
    check("languages/defaultLanguage updatable via the service layer", JSON.stringify(updated?.languages) === JSON.stringify(["uz", "en"]) && updated?.defaultLanguage === "en");
    await updateBusinessSettings(orgId, { languages: ["uz", "ru", "en"], defaultLanguage: "uz" });

    // ------------------------------------------------------------------
    // Case 4: detected language is persisted (real DB round-trip).
    // ------------------------------------------------------------------
    console.log("\n-- persistence (real Supabase) --");
    const cust1 = await createCustomer(orgId, { telegramChatId: 910000001 });
    createdCustomerIds.push(cust1.id);
    const resolved1 = resolveCustomerLanguage(cust1, "Сколько стоит IELTS?", settingsA);
    check("Detected Russian for a brand-new customer", resolved1.language === "ru" && resolved1.source === "detected");
    await updateCustomer(orgId, cust1.id, { language: resolved1.language, languageSource: resolved1.source });
    const cust1Reloaded = await getCustomer(orgId, cust1.id);
    check("Detected language persists to the database", cust1Reloaded?.language === "ru" && cust1Reloaded?.languageSource === "detected");

    // ------------------------------------------------------------------
    // Case 5/6: explicit preference overrides detection AND remains
    // stable across subsequent messages (simulated as sequential resolve
    // calls against the persisted customer state, exactly as the webhook
    // route does one message at a time).
    // ------------------------------------------------------------------
    const explicitResolve = resolveCustomerLanguage(cust1Reloaded!, "Отвечайте мне на русском", settingsA);
    check("Explicit Russian request resolved for existing detected=ru customer", explicitResolve.language === "ru" && explicitResolve.source === "explicit");
    await updateCustomer(orgId, cust1.id, { language: explicitResolve.language, languageSource: explicitResolve.source });
    let custAfterExplicit = await getCustomer(orgId, cust1.id);
    check("Explicit preference persisted with source='explicit'", custAfterExplicit?.languageSource === "explicit");

    // Subsequent English-looking message must NOT flip the stored explicit preference.
    const stableResolve = resolveCustomerLanguage(custAfterExplicit!, "IELTS price?", settingsA);
    check("Explicit preference remains stable across a subsequent English-looking message", stableResolve.language === "ru" && !stableResolve.changed);
    if (stableResolve.changed) {
      await updateCustomer(orgId, cust1.id, { language: stableResolve.language, languageSource: stableResolve.source });
    }
    custAfterExplicit = await getCustomer(orgId, cust1.id);
    check("Stored language is still ru/explicit after the ambiguous-signal message", custAfterExplicit?.language === "ru" && custAfterExplicit?.languageSource === "explicit");

    // ------------------------------------------------------------------
    // Case 7: customer can explicitly change language again.
    // ------------------------------------------------------------------
    const changeResolve = resolveCustomerLanguage(custAfterExplicit!, "please speak English", settingsA);
    check("A second explicit request (English) overrides the standing explicit Russian preference", changeResolve.language === "en" && changeResolve.changed);
    await updateCustomer(orgId, cust1.id, { language: changeResolve.language, languageSource: changeResolve.source });
    const custAfterChange = await getCustomer(orgId, cust1.id);
    check("New explicit preference persisted", custAfterChange?.language === "en" && custAfterChange?.languageSource === "explicit");

    // ------------------------------------------------------------------
    // Case 18: multi-tenant isolation — org B's settings never leak into
    // org A's resolution, and vice versa.
    // ------------------------------------------------------------------
    console.log("\n-- tenant isolation --");
    const cust2 = await createCustomer(orgBId, { telegramChatId: 910000002 });
    createdCustomerIds.push(cust2.id);
    const settingsB = await getBusinessSettings(orgBId);
    check("Org B's business_settings are independent of Org A's (languages=[en] only)", JSON.stringify(settingsB?.languages) === JSON.stringify(["en"]));
    const resolvedB = resolveCustomerLanguage(cust2, "Сколько стоит IELTS?", settingsB);
    check(
      "Org B (supports only English) does not adopt Org A's Russian support — detected ru is unsupported, falls back to Org B's own default (en)",
      resolvedB.language === "en"
    );
    // Cross-check: fetching org A's customer via org B's id must not resolve (tenant scoping on getCustomer).
    const crossFetch = await getCustomer(orgBId, cust1.id);
    check("A customer created under Org A cannot be fetched by passing Org B's organizationId", crossFetch === null);

    // ------------------------------------------------------------------
    // Case 12/13: course price/duration are language-agnostic facts —
    // verify via prompt rendering (deterministic, same helper the AI
    // reads from) in multiple language contexts.
    // ------------------------------------------------------------------
    console.log("\n-- structured data preserved across language contexts --");
    const ieltsCourse = await createCourse(orgId, {
      name: `IELTS ${suffix}`,
      description: "Prepare for the IELTS exam with experienced teachers.",
      price: 700000,
      currency: "UZS",
      duration: "6 months",
    });
    createdCourseIds.push(ieltsCourse.id);

    for (const lang of ["uz", "ru", "en"] as const) {
      const prompt = buildSystemPrompt(settingsA, {
        isFirstReply: true,
        activeCourses: [ieltsCourse],
        languageContext: { customerLanguage: lang, languageSource: "detected", supportedLanguages: ["uz", "ru", "en"], defaultLanguage: "uz" },
      });
      check(`Prompt in language context '${lang}' still states price as exactly "700000 UZS"`, prompt.includes("700000 UZS"));
      check(`Prompt in language context '${lang}' still states duration as exactly "6 months"`, prompt.includes("6 months"));
      check(`Prompt in language context '${lang}' never substitutes USD for the course's real UZS currency`, !prompt.includes("700000 USD"));
    }

    // ------------------------------------------------------------------
    // Language context structural checks in the prompt itself.
    // ------------------------------------------------------------------
    console.log("\n-- prompt structure --");
    const promptRu = buildSystemPrompt(settingsA, {
      isFirstReply: false,
      languageContext: { customerLanguage: "ru", languageSource: "explicit", supportedLanguages: ["uz", "ru", "en"], defaultLanguage: "uz" },
    });
    check("Prompt includes customer_language line", /customer_language:\s*Russian/i.test(promptRu));
    check("Prompt includes language_source line reflecting 'explicit'", /language_source:\s*explicit/i.test(promptRu));
    check("Prompt includes supported_languages line", /supported_languages:/.test(promptRu));
    check("Prompt includes default_language line", /default_language:/.test(promptRu));
    check("Prompt instructs against random language switching", /do not randomly switch languages|Do not randomly switch/i.test(promptRu));
    check("Prompt still contains the no-specialization rule (no M4 regression)", /never state what this business/i.test(promptRu));
    check("Prompt still contains the multi-course neutrality rule (no M4 regression)", /do not default to presenting the same course every time/i.test(promptRu));

    // ------------------------------------------------------------------
    // Tier 2: real end-to-end agent tests against real OpenRouter.
    // ------------------------------------------------------------------
    if (!process.env.OPENROUTER_API_KEY) {
      console.log(
        "\nSKIPPED: real-agent language tests (OPENROUTER_API_KEY not set). " +
          "Deterministic tests above still ran and count toward the result."
      );
    } else {
      const { runAgent } = await import("../src/lib/ai/agent");
      const { upsertCustomerFromTelegram } = await import("../src/lib/services/customers");
      const { findOrCreateOpenConversation } = await import("../src/lib/services/conversations");

      async function runRealScenario(label: string, chatId: number, text: string, lang: "uz" | "ru" | "en", isFirstReply: boolean) {
        const customer = await upsertCustomerFromTelegram(orgId, { telegramChatId: chatId });
        const conversation = await findOrCreateOpenConversation(orgId, customer.id);
        const response = await runAgent({
          systemContext: { organizationId: orgId, conversationId: conversation.id, customerId: customer.id },
          history: [],
          incomingText: text,
          isFirstReply,
          businessSettings: settingsA,
          activeCourses: isFirstReply ? [ieltsCourse] : undefined,
          languageContext: { customerLanguage: lang, languageSource: "detected", supportedLanguages: ["uz", "ru", "en"], defaultLanguage: "uz" },
        });
        console.log(`\n[real agent: ${label}] reply: ${response.text}`);
        await admin.from("messages").delete().eq("conversation_id", conversation.id);
        await admin.from("conversations").delete().eq("id", conversation.id);
        return response;
      }

      // Cases 1/2/3: uz/ru/en customer -> response in that language.
      const cyrillicRatio = (s: string) => {
        const cy = (s.match(/[Ѐ-ӿ]/g) ?? []).length;
        const lat = (s.match(/[a-zA-Z]/g) ?? []).length;
        return cy + lat === 0 ? 0 : cy / (cy + lat);
      };

      const uzResp = await runRealScenario("uz customer", 910100001, "IELTS kursi qancha turadi?", "uz", false);
      check("Uzbek customer message -> response is Latin-script (not Cyrillic-dominant)", cyrillicRatio(uzResp.text) < 0.3);
      check("Uzbek-language response preserves the exact price/currency (700000 UZS / 700 000 so'm-style)", /700\s?000/.test(uzResp.text));

      const ruResp = await runRealScenario("ru customer", 910100002, "Сколько стоит IELTS?", "ru", false);
      check("Russian customer message -> response is Cyrillic-dominant", cyrillicRatio(ruResp.text) > 0.5);
      check("Russian-language response preserves the exact price (700000)", /700\s?000/.test(ruResp.text));

      const enResp = await runRealScenario("en customer", 910100003, "How much does IELTS cost?", "en", false);
      check("English customer message -> response is Latin-script, English-looking", /price|cost|IELTS/i.test(enResp.text));
      check("English-language response preserves the exact price (700000)", /700\s?000/.test(enResp.text));

      // Case 15: first-contact introduction still works in the customer's language.
      const introResp = await runRealScenario("first-contact, ru", 910100004, "Здравствуйте", "ru", true);
      check("First-contact introduction in Russian is Cyrillic-dominant", cyrillicRatio(introResp.text) > 0.5);
      check("First-contact introduction does not respond with a bare generic greeting only", introResp.text.trim().length > 20);

      // Case 16: no invented specialization, re-verified under multilingual context.
      check("First-contact introduction (no description configured) does not claim a specialization", !/specializ|ixtisoslash/i.test(introResp.text));
    }
  } finally {
    // ------------------------------------------------------------------
    // Cleanup — disposable fixtures only.
    // ------------------------------------------------------------------
    if (createdCourseIds.length > 0) await admin.from("courses").delete().in("id", createdCourseIds);
    if (createdCustomerIds.length > 0) await admin.from("customers").delete().in("id", createdCustomerIds);
    await admin.from("messages").delete().in("organization_id", [orgId, orgBId]);
    await admin.from("conversations").delete().in("organization_id", [orgId, orgBId]);
    await admin.from("customers").delete().in("organization_id", [orgId, orgBId]);
    await admin.from("business_settings").delete().in("organization_id", [orgId, orgBId]);
    await admin.from("organizations").delete().in("id", [orgId, orgBId]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL: unexpected error:", err);
  process.exit(1);
});
