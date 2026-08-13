import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getCourseGroupAvailability } from "@/lib/services/course-groups";

export interface Appointment {
  id: string;
  organizationId: string;
  customerId: string;
  leadId: string | null;
  courseGroupId: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  scheduledAt: string;
  notes: string | null;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  customer_id: string;
  lead_id: string | null;
  course_group_id: string;
  status: Appointment["status"];
  scheduled_at: string;
  notes: string | null;
}): Appointment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    leadId: row.lead_id,
    courseGroupId: row.course_group_id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    notes: row.notes,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, customer_id, lead_id, course_group_id, status, scheduled_at, notes";

export interface AppointmentListItem extends Appointment {
  customerName: string | null;
  courseGroupName: string;
  courseName: string;
}

/** Lists appointments for the dashboard's Appointments page, joined with
 * customer name and course/group name for display, filterable by a
 * scheduled_at range and/or status. Ordered soonest-first. */
export async function listAppointments(
  organizationId: string,
  options: {
    from?: string;
    to?: string;
    status?: Appointment["status"];
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{ appointments: AppointmentListItem[]; totalCount: number }> {
  const supabase = getSupabaseServiceClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let builder = supabase
    .from("appointments")
    .select(
      `${SELECT_COLUMNS}, customers(full_name, telegram_username), course_groups(name, courses(name))`,
      { count: "exact" }
    )
    .eq("organization_id", organizationId);

  if (options.status) builder = builder.eq("status", options.status);
  if (options.from) builder = builder.gte("scheduled_at", options.from);
  if (options.to) builder = builder.lte("scheduled_at", options.to);

  const { data, error, count } = await builder
    .order("scheduled_at", { ascending: true })
    .range(from, to);

  if (error) throw new Error(`listAppointments failed: ${error.message}`);

  const appointments = (data ?? []).map((row) => {
    type CustomerRef = { full_name: string | null; telegram_username: string | null };
    type GroupRef = { name: string; courses: { name: string } | { name: string }[] | null };
    const customer = row.customers as unknown as CustomerRef | CustomerRef[] | null;
    const group = row.course_groups as unknown as GroupRef | GroupRef[] | null;
    const c = Array.isArray(customer) ? customer[0] : customer;
    const g = Array.isArray(group) ? group[0] : group;
    const course = g ? (Array.isArray(g.courses) ? g.courses[0] : g.courses) : null;

    return {
      ...mapRow(row),
      customerName: c?.full_name ?? (c?.telegram_username ? `@${c.telegram_username}` : null),
      courseGroupName: g?.name ?? "",
      courseName: course?.name ?? "",
    };
  });

  return { appointments, totalCount: count ?? 0 };
}

export async function listAppointmentsForCustomer(
  organizationId: string,
  customerId: string
): Promise<Appointment[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("scheduled_at", { ascending: false });

  if (error) throw new Error(`listAppointmentsForCustomer failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function updateAppointmentStatus(
  organizationId: string,
  appointmentId: string,
  status: Appointment["status"]
): Promise<Appointment | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("organization_id", organizationId)
    .eq("id", appointmentId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateAppointmentStatus failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function checkAvailableAppointments(
  organizationId: string,
  courseId?: string
) {
  return getCourseGroupAvailability(organizationId, courseId);
}

export type CreateAppointmentResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; reason: "group_not_found" | "group_full" | "already_booked" };

interface BookAppointmentAtomicRow {
  ok: boolean;
  reason: "group_not_found" | "group_full" | "already_booked" | null;
  appointment_id: string | null;
  scheduled_at: string | null;
}

/**
 * Capacity-aware, race-safe booking via the book_appointment_atomic()
 * Postgres function (see supabase/migrations/20260813062432_atomic_appointment_booking.sql).
 *
 * Prior to Milestone 2.75 this did a SELECT to count existing 'scheduled'
 * appointments against course_groups.capacity, then a separate INSERT —
 * two concurrent bookings into the SAME group could both pass the SELECT
 * (each unaware of the other's uncommitted insert) and both succeed,
 * overbooking by one seat. That check-then-act race is why this is now a
 * single RPC call: the Postgres function performs the capacity check and
 * the insert inside one transaction while holding a row lock on the
 * target course_groups row, so a concurrent booking for the SAME group
 * blocks until the first transaction commits, then re-counts and correctly
 * sees the seat is taken. Bookings into DIFFERENT groups never block each
 * other — only the specific group being booked into is locked.
 *
 * Same-customer double-booking the same group/slot is still enforced by
 * uq_appointments_customer_group_slot (unchanged, already race-safe via
 * its own unique index) — surfaced here as the 'already_booked' reason.
 */
export async function createAppointment(
  organizationId: string,
  input: {
    customerId: string;
    courseGroupId: string;
    scheduledAt: string;
    leadId?: string;
    notes?: string;
  }
): Promise<CreateAppointmentResult> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .rpc("book_appointment_atomic", {
      p_organization_id: organizationId,
      p_customer_id: input.customerId,
      p_course_group_id: input.courseGroupId,
      p_scheduled_at: input.scheduledAt,
      p_lead_id: input.leadId ?? null,
      p_notes: input.notes ?? null,
    })
    .single<BookAppointmentAtomicRow>();

  if (error) {
    throw new Error(`createAppointment (book_appointment_atomic) failed: ${error.message}`);
  }

  if (!data.ok) {
    return { ok: false, reason: data.reason ?? "group_not_found" };
  }

  const { data: appointmentRow, error: fetchError } = await supabase
    .from("appointments")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", data.appointment_id!)
    .single();

  if (fetchError) {
    throw new Error(`createAppointment: booked but failed to fetch the new row: ${fetchError.message}`);
  }

  return { ok: true, appointment: mapRow(appointmentRow) };
}
