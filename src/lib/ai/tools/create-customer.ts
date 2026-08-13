import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { createCustomer } from "@/lib/services/customers";

const inputSchema = z.object({
  fullName: z.string().min(1).optional().describe("Customer's full name, if known"),
  phone: z.string().min(1).optional().describe("Customer's phone number, if provided"),
  language: z.string().min(2).max(10).optional().describe("Preferred language code, e.g. 'en', 'uz', 'ru'"),
});

export const createCustomerTool = defineTool({
  name: "create_customer",
  description:
    "Create a new customer record when the current conversation's customer needs additional details saved (e.g. they gave their name or phone number). Do NOT use this to create a duplicate of the customer already attached to this conversation — that customer record already exists.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      const customer = await createCustomer(context.organizationId, input);
      return { ok: true, data: customer };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "create_customer failed" };
    }
  },
});
