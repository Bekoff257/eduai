import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { getCourse } from "@/lib/services/courses";

const inputSchema = z.object({
  courseId: z.string().uuid().describe("The course's internal id, from search_courses"),
});

export const getCourseTool = defineTool({
  name: "get_course",
  description: "Get full details (price, currency, description, duration) for a single course by id. Always state the returned price together with its currency, exactly as returned — never a different or omitted currency.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const course = await getCourse(context.organizationId, input.courseId);
      if (!course) return { ok: false, error: "Course not found" };
      return { ok: true, data: course };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "get_course failed" };
    }
  },
});
