import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth, requireAdminRole } from "@/lib/dashboard/api-auth";
import { getBusinessSettings, updateBusinessSettings } from "@/lib/services/business-settings";

const dayHoursSchema = z.object({
  open: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  close: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
});

const updateSchema = z
  .object({
    businessName: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    aiTone: z.string().trim().max(200).optional(),
    aiEnabled: z.boolean().optional(),
    workingHours: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), dayHoursSchema).optional(),
    policies: z.string().trim().max(4000).optional(),
    defaultCurrency: z.string().trim().length(3).optional(),
    languages: z.array(z.string().trim().min(2).max(10)).min(1).optional(),
    defaultLanguage: z.string().trim().min(2).max(10).optional(),
  })
  // defaultLanguage must be one of the org's configured languages — checked
  // here (not just relying on the dashboard UI to only offer valid
  // choices) since this is the actual authorization/validation boundary;
  // only enforced when BOTH are present in the same request, since a
  // request that only changes one of them can't validate the pair.
  .refine(
    (data) => !data.languages || !data.defaultLanguage || data.languages.includes(data.defaultLanguage),
    { message: "defaultLanguage must be one of the provided languages", path: ["defaultLanguage"] }
  );

export async function GET() {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const settings = await getBusinessSettings(auth.organization.id);
  return NextResponse.json({ ok: true, settings });
}

/**
 * Deliberately admin-only: this configures what the AI is allowed to say
 * and do on the organization's behalf, so it should carry the same
 * privilege bar as connecting the Telegram bot itself. The core system
 * prompt (never-invent-prices, never-claim-unconfirmed-bookings, etc — see
 * src/lib/ai/system-prompt.ts) is NOT editable here or anywhere from the
 * dashboard; only the business-specific context fields it's built from are.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const roleError = requireAdminRole(auth.organization);
  if (roleError) return roleError;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const settings = await updateBusinessSettings(auth.organization.id, parsed.data);
  return NextResponse.json({ ok: true, settings });
}
