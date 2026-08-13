import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { searchCourses } from "@/lib/services/courses";

const inputSchema = z.object({
  query: z.string().optional().describe("Optional course name filter, e.g. 'IELTS'"),
});

export const searchCoursesTool = defineTool({
  name: "search_courses",
  description:
    "List active courses this business offers, optionally filtered by name. Use this before quoting prices or describing courses — never invent course names or prices.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const courses = await searchCourses(context.organizationId, input.query);
      return { ok: true, data: courses };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "search_courses failed" };
    }
  },
});
