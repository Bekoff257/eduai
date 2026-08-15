import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth, requireAdminRole } from "@/lib/dashboard/api-auth";
import { createAutomation, listAutomations } from "@/lib/services/automations";
import { conditionSchema, actionStepSchema, stopConditionSchema, triggerTypeSchema } from "@/lib/automation/validation";

const createAutomationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  triggerType: triggerTypeSchema,
  conditions: z.array(conditionSchema).max(20).default([]),
  actions: z.array(actionStepSchema).min(1, "At least one action is required").max(20),
  stopConditions: z.array(stopConditionSchema).max(4).default([]),
});

export async function GET() {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const automations = await listAutomations(auth.organization.id);
  return NextResponse.json({ ok: true, automations });
}

/** Admin-only, same privilege bar as business-settings/telegram-integration
 * — an automation can send AI/templated messages and change lead/
 * conversation state on the organization's behalf. */
export async function POST(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const roleError = requireAdminRole(auth.organization);
  if (roleError) return roleError;

  const parsed = createAutomationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const automation = await createAutomation(auth.organization.id, parsed.data);
  return NextResponse.json({ ok: true, automation });
}
