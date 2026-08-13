import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { createLead } from "@/lib/services/leads";

const inputSchema = z.object({
  courseId: z.string().uuid().optional().describe("The course the customer is interested in, if known"),
  notes: z.string().optional().describe("Brief note on what the customer wants, e.g. 'wants to start next month'"),
});

export const createLeadTool = defineTool({
  name: "create_lead",
  description:
    "Record the current conversation's customer as a lead when they show buying interest (asking about enrolling, pricing with intent to join, wanting to start soon). Always attaches to the customer of THIS conversation — you cannot create a lead for a different customer.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const lead = await createLead(context.organizationId, {
        customerId: context.customerId,
        courseId: input.courseId,
        notes: input.notes,
        source: "telegram",
      });
      return { ok: true, data: lead };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "create_lead failed" };
    }
  },
});
