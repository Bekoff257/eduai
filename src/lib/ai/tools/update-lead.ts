import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { findActiveLeadForCustomer, updateLead } from "@/lib/services/leads";
import { dispatchTrigger } from "@/lib/automation/engine";

const inputSchema = z.object({
  status: z
    .enum(["new", "contacted", "qualified", "appointment_booked", "converted", "lost"])
    .optional()
    .describe("New lead status, if it should change"),
  notes: z.string().optional().describe("Updated notes about the lead"),
  courseId: z.string().uuid().optional().describe("Update the course of interest"),
});

export const updateLeadTool = defineTool({
  name: "update_lead",
  description:
    "Update the current conversation's customer's active lead (status/notes/course). Resolves the lead from THIS conversation's customer automatically — you cannot update a lead belonging to a different customer.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const lead = await findActiveLeadForCustomer(context.organizationId, context.customerId);
      if (!lead) {
        return { ok: false, error: "No active lead exists for this customer yet — use create_lead first." };
      }

      const updated = await updateLead(context.organizationId, lead.id, input);
      if (!updated) return { ok: false, error: "Lead not found" };

      if (input.status !== undefined && input.status !== lead.status) {
        void dispatchTrigger({
          type: "lead_status_changed",
          organizationId: context.organizationId,
          leadId: lead.id,
          customerId: context.customerId,
          previousStatus: lead.status,
          newStatus: input.status,
        });
      }

      return { ok: true, data: updated };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "update_lead failed" };
    }
  },
});
