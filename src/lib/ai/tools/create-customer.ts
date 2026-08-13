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
    "Create a brand-new, SEPARATE customer record — for a person other than the one you're currently talking to (e.g. they're asking on behalf of a friend or relative). The customer of THIS conversation already has a record from the moment they first messaged; to save their name/phone/language, use update_customer instead, never this tool.",
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
