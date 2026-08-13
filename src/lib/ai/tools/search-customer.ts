import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { searchCustomers } from "@/lib/services/customers";

const inputSchema = z.object({
  query: z.string().min(1).describe("Name, Telegram username, or phone number to search for"),
});

export const searchCustomerTool = defineTool({
  name: "search_customer",
  description:
    "Search for existing customers by name, Telegram username, or phone number within this business.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const customers = await searchCustomers(context.organizationId, input.query);
      return { ok: true, data: customers };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "search_customer failed" };
    }
  },
});
