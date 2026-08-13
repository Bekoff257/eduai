import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listCourseGroups, createCourseGroup } from "@/lib/services/course-groups";
import { getCourse } from "@/lib/services/courses";

const createGroupSchema = z.object({
  name: z.string().trim().max(200).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  capacity: z.number().int().min(0),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { courseId } = await params;

  const groups = await listCourseGroups(auth.organization.id, courseId);
  return NextResponse.json({ ok: true, groups });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;
  const { courseId } = await params;

  // Verify the course actually belongs to this organization before
  // creating a group under it — otherwise a caller could pass any UUID as
  // courseId and create a group cross-linked to another org's course.
  const course = await getCourse(auth.organization.id, courseId);
  if (!course) {
    return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
  }

  const parsed = createGroupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const group = await createCourseGroup(auth.organization.id, { courseId, ...parsed.data });
  return NextResponse.json({ ok: true, group });
}
