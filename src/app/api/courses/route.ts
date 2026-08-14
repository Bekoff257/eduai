import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgApiAuth } from "@/lib/dashboard/api-auth";
import { listCourses, createCourse } from "@/lib/services/courses";

const createCourseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).optional(),
  price: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  duration: z.string().trim().max(100).nullable().optional(),
});

export async function GET() {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const courses = await listCourses(auth.organization.id);
  return NextResponse.json({ ok: true, courses });
}

export async function POST(request: NextRequest) {
  const auth = await requireOrgApiAuth();
  if (!auth.ok) return auth.response;

  const parsed = createCourseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const course = await createCourse(auth.organization.id, parsed.data);
  return NextResponse.json({ ok: true, course });
}
