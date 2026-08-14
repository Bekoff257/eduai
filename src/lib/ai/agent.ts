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
import type { AgentAction, AgentResponse, ToolContext } from "@/lib/ai/types";
import type { Message } from "@/lib/services/messages";

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
}): Promise<AgentResponse> {
  const { systemContext, history, incomingText, isFirstReply = false } = params;

  let client: OpenAI;
  try {
    client = getOpenRouterClient();
  } catch (err) {
    console.error("runAgent: failed to construct OpenRouter client:", err);
    return { text: FALLBACK_TEXT, actions: [], leadUpdated: false, appointmentCreated: false, needsHumanAttention: true };
  }

  const businessSettings = await getBusinessSettings(systemContext.organizationId).catch(() => null);
  const systemPrompt = buildSystemPrompt(businessSettings, { isFirstReply });

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
      completion = await client.chat.completions.create({
        model: AI_MODEL,
        messages,
        tools,
      });
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
        await logAiAction(systemContext.organizationId, {
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
      const result = await tool.handler(validation.data as never, systemContext);

      actions.push({
        tool: tool.name,
        status: result.ok ? "success" : "failure",
        summary: result.ok ? "completed" : (result.error ?? "failed"),
      });

      await logAiAction(systemContext.organizationId, {
        conversationId: systemContext.conversationId,
        toolName: tool.name,
        input: validation.data,
        output: result.ok ? result.data : null,
        status: result.ok ? "success" : "failure",
        errorMessage: result.ok ? undefined : result.error,
      });

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
