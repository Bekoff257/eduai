import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { searchCourses } from "@/lib/services/courses";

const inputSchema = z.object({
  query: z.string().optional().describe("Optional course name filter, e.g. 'IELTS'"),
});

export const searchCoursesTool = defineTool({
  name: "search_courses",
  description:
    "List active courses this business offers, optionally filtered by name. Returns each course's name, description, price, currency, and duration (if set). Use this before quoting prices, durations, or describing courses — never invent course names, prices, durations, or currencies. Each course's price and currency are a pair — always state them together exactly as returned (e.g. price 700000 with currency UZS means \"700000 UZS\", never a different or omitted currency). A null/missing duration means it hasn't been set — say so rather than guessing one.",
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
