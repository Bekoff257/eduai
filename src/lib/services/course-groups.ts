import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface CourseGroup {
  id: string;
  organizationId: string;
  courseId: string;
  name: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  capacity: number;
  isActive: boolean;
}

export interface CourseGroupAvailability extends CourseGroup {
  scheduledCount: number;
  availableSeats: number;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  course_id: string;
  name: string;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  capacity: number;
  is_active: boolean;
}): CourseGroup {
  return {
    id: row.id,
    organizationId: row.organization_id,
    courseId: row.course_id,
    name: row.name,
    daysOfWeek: row.days_of_week ?? [],
    startTime: row.start_time,
    endTime: row.end_time,
    capacity: row.capacity,
    isActive: row.is_active,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, course_id, name, days_of_week, start_time, end_time, capacity, is_active";

export async function searchCourseGroups(
  organizationId: string,
  courseId?: string
): Promise<CourseGroup[]> {
  const supabase = getSupabaseServiceClient();
  let builder = supabase
    .from("course_groups")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (courseId) {
    builder = builder.eq("course_id", courseId);
  }

  const { data, error } = await builder;
  if (error) throw new Error(`searchCourseGroups failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function getCourseGroup(
  organizationId: string,
  courseGroupId: string
): Promise<CourseGroup | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("course_groups")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", courseGroupId)
    .maybeSingle();

  if (error) throw new Error(`getCourseGroup failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/** Lists ALL groups for a course (including inactive) for the dashboard's
 * course management UI — unlike searchCourseGroups (used by the AI
 * agent), which only returns is_active groups. */
export async function listCourseGroups(
  organizationId: string,
  courseId?: string
): Promise<CourseGroup[]> {
  const supabase = getSupabaseServiceClient();
  let builder = supabase
    .from("course_groups")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (courseId) {
    builder = builder.eq("course_id", courseId);
  }

  const { data, error } = await builder;
  if (error) throw new Error(`listCourseGroups failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export interface CreateCourseGroupInput {
  courseId: string;
  name?: string;
  daysOfWeek?: number[];
  startTime?: string | null;
  endTime?: string | null;
  capacity: number;
}

export async function createCourseGroup(
  organizationId: string,
  input: CreateCourseGroupInput
): Promise<CourseGroup> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("course_groups")
    .insert({
      organization_id: organizationId,
      course_id: input.courseId,
      name: input.name ?? "",
      days_of_week: input.daysOfWeek ?? [],
      start_time: input.startTime ?? null,
      end_time: input.endTime ?? null,
      capacity: input.capacity,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`createCourseGroup failed: ${error.message}`);
  return mapRow(data);
}

export interface UpdateCourseGroupInput {
  name?: string;
  daysOfWeek?: number[];
  startTime?: string | null;
  endTime?: string | null;
  capacity?: number;
  isActive?: boolean;
}

export async function updateCourseGroup(
  organizationId: string,
  courseGroupId: string,
  input: UpdateCourseGroupInput
): Promise<CourseGroup | null> {
  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.daysOfWeek !== undefined) patch.days_of_week = input.daysOfWeek;
  if (input.startTime !== undefined) patch.start_time = input.startTime;
  if (input.endTime !== undefined) patch.end_time = input.endTime;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const { data, error } = await supabase
    .from("course_groups")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", courseGroupId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateCourseGroup failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/** Soft-deletes by setting is_active = false — course_groups are
 * referenced by appointments (on delete restrict), so a hard delete
 * would fail once any appointment exists for the group anyway. */
export async function deleteCourseGroup(
  organizationId: string,
  courseGroupId: string
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("course_groups")
    .update({ is_active: false })
    .eq("organization_id", organizationId)
    .eq("id", courseGroupId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`deleteCourseGroup failed: ${error.message}`);
  return data !== null;
}

/**
 * A course_group's capacity is for the group as a whole (it represents a
 * recurring cohort, e.g. "Mon/Wed/Fri 18:00"), not per individual
 * scheduled_at slot — so availability is capacity minus every currently
 * "scheduled" appointment in that group, regardless of scheduled_at.
 */
export async function getCourseGroupAvailability(
  organizationId: string,
  courseId?: string
): Promise<CourseGroupAvailability[]> {
  const groups = await searchCourseGroups(organizationId, courseId);
  if (groups.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("course_group_id")
    .eq("organization_id", organizationId)
    .eq("status", "scheduled")
    .in(
      "course_group_id",
      groups.map((g) => g.id)
    );

  if (error) throw new Error(`getCourseGroupAvailability failed: ${error.message}`);

  const countsByGroup = new Map<string, number>();
  for (const row of data ?? []) {
    countsByGroup.set(row.course_group_id, (countsByGroup.get(row.course_group_id) ?? 0) + 1);
  }

  return groups.map((group) => {
    const scheduledCount = countsByGroup.get(group.id) ?? 0;
    return {
      ...group,
      scheduledCount,
      availableSeats: Math.max(0, group.capacity - scheduledCount),
    };
  });
}
