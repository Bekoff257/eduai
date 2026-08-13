import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { updateCustomer } from "@/lib/services/customers";

const inputSchema = z.object({
  fullName: z.string().min(1).optional().describe("Customer's full name, if they provided it"),
  phone: z.string().min(1).optional().describe("Customer's phone number, if they provided it"),
  language: z.string().min(2).max(10).optional().describe("Preferred language code, e.g. 'en', 'uz', 'ru'"),
});

export const updateCustomerTool = defineTool({
  name: "update_customer",
  description:
    "Save details (name, phone number, preferred language) onto the current conversation's customer record. Every Telegram customer already has a record from the moment they first message — use THIS tool, not create_customer, whenever they tell you their name or phone number. Resolves the customer from THIS conversation automatically — you cannot update a different customer.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const customer = await updateCustomer(context.organizationId, context.customerId, input);
      if (!customer) return { ok: false, error: "Customer not found" };
      return { ok: true, data: customer };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "update_customer failed" };
    }
  },
});
