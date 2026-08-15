import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth, requireAdminRole } from "@/lib/dashboard/api-auth";
import { getAutomation, updateAutomation, archiveAutomation } from "@/lib/services/automations";
import { conditionSchema, actionStepSchema, stopConditionSchema, triggerTypeSchema } from "@/lib/automation/validation";

const updateAutomationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  triggerType: triggerTypeSchema.optional(),
  conditions: z.array(conditionSchema).max(20).optional(),
  actions: z.array(actionStepSchema).min(1).max(20).optional(),
  stopConditions: z.array(stopConditionSchema).max(4).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ automationId: string }> }) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { automationId } = await params;

  const automation = await getAutomation(auth.organization.id, automationId);
  if (!automation) return NextResponse.json({ ok: false, error: "Automation not found" }, { status: 404 });
  return NextResponse.json({ ok: true, automation });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ automationId: string }> }) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const roleError = requireAdminRole(auth.organization);
  if (roleError) return roleError;

  const { automationId } = await params;
  const parsed = updateAutomationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const automation = await updateAutomation(auth.organization.id, automationId, parsed.data);
  if (!automation) return NextResponse.json({ ok: false, error: "Automation not found" }, { status: 404 });
  return NextResponse.json({ ok: true, automation });
}

/** Archives (soft-deletes) rather than hard-deleting — matches this
 * schema's existing convention (courses, course_groups) and preserves the
 * automation_runs history for observability even after the automation
 * itself is retired. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ automationId: string }> }) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const roleError = requireAdminRole(auth.organization);
  if (roleError) return roleError;

  const { automationId } = await params;
  const archived = await archiveAutomation(auth.organization.id, automationId);
  if (!archived) return NextResponse.json({ ok: false, error: "Automation not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
