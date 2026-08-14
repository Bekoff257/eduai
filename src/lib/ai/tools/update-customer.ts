import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { updateCustomer } from "@/lib/services/customers";

const inputSchema = z.object({
  fullName: z.string().min(1).optional().describe("Customer's full name, if they provided it"),
  phone: z.string().min(1).optional().describe("Customer's phone number, if they provided it"),
  language: z
    .string()
    .min(2)
    .max(10)
    .optional()
    .describe(
      "Preferred language code, e.g. 'en', 'uz', 'ru'. Only set this for a language the system's own automatic detection would NOT catch (see the system prompt's LANGUAGE CONTEXT — customer_language already reflects normal explicit requests and auto-detection before you ever see this conversation turn, so you almost never need to set this yourself)."
    ),
});

export const updateCustomerTool = defineTool({
  name: "update_customer",
  description:
    "Save details (name, phone number) onto the current conversation's customer record. Every Telegram customer already has a record from the moment they first message — use THIS tool, not create_customer, whenever they tell you their name or phone number. Resolves the customer from THIS conversation automatically — you cannot update a different customer. Language is normally handled automatically (see LANGUAGE CONTEXT in the system prompt) — do not call this tool just to set language unless the customer's request is one the system context doesn't already reflect.",
  schema: inputSchema,
  handler: async (input, context) => {
    try {
      // A language the MODEL sets here is always recorded as 'detected',
      // never 'explicit' — the deterministic webhook-side detection (see
      // resolveCustomerLanguage) is the sole authority on what counts as an
      // explicit, permanent preference; the model choosing to call this
      // tool is not that same guarantee, so it must remain overridable by
      // future detection rather than permanently locking the language in.
      const customer = await updateCustomer(context.organizationId, context.customerId, {
        ...input,
        languageSource: input.language !== undefined ? "detected" : undefined,
      });
      if (!customer) return { ok: false, error: "Customer not found" };
      return { ok: true, data: customer };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "update_customer failed" };
    }
  },
});
