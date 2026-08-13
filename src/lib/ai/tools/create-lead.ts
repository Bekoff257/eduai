import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { createLead, findActiveLeadForCustomer, updateLead } from "@/lib/services/leads";

const inputSchema = z.object({
  courseId: z.string().uuid().optional().describe("The course the customer is interested in, if known"),
  notes: z.string().optional().describe("Brief note on what the customer wants, e.g. 'wants to start next month'"),
});

export const createLeadTool = defineTool({
  name: "create_lead",
  description:
    "Record the current conversation's customer as a lead when they show buying interest (asking about enrolling, pricing with intent to join, wanting to start soon). Always attaches to the customer of THIS conversation — you cannot create a lead for a different customer. Safe to call even if you already called this earlier in the conversation, or aren't sure whether a lead already exists — it reuses/updates the customer's existing active lead instead of creating a duplicate.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      // Idempotent by construction: a customer can only have one ACTIVE
      // lead at a time (findActiveLeadForCustomer excludes
      // converted/lost), so re-calling this tool later in the same or a
      // later conversation must update that existing row rather than
      // insert a new one — otherwise every time the model decides "this
      // looks like interest, better record it" for the same customer, a
      // fresh duplicate lead appears in the dashboard instead of the
      // existing one being kept current.
      const existing = await findActiveLeadForCustomer(context.organizationId, context.customerId);
      if (existing) {
        const updated = await updateLead(context.organizationId, existing.id, {
          courseId: input.courseId,
          notes: input.notes,
        });
        return { ok: true, data: updated ?? existing };
      }

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
