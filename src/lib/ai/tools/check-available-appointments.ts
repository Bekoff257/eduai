import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { checkAvailableAppointments } from "@/lib/services/appointments";

const inputSchema = z.object({
  courseId: z.string().uuid().optional().describe("Optionally filter to groups for one course"),
});

export const checkAvailableAppointmentsTool = defineTool({
  name: "check_available_appointments",
  description:
    "Check real seat availability for course groups (schedule cohorts), including how many seats remain. Always call this before offering to book a trial — never claim a slot is available without checking.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const availability = await checkAvailableAppointments(context.organizationId, input.courseId);
      return { ok: true, data: availability };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "check_available_appointments failed",
      };
    }
  },
});
