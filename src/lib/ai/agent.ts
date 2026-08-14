import "server-only";
import { z } from "zod";
import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { getOpenRouterClient, AI_MODEL } from "@/lib/ai/client";
import { allTools, toolsByName } from "@/lib/ai/tools";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { getBusinessSettings } from "@/lib/services/business-settings";
import { logAiAction } from "@/lib/services/ai-actions";
import { timed } from "@/lib/timing";
import type { AgentAction, AgentResponse, ToolContext } from "@/lib/ai/types";
import type { Message } from "@/lib/services/messages";
import type { BusinessSettings } from "@/lib/services/business-settings";
import type { Course } from "@/lib/services/courses";
import type { LanguageContext } from "@/lib/ai/system-prompt";

const MAX_TOOL_ROUNDS = 5;

const FALLBACK_TEXT =
  "Sorry, I'm having trouble processing that right now. A member of our team will help you shortly.";

function toChatMessage(message: Message): ChatCompletionMessageParam {
  if (message.sender === "customer") {
    return { role: "user", content: message.content };
  }
  // "ai", "staff", and "system" senders are all represented to the model
  // as the assistant's own prior turns — staff replies sent while a human
  // had taken over still count as "what was said to the customer" for
  // conversation continuity when control returns to the AI.
  return { role: "assistant", content: message.content };
}

function toOpenAiTools(): ChatCompletionTool[] {
  return allTools.map((tool) => {
    const jsonSchema = z.toJSONSchema(tool.schema as z.ZodType) as Record<string, unknown>;
    delete jsonSchema.$schema;

    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      },
    };
  });
}

/**
 * Runs the tool-calling loop against OpenRouter for one inbound customer
 * message. Never fabricates a response on failure — returns the safe
 * fallback text instead (see docs/architecture.md#failure-handling).
 */
export async function runAgent(params: {
  systemContext: ToolContext;
  history: Message[];
  incomingText: string;
  /** True the very first time this customer ever receives an AI/staff
   * reply (see src/lib/services/messages.ts#hasReceivedPriorReply) —
   * lets the agent deliver a proactive business introduction instead of
   * a generic "how can I help" on a first "Hi". Not derived from
   * `history` being empty, since a closed-then-reopened conversation
   * would otherwise incorrectly look like a new customer. Defaults to
   * false (existing behavior) if the caller doesn't know/pass it. */
  isFirstReply?: boolean;
  /** Pre-fetched business settings, if the caller already has them (the
   * webhook route fetches them anyway to check business_settings.ai_enabled
   * before ever calling runAgent — passing that same result through here
   * avoids fetching the identical row a second time). If omitted, runAgent
   * fetches it itself, same as before — this parameter is purely an
   * optional optimization, never a behavior change. */
  businessSettings?: BusinessSettings | null;
  /** Pre-fetched active courses, only meaningful when isFirstReply is true.
   * The webhook route fetches these in parallel with settings/history/
   * first-reply detection (see route.ts) so the system prompt can hand the
   * model real course data up front — this is what lets a first reply
   * answer in ONE OpenRouter round instead of a mandatory
   * "call search_courses, then answer" two-round trip. search_courses
   * remains available as a tool for anything this snapshot doesn't cover
   * (see system-prompt.ts). Omit/undefined on non-first replies, where the
   * model is expected to call search_courses itself if it needs course
   * data — that path is rarer and doesn't justify fetching courses on
   * every single message. */
  activeCourses?: Course[];
  /** The customer's resolved language for this reply, plus enough context
   * for the model to follow M5's language rules (never switch without an
   * explicit request, never respond in a disabled language unless the
   * customer explicitly asked for it, etc — see buildSystemPrompt). Always
   * provided by the webhook route (resolveCustomerLanguage never returns
   * nothing); optional here only so callers that genuinely have no
   * language context (e.g. some test scripts) don't have to fabricate one
   * — buildSystemPrompt falls back to the old un-language-aware behavior
   * when this is omitted. */
  languageContext?: LanguageContext;
}): Promise<AgentResponse> {
  const { systemContext, history, incomingText, isFirstReply = false, activeCourses, languageContext } = params;

  let client: OpenAI;
  try {
    client = getOpenRouterClient();
  } catch (err) {
    console.error("runAgent: failed to construct OpenRouter client:", err);
    return { text: FALLBACK_TEXT, actions: [], leadUpdated: false, appointmentCreated: false, needsHumanAttention: true };
  }

  const businessSettings =
    params.businessSettings !== undefined
      ? params.businessSettings
      : await timed("supabase.getBusinessSettings(agent)", () =>
          getBusinessSettings(systemContext.organizationId).catch(() => null)
        );
  const systemPrompt = buildSystemPrompt(businessSettings, { isFirstReply, activeCourses, languageContext });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map(toChatMessage),
    { role: "user", content: incomingText },
  ];

  const tools = toOpenAiTools();
  const actions: AgentAction[] = [];
  let leadUpdated = false;
  let appointmentCreated = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let completion;
    try {
      completion = await timed(`openrouter.request(round=${round})`, () =>
        client.chat.completions.create({
          model: AI_MODEL,
          messages,
          tools,
        })
      );
    } catch (err) {
      console.error("runAgent: OpenRouter request failed:", err);
      return {
        text: FALLBACK_TEXT,
        actions,
        leadUpdated,
        appointmentCreated,
        needsHumanAttention: true,
      };
    }

    const choice = completion.choices[0];
    const responseMessage = choice?.message;

    if (!responseMessage) {
      return { text: FALLBACK_TEXT, actions, leadUpdated, appointmentCreated, needsHumanAttention: true };
    }

    const toolCalls = responseMessage.tool_calls?.filter(
      (call): call is Extract<typeof call, { type: "function" }> => call.type === "function"
    );

    if (!toolCalls || toolCalls.length === 0) {
      const text = responseMessage.content?.trim();
      return {
        text: text || FALLBACK_TEXT,
        actions,
        leadUpdated,
        appointmentCreated,
        needsHumanAttention: !text,
      };
    }

    messages.push({
      role: "assistant",
      content: responseMessage.content,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const tool = toolsByName.get(call.function.name);

      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: "Unknown tool" }),
        });
        continue;
      }

      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(call.function.arguments || "{}");
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: "Invalid tool arguments" }),
        });
        continue;
      }

      const validation = tool.schema.safeParse(parsedInput);
      if (!validation.success) {
        const errorMessage = `Invalid input: ${validation.error.message}`;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: errorMessage }),
        });
        actions.push({ tool: tool.name, status: "failure", summary: errorMessage });
        // Not awaited — see the comment on the success-path logAiAction
        // call below for why this audit write is safe to detach from the
        // customer-facing response path.
        void logAiAction(systemContext.organizationId, {
          conversationId: systemContext.conversationId,
          toolName: tool.name,
          input: parsedInput,
          output: null,
          status: "failure",
          errorMessage,
        });
        continue;
      }

      // systemContext (organizationId, conversationId, customerId) is
      // always injected here from server-derived state — validation.data
      // (the model's tool-call arguments) can never override it, since
      // ToolContext is a separate parameter tool handlers receive, not a
      // field tool schemas define.
      //
      // The `never` cast below is safe specifically BECAUSE validation.data
      // just came from tool.schema.safeParse() two lines above — it is
      // exactly the shape tool.handler expects, and AnyToolDefinition's
      // erased `never` parameter type exists only to prevent calling
      // handler with unvalidated input elsewhere in the codebase.
      const result = await timed(`tool.${tool.name}`, () => tool.handler(validation.data as never, systemContext));

      actions.push({
        tool: tool.name,
        status: result.ok ? "success" : "failure",
        summary: result.ok ? "completed" : (result.error ?? "failed"),
      });

      // Not awaited — logAiAction writes to a separate audit table
      // (ai_actions), not to the `messages` transcript this loop sends
      // back to OpenRouter, so the customer-facing response does not
      // depend on this write completing. logAiAction's own failure
      // handling already logs-and-swallows rather than throwing (see
      // src/lib/services/ai-actions.ts), so a rejected promise here is
      // still safe to leave unhandled beyond the .catch below.
      void timed(`supabase.logAiAction(${tool.name})`, () =>
        logAiAction(systemContext.organizationId, {
          conversationId: systemContext.conversationId,
          toolName: tool.name,
          input: validation.data,
          output: result.ok ? result.data : null,
          status: result.ok ? "success" : "failure",
          errorMessage: result.ok ? undefined : result.error,
        })
      ).catch((err) => console.error("runAgent: logAiAction failed:", err));

      if (tool.name === "create_lead" || tool.name === "update_lead") {
        leadUpdated = leadUpdated || result.ok;
      }
      if (tool.name === "create_appointment") {
        appointmentCreated = appointmentCreated || result.ok;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Exhausted MAX_TOOL_ROUNDS without a final text response — fail safe
  // rather than looping forever or returning an empty message.
  return { text: FALLBACK_TEXT, actions, leadUpdated, appointmentCreated, needsHumanAttention: true };
}
