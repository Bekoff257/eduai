import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { createFollowUp } from "@/lib/services/follow-ups";
import { findActiveLeadForCustomer, setLeadNextFollowUpAt } from "@/lib/services/leads";

const inputSchema = z.object({
  dueAt: z.string().datetime().describe("ISO 8601 timestamp for when this follow-up/reminder should be sent"),
  message: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "What to send the customer at dueAt, e.g. a reminder ('Your IELTS trial lesson is tomorrow at 6pm!') or a check-in ('Just checking in — still interested in the General English course?'). If omitted, a generic follow-up is scheduled without pre-written text."
    ),
});

export const createFollowUpTool = defineTool({
  name: "create_follow_up",
  description:
    "Schedule a follow-up message or reminder to be sent to the current conversation's customer at a future time (e.g. a reminder before their appointment, or a check-in if they went quiet on a lead). Requires the customer to already have an active lead — call create_lead first if one doesn't exist. This only SCHEDULES the message; it is sent later by a background job, not immediately.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const activeLead = await findActiveLeadForCustomer(context.organizationId, context.customerId);
      if (!activeLead) {
        return {
          ok: false,
          error: "This customer has no active lead yet — call create_lead first before scheduling a follow-up.",
        };
      }

      const followUp = await createFollowUp(context.organizationId, {
        leadId: activeLead.id,
        customerId: context.customerId,
        dueAt: input.dueAt,
        message: input.message,
      });

      await setLeadNextFollowUpAt(context.organizationId, activeLead.id, input.dueAt);

      return { ok: true, data: followUp };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "create_follow_up failed" };
    }
  },
});
