import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { searchCourseGroups } from "@/lib/services/course-groups";

const inputSchema = z.object({
  courseId: z.string().uuid().optional().describe("Optionally filter to groups for one course"),
});

export const searchCourseGroupsTool = defineTool({
  name: "search_course_groups",
  description:
    "List schedule groups (day/time cohorts) for a course, e.g. 'Mon/Wed/Fri 18:00'. Use this to answer schedule questions — never invent days or times.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const groups = await searchCourseGroups(context.organizationId, input.courseId);
      return { ok: true, data: groups };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "search_course_groups failed" };
    }
  },
});
