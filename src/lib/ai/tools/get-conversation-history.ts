import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { listRecentMessages } from "@/lib/services/messages";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe("How many recent messages to fetch (default 20)"),
});

export const getConversationHistoryTool = defineTool({
  name: "get_conversation_history",
  description:
    "Fetch earlier messages from THIS conversation, beyond what's already in your context. Use this if you need more history than was provided upfront — you cannot fetch history for a different conversation.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const messages = await listRecentMessages(context.organizationId, context.conversationId, input.limit ?? 20);
      return { ok: true, data: messages.slice().reverse() };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "get_conversation_history failed",
      };
    }
  },
});
