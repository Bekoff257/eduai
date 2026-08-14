import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface Course {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  /** Free-text learning duration label (e.g. "3 months", "8 weeks"), set
   * from the dashboard. Null means unspecified, not "no duration" — the AI
   * must not infer or invent a duration when this is null. */
  duration: string | null;
  isActive: boolean;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  price: string | number | null;
  currency: string;
  duration: string | null;
  is_active: boolean;
}): Course {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    price: row.price === null ? null : Number(row.price),
    currency: row.currency,
    duration: row.duration,
    isActive: row.is_active,
  };
}

const SELECT_COLUMNS = "id, organization_id, name, description, price, currency, duration, is_active";

export async function searchCourses(
  organizationId: string,
  query?: string,
  limit = 10
): Promise<Course[]> {
  const supabase = getSupabaseServiceClient();
  let builder = supabase
    .from("courses")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (query && query.trim().length > 0) {
    builder = builder.ilike("name", `%${query.trim()}%`);
  }

  const { data, error } = await builder.limit(limit);
  if (error) throw new Error(`searchCourses failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function getCourse(
  organizationId: string,
  courseId: string
): Promise<Course | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("courses")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", courseId)
    .maybeSingle();

  if (error) throw new Error(`getCourse failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/** Lists ALL courses for the dashboard's course management page — unlike
 * searchCourses (used by the AI agent), this includes inactive courses so
 * staff can find and re-activate them. */
export async function listCourses(organizationId: string): Promise<Course[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("courses")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) throw new Error(`listCourses failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export interface CreateCourseInput {
  name: string;
  description?: string;
  price?: number | null;
  currency?: string;
  duration?: string | null;
}

export async function createCourse(
  organizationId: string,
  input: CreateCourseInput
): Promise<Course> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      organization_id: organizationId,
      name: input.name,
      description: input.description ?? "",
      price: input.price ?? null,
      currency: input.currency ?? "USD",
      duration: input.duration ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`createCourse failed: ${error.message}`);
  return mapRow(data);
}

export interface UpdateCourseInput {
  name?: string;
  description?: string;
  price?: number | null;
  currency?: string;
  duration?: string | null;
  isActive?: boolean;
}

export async function updateCourse(
  organizationId: string,
  courseId: string,
  input: UpdateCourseInput
): Promise<Course | null> {
  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.price !== undefined) patch.price = input.price;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.duration !== undefined) patch.duration = input.duration;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const { data, error } = await supabase
    .from("courses")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", courseId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateCourse failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/** Soft-deletes by setting is_active = false, matching this schema's
 * existing convention (course_groups.is_active) rather than hard-deleting
 * — course_groups reference course_id, so a hard delete would either
 * cascade-orphan groups/appointments or be blocked by referential
 * integrity depending on future FK choices. Hard delete is intentionally
 * not offered here. */
export async function deleteCourse(organizationId: string, courseId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("courses")
    .update({ is_active: false })
    .eq("organization_id", organizationId)
    .eq("id", courseId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`deleteCourse failed: ${error.message}`);
  return data !== null;
}
