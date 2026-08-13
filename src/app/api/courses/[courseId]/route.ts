import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { updateCourse, deleteCourse } from "@/lib/services/courses";

const updateCourseSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  price: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { courseId } = await params;

  const parsed = updateCourseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const course = await updateCourse(auth.organization.id, courseId, parsed.data);
  if (!course) {
    return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, course });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { courseId } = await params;

  const deleted = await deleteCourse(auth.organization.id, courseId);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
