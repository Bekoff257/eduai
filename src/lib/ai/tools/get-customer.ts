import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { getCustomer } from "@/lib/services/customers";

const inputSchema = z.object({
  customerId: z.string().uuid().describe("The customer's internal id"),
});

export const getCustomerTool = defineTool({
  name: "get_customer",
  description: "Get full details for a single customer by id.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const customer = await getCustomer(context.organizationId, input.customerId);
      if (!customer) return { ok: false, error: "Customer not found" };
      return { ok: true, data: customer };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "get_customer failed" };
    }
  },
});
