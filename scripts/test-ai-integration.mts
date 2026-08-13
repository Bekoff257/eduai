// MILESTONE 2.5 — real OpenRouter integration test.
//
// This is the only test in the project that makes a REAL request to
// OpenRouter and spends real API credit. Unlike scripts/test-service-
// tenant-isolation.mjs and scripts/smoke-test-webhook-pipeline.mjs (which
// re-issue equivalent Supabase queries rather than importing production
// code, because those files' "server-only" imports can't be resolved from
// a plain Node script), THIS script imports and runs the actual
// src/lib/ai/agent.ts, src/lib/ai/tools/*, and src/lib/services/* used in
// production, unmodified. That import chain now resolves because this
// script is run via `tsx` with NODE_OPTIONS=--conditions=react-server,
// which makes the "server-only" package resolve to its no-op export
// instead of throwing (see package.json's test:ai script and README.md).
//
// What this proves that the other tests do NOT: that the real model,
// given the real tool schemas generated from the real Zod schemas, will
// actually choose to call a real tool, that the real tool executes
// against real Supabase through the real service layer, and that the
// model's final answer reflects what the tool actually returned — the
// full loop, not a mocked piece of it.
//
// Run with: npm run test:ai
// Requires: OPENROUTER_API_KEY (spends real API credit — do not run in a
// loop or CI on every commit), SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// pointed at the same hosted Supabase Cloud project the app itself uses
// (via .env.local — no separate local/Docker instance, and no override
// vars needed; this test uses production's own configuration as-is).

import { createClient } from "@supabase/supabase-js";

// ----------------------------------------------------------------------------
// 1. Environment checks — fail fast and clearly, never silently mock.
// ----------------------------------------------------------------------------

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error(
    "FAIL: OPENROUTER_API_KEY is not set.\n\n" +
      "This test makes a real request to OpenRouter and cannot run without a\n" +
      "real API key. It will NOT mock the model — set OPENROUTER_API_KEY in\n" +
      ".env.local (or the environment) and try again.\n\n" +
      "This is not a bug: the test is deliberately refusing to fake AI\n" +
      "integration rather than silently pass without one."
  );
  process.exit(1);
}

// The real getSupabaseServiceClient() (src/lib/supabase/server.ts) reads
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from process.env at call time —
// no override here, so this test talks to whatever .env.local already
// points at: the same hosted Supabase Cloud project production uses. This
// project has no local/Docker Supabase workflow (see docs/architecture.md),
// so this is the only Supabase this test — or anything else — ever runs
// against.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "FAIL: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set.\n\n" +
      "This test talks to the same hosted Supabase Cloud project the app\n" +
      "itself uses — set both in .env.local (see .env.example) and try again."
  );
  process.exit(1);
}

// Imported AFTER the env overrides above, and only once — every module in
// this chain (agent.ts, tools/*, services/*) is the real, unmodified
// production module, not a copy.
const { runAgent } = await import("../src/lib/ai/agent");
const { searchCourses } = await import("../src/lib/services/courses");

// ----------------------------------------------------------------------------
// Seed fixtures (supabase/seed.sql) — Organization A "Bright Path Academy".
// ----------------------------------------------------------------------------
const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_A_CUSTOMER = "00000000-0000-0000-0000-0000000a0021";
const ORG_A_CONVERSATION = "00000000-0000-0000-0000-0000000a0041";

const results = {
  openRouterRequest: false,
  toolCallOccurred: false,
  searchCoursesCalled: false,
  toolExecutionOk: false,
  supabaseDataReturned: false,
  finalResponseReceived: false,
  finalResponseMentionsRealCourse: false,
};

function log(event: string, detail?: Record<string, unknown>) {
  const safeDetail = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[test-ai] ${event}${safeDetail}`);
}

async function main() {
  // 2. Supabase reachability.
  const adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: reachError } = await adminClient.from("organizations").select("id").limit(1);
  if (reachError) {
    console.error(`FAIL: Supabase is not reachable at ${SUPABASE_URL} (${reachError.message}).`);
    process.exit(1);
  }
  log("Supabase reachable", { url: SUPABASE_URL });

  // 3. Seeded test data exists.
  const { data: org } = await adminClient.from("organizations").select("id, name").eq("id", ORG_A).maybeSingle();
  const { data: customer } = await adminClient
    .from("customers")
    .select("id")
    .eq("id", ORG_A_CUSTOMER)
    .maybeSingle();
  const { data: conversation } = await adminClient
    .from("conversations")
    .select("id, mode")
    .eq("id", ORG_A_CONVERSATION)
    .maybeSingle();

  if (!org || !customer || !conversation) {
    console.error(
      "FAIL: expected seed data not found (organization/customer/conversation from supabase/seed.sql)\n" +
        `on the Supabase project at ${SUPABASE_URL}. Apply supabase/seed.sql to it and retry.`
    );
    process.exit(1);
  }
  log("seed data verified", { organization: org.name, conversationMode: conversation.mode });

  // Ground truth, fetched independently of the agent run (via the real
  // service function, not a re-implementation), for verifying the model's
  // final answer actually reflects real seeded data rather than a
  // plausible-sounding hallucination.
  const realCourses = await searchCourses(ORG_A);
  if (realCourses.length === 0) {
    console.error("FAIL: no active courses seeded for Org A — nothing for search_courses to find.");
    process.exit(1);
  }
  log(
    "ground-truth courses fetched directly from Supabase (independent of the agent run)",
    { courseNames: realCourses.map((c) => c.name) }
  );

  // 4 & 5. Construct the normalized InboundMessage + ToolContext using the
  // existing channel abstraction and existing seed fixtures — organizationId/
  // conversationId/customerId come from resolved seed data, never from
  // anything the model could influence.
  const incomingText = "Hi, what courses do you offer?";
  const toolContext = {
    organizationId: ORG_A,
    conversationId: ORG_A_CONVERSATION,
    customerId: ORG_A_CUSTOMER,
  };
  log("constructed ToolContext from seed data", toolContext);
  log("constructed InboundMessage text", { text: incomingText });

  // 6 & 7. Invoke the EXISTING agent implementation. This is the one real
  // OpenRouter request this test makes — no retry loop, at most one call.
  log("model request started", { model: process.env.OPENROUTER_MODEL ?? "(default)" });

  const agentResponse = await runAgent({
    systemContext: toolContext,
    history: [],
    incomingText,
  });

  results.openRouterRequest = true;
  log("model request completed");

  // 8. Capture tool calls performed by the agent (AgentResponse.actions is
  // existing production data — runAgent() already returns this for every
  // caller, including the real Telegram webhook route; nothing was added
  // to expose it).
  for (const action of agentResponse.actions) {
    log("tool call recorded", { tool: action.tool, status: action.status });
  }

  results.toolCallOccurred = agentResponse.actions.length > 0;
  const searchCoursesCall = agentResponse.actions.find((a) => a.tool === "search_courses");
  results.searchCoursesCalled = !!searchCoursesCall;
  results.toolExecutionOk = searchCoursesCall?.status === "success";

  // ai_actions is written by the real logAiAction() call inside agent.ts —
  // check it directly as independent confirmation the tool call was
  // executed through the real tool registry and logged like any other
  // production tool call, not just reflected in the in-memory response.
  const { data: aiActionRows } = await adminClient
    .from("ai_actions")
    .select("tool_name, status, output")
    .eq("organization_id", ORG_A)
    .eq("conversation_id", ORG_A_CONVERSATION)
    .eq("tool_name", "search_courses")
    .order("created_at", { ascending: false })
    .limit(1);

  const latestAiAction = aiActionRows?.[0];
  results.supabaseDataReturned =
    !!latestAiAction &&
    latestAiAction.status === "success" &&
    Array.isArray(latestAiAction.output) &&
    latestAiAction.output.length > 0;

  if (latestAiAction) {
    log("ai_actions row confirms tool execution was logged", {
      tool: latestAiAction.tool_name,
      status: latestAiAction.status,
      resultCount: Array.isArray(latestAiAction.output) ? latestAiAction.output.length : 0,
    });
  }

  // 9 & 10. Final AgentResponse + whether it reflects real seeded data.
  results.finalResponseReceived = typeof agentResponse.text === "string" && agentResponse.text.trim().length > 0;
  log("final response received", { length: agentResponse.text.length });

  const lowerText = agentResponse.text.toLowerCase();
  results.finalResponseMentionsRealCourse = realCourses.some((course) =>
    lowerText.includes(course.name.toLowerCase())
  );

  // ----------------------------------------------------------------------------
  // Report
  // ----------------------------------------------------------------------------
  console.log("\nAI Integration Test");
  console.log("-------------------");
  console.log(`OpenRouter request: ${results.openRouterRequest ? "PASS" : "FAIL"}`);
  console.log(
    `Tool call: ${results.searchCoursesCalled ? "search_courses" : "NONE (expected search_courses)"}`
  );
  console.log(`Tool execution: ${results.toolExecutionOk ? "PASS" : "FAIL"}`);
  console.log(`Supabase data returned: ${results.supabaseDataReturned ? "PASS" : "FAIL"}`);
  console.log(`Final AI response: ${results.finalResponseReceived ? "PASS" : "FAIL"}`);
  console.log(
    `Response reflects real seeded data: ${results.finalResponseMentionsRealCourse ? "PASS" : "FAIL"}`
  );
  console.log(`\nFinal response text:\n"${agentResponse.text}"`);

  const allPassed =
    results.openRouterRequest &&
    results.toolCallOccurred &&
    results.searchCoursesCalled &&
    results.toolExecutionOk &&
    results.supabaseDataReturned &&
    results.finalResponseReceived &&
    results.finalResponseMentionsRealCourse;

  console.log(`\nResult: ${allPassed ? "PASS" : "FAIL"}`);

  if (!allPassed) {
    if (!results.searchCoursesCalled) {
      console.error(
        "\nDiagnostic: the model did not call search_courses for the prompt " +
          `"${incomingText}". This is a real model behavior result, not a test bug — ` +
          "the system prompt and tool description both instruct the model to check " +
          "courses via a tool rather than answer from its own knowledge. If this " +
          "happens repeatedly, it indicates a real reliability issue with the current " +
          "model/prompt/tool-description combination, not a broken test."
      );
    }
    process.exit(1);
  }

  // This scenario is read-only (search_courses never writes), so there is
  // no temporary data to clean up.
}

main().catch((err) => {
  console.error("FAIL: unexpected error during AI integration test:", err);
  process.exit(1);
});
