import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { createAppointment } from "@/lib/services/appointments";
import { findActiveLeadForCustomer, updateLead } from "@/lib/services/leads";
import { dispatchTrigger } from "@/lib/automation/engine";

const inputSchema = z.object({
  courseGroupId: z.string().uuid().describe("The course_group id to book into, from check_available_appointments"),
  scheduledAt: z.string().datetime().describe("ISO 8601 timestamp for the appointment"),
  notes: z.string().optional(),
});

export const createAppointmentTool = defineTool({
  name: "create_appointment",
  description:
    "Book a trial lesson / appointment for the current conversation's customer into a specific course group and time. Always call check_available_appointments first to get a real courseGroupId and confirm seats remain. This tool is the ONLY way to confirm a booking — never tell the customer their appointment is booked unless this tool returns ok:true.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const activeLead = await findActiveLeadForCustomer(context.organizationId, context.customerId);

      const result = await createAppointment(context.organizationId, {
        customerId: context.customerId,
        courseGroupId: input.courseGroupId,
        scheduledAt: input.scheduledAt,
        notes: input.notes,
        leadId: activeLead?.id,
      });

      if (!result.ok) {
        const messages: Record<typeof result.reason, string> = {
          group_not_found: "That course group does not exist or is no longer active.",
          group_full: "That group is fully booked — no seats remain. Suggest checking other groups.",
          already_booked: "This customer already has an appointment for that group and time.",
        };
        return { ok: false, error: messages[result.reason] };
      }

      if (activeLead) {
        await updateLead(context.organizationId, activeLead.id, { status: "appointment_booked" });
      }

      void dispatchTrigger({
        type: "appointment_created",
        organizationId: context.organizationId,
        appointmentId: result.appointment.id,
        customerId: context.customerId,
        leadId: activeLead?.id ?? null,
      });

      return { ok: true, data: result.appointment };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "create_appointment failed" };
    }
  },
});
