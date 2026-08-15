import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { listAppointmentsForCustomer, updateAppointmentStatus } from "@/lib/services/appointments";
import { dispatchTrigger } from "@/lib/automation/engine";

const inputSchema = z.object({
  reason: z.string().optional().describe("Why the customer is cancelling, if they said"),
});

export const cancelAppointmentTool = defineTool({
  name: "cancel_appointment",
  description:
    "Cancel the current conversation's customer's upcoming appointment when they say they can't make it / don't want to come / want to cancel. Resolves the customer's nearest scheduled appointment automatically — you cannot cancel an appointment for a different customer or by guessing an appointment id. This is the ONLY way to actually cancel a booking — acknowledging the cancellation in your reply without calling this tool leaves the appointment scheduled in the system.",
  schema: inputSchema,
  handler: async (_input, context) => {
    try {
      const appointments = await listAppointmentsForCustomer(context.organizationId, context.customerId);
      const nextScheduled = appointments
        .filter((a) => a.status === "scheduled")
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

      if (!nextScheduled) {
        return { ok: false, error: "This customer has no scheduled appointment to cancel." };
      }

      const updated = await updateAppointmentStatus(context.organizationId, nextScheduled.id, "cancelled");
      if (!updated) return { ok: false, error: "Appointment not found" };

      void dispatchTrigger({
        type: "appointment_cancelled",
        organizationId: context.organizationId,
        appointmentId: updated.id,
        customerId: context.customerId,
      });

      return { ok: true, data: updated };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "cancel_appointment failed" };
    }
  },
});
