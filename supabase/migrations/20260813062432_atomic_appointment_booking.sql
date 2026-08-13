-- ============================================================================
-- Milestone 2.75: Atomic, race-safe appointment booking
--
-- Problem (flagged explicitly in Milestone 2, src/lib/services/appointments.ts):
-- the previous createAppointment() did a SELECT to count existing
-- 'scheduled' appointments against course_groups.capacity, then a separate
-- INSERT. Two concurrent bookings for the SAME group could both pass the
-- SELECT (neither sees the other's not-yet-committed insert) and both
-- succeed, overbooking the group by one seat in the worst case. This is a
-- classic check-then-act race — no amount of application-level care fixes
-- it without the database participating, since the check and the act are
-- two separate statements/round-trips that can interleave with another
-- transaction's check and act.
--
-- Fix: book_appointment_atomic(), a SECURITY DEFINER function that performs
-- the capacity check AND the insert inside ONE transaction, with the
-- course_groups row locked (SELECT ... FOR UPDATE) for the duration. Postgres
-- guarantees that a second concurrent transaction's FOR UPDATE on the same
-- row BLOCKS until the first transaction commits or rolls back — so the
-- second transaction's capacity count is only ever computed after the
-- first transaction's insert (if any) is already visible. This makes
-- "successful bookings <= capacity" a real invariant, not a best-effort
-- check, for concurrent bookings into the SAME course_group. Bookings into
-- DIFFERENT course_groups do not block each other — only the specific
-- group's row is locked, not the whole table.
--
-- SECURITY DEFINER is required here (not just convenient) for the same
-- reason it's used elsewhere in this schema (see is_org_member() in the
-- RLS migration): this function is called via supabase-js .rpc() using the
-- service-role client, which already has full table privileges (see the
-- grants migrations), so SECURITY DEFINER doesn't grant this function any
-- privilege it wouldn't have anyway when called by service_role — it's
-- used here for a locked, well-defined transaction boundary, not to
-- escalate privilege.
-- ============================================================================

create type book_appointment_result as (
  ok boolean,
  reason text,
  appointment_id uuid,
  scheduled_at timestamptz
);

create or replace function book_appointment_atomic(
  p_organization_id uuid,
  p_customer_id uuid,
  p_course_group_id uuid,
  p_scheduled_at timestamptz,
  p_lead_id uuid,
  p_notes text
) returns book_appointment_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_is_active boolean;
  v_scheduled_count integer;
  v_new_appointment_id uuid;
begin
  -- Lock the course_group row for the duration of this transaction. Scoped
  -- to organization_id too, so a group_id belonging to a different
  -- organization (which should never happen from the service layer, since
  -- it always passes both, but this function must not trust its caller
  -- blindly) correctly falls through to "not found" below rather than
  -- locking/reading a row this organization doesn't own.
  select capacity, is_active
    into v_capacity, v_is_active
    from course_groups
    where id = p_course_group_id
      and organization_id = p_organization_id
    for update;

  if not found or not v_is_active then
    return row(false, 'group_not_found', null, null)::book_appointment_result;
  end if;

  -- Recount NOW, while holding the lock above — this is what makes the
  -- count race-safe. Any other transaction attempting to book into this
  -- same course_group_id is blocked on the FOR UPDATE above until this
  -- transaction commits or rolls back, so this count can never be stale
  -- relative to a concurrent booking for the same group.
  select count(*)
    into v_scheduled_count
    from appointments
    where course_group_id = p_course_group_id
      and organization_id = p_organization_id
      and status = 'scheduled';

  if v_scheduled_count >= v_capacity then
    return row(false, 'group_full', null, null)::book_appointment_result;
  end if;

  begin
    insert into appointments (
      organization_id, customer_id, lead_id, course_group_id, scheduled_at, notes
    ) values (
      p_organization_id, p_customer_id, p_lead_id, p_course_group_id, p_scheduled_at, p_notes
    )
    returning id into v_new_appointment_id;
  exception
    -- 23505 = unique_violation, from uq_appointments_customer_group_slot
    -- (same customer double-booking the same group+slot). Pre-existing
    -- behavior, preserved: this is a distinct, deterministic failure mode
    -- from group_full and is reported separately.
    when unique_violation then
      return row(false, 'already_booked', null, null)::book_appointment_result;
  end;

  return row(true, null, v_new_appointment_id, p_scheduled_at)::book_appointment_result;
end;
$$;

comment on function book_appointment_atomic(uuid, uuid, uuid, timestamptz, uuid, text) is
  'Atomic capacity-checked appointment booking. Locks the target course_groups row (FOR UPDATE) so concurrent bookings into the SAME group serialize and cannot together exceed capacity; different groups do not block each other. Returns a (ok, reason, appointment_id, scheduled_at) row instead of raising for expected failure modes (group_not_found/group_full/already_booked), matching the existing CreateAppointmentResult contract in src/lib/services/appointments.ts.';

revoke all on function book_appointment_atomic(uuid, uuid, uuid, timestamptz, uuid, text) from public;
grant execute on function book_appointment_atomic(uuid, uuid, uuid, timestamptz, uuid, text) to service_role;
