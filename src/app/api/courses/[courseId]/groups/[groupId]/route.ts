import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { updateCourseGroup, deleteCourseGroup } from "@/lib/services/course-groups";

const updateGroupSchema = z.object({
  name: z.string().trim().max(200).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  capacity: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string; groupId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { groupId } = await params;

  const parsed = updateGroupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const group = await updateCourseGroup(auth.organization.id, groupId, parsed.data);
  if (!group) {
    return NextResponse.json({ ok: false, error: "Group not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, group });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string; groupId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { groupId } = await params;

  const deleted = await deleteCourseGroup(auth.organization.id, groupId);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "Group not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
