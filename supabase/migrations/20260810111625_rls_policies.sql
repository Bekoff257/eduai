-- ============================================================================
-- Milestone 1: Row Level Security
--
-- Identity model: Supabase Auth (native — no third-party bridge). Every
-- policy uses auth.uid(), Supabase's built-in per-request authenticated
-- user id, resolved directly from the session JWT Supabase itself issues.
-- There is no cross-project token-forgery risk to guard against here (unlike
-- a third-party IdP whose signing keys are shared across unrelated
-- projects), so there is no restrictive "trust" layer in this migration —
-- auth.uid() is trustworthy by construction for a Supabase-issued session.
--
-- service_role bypasses RLS entirely (Postgres BYPASSRLS), by design. It is
-- reserved for: migrations, seeding, Telegram webhook processing (a
-- Telegram user has no Supabase Auth identity), and background jobs
-- (follow-up scheduler). It must NEVER be used to serve a request on
-- behalf of a logged-in dashboard user — that path goes through RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: is the current user an ACTIVE member of the given organization?
-- This is the single source of truth every tenant-owned table's policies
-- call — centralizing it means there is exactly one place that defines
-- "belongs to this organization" instead of that logic being copy-pasted
-- (and potentially drifting) across 14 tables.
--
-- SECURITY DEFINER is required here, not optional: organization_members has
-- RLS enabled on itself, and organization_members' own select policy calls
-- this function. Without SECURITY DEFINER, the internal query below would
-- itself be subject to organization_members' RLS policy — which calls this
-- same function again — and Postgres raises a hard runtime error,
-- "infinite recursion detected in policy for relation organization_members".
-- SECURITY DEFINER makes this function's internal query run as its owner
-- (bypassing RLS on that one internal lookup), which is safe because the
-- function takes no free-form input that isn't already parameterized and
-- returns only a boolean — it cannot be used to exfiltrate row data.
-- ----------------------------------------------------------------------------
create or replace function is_org_member(target_org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active = true
  )
$$;

comment on function is_org_member(uuid) is
  'True if the current auth.uid() is an active member of target_org_id. The ONLY authorization check tenant-owned table policies should rely on — never trust a client-supplied organization_id by itself. SECURITY DEFINER is required to avoid recursive RLS evaluation on organization_members itself.';

revoke all on function is_org_member(uuid) from public;
grant execute on function is_org_member(uuid) to authenticated;

create or replace function is_org_admin(target_org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role in ('owner', 'admin')
  )
$$;

comment on function is_org_admin(uuid) is
  'True if the current auth.uid() is an active owner/admin of target_org_id. Used for membership management and settings writes. SECURITY DEFINER for the same recursion-avoidance reason as is_org_member.';

revoke all on function is_org_admin(uuid) from public;
grant execute on function is_org_admin(uuid) to authenticated;

-- ============================================================================
-- organizations
-- Readable/writable only by active members. Creation is intentionally NOT
-- self-service via a client insert policy — an organization must be
-- created together with its first organization_members row atomically, so
-- creation goes through a SECURITY DEFINER function (below) rather than a
-- raw insert policy that could be called without ever creating membership.
-- ============================================================================
alter table organizations enable row level security;
alter table organizations force row level security;

create policy organizations_select_member on organizations
  for select to authenticated
  using (is_org_member(id));

create policy organizations_update_admin on organizations
  for update to authenticated
  using (is_org_admin(id))
  with check (is_org_admin(id));

-- No insert/delete policy: organizations are not created via a raw client
-- insert (see create_organization_with_owner below) and not deletable via
-- the client API in the MVP (would cascade-delete all tenant data).

-- Atomic "create organization + become its owner". Runs as the function
-- owner (bypassing the lack of an insert policy on organizations) but ONLY
-- performs the three inserts below — it is not a general RLS bypass, and
-- it always makes the CALLER (not a client-supplied id) the owner.
create or replace function create_organization_with_owner(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not authenticated';
  end if;

  insert into organizations (name, slug) values (org_name, org_slug)
  returning id into new_org_id;

  insert into organization_members (organization_id, user_id, role, is_active)
  values (new_org_id, caller_id, 'owner', true);

  insert into business_settings (organization_id) values (new_org_id);

  return new_org_id;
end;
$$;

revoke all on function create_organization_with_owner(text, text) from public;
grant execute on function create_organization_with_owner(text, text) to authenticated;

-- ============================================================================
-- organization_members
-- Members can see fellow members of orgs they belong to (needed for a
-- "staff" list in the dashboard), but only admins/owners can modify
-- membership rows, and never their own role (no self-promotion/self-demotion
-- lockout prevention via the "cannot touch own row" clause below).
-- ============================================================================
alter table organization_members enable row level security;
alter table organization_members force row level security;

create policy organization_members_select_member on organization_members
  for select to authenticated
  using (is_org_member(organization_id));

create policy organization_members_insert_admin on organization_members
  for insert to authenticated
  with check (is_org_admin(organization_id));

create policy organization_members_update_admin on organization_members
  for update to authenticated
  using (is_org_admin(organization_id) and user_id <> auth.uid())
  with check (is_org_admin(organization_id));

create policy organization_members_delete_admin on organization_members
  for delete to authenticated
  using (is_org_admin(organization_id) and user_id <> auth.uid());

-- ============================================================================
-- Generic tenant-owned tables: business_settings, telegram_integrations,
-- courses, course_groups, customers, leads, conversations, messages,
-- appointments, follow_ups, ai_actions, human_takeovers, audit_logs.
--
-- Pattern: is_org_member()/is_org_admin() checks per operation.
-- telegram_integrations, audit_logs, and destructive operations additionally
-- restrict to admins.
-- ============================================================================

-- business_settings ----------------------------------------------------------
alter table business_settings enable row level security;
alter table business_settings force row level security;

create policy business_settings_select on business_settings
  for select to authenticated using (is_org_member(organization_id));

create policy business_settings_update on business_settings
  for update to authenticated
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));

-- telegram_integrations -------------------------------------------------------
alter table telegram_integrations enable row level security;
alter table telegram_integrations force row level security;

create policy telegram_integrations_select on telegram_integrations
  for select to authenticated using (is_org_admin(organization_id));

create policy telegram_integrations_insert on telegram_integrations
  for insert to authenticated with check (is_org_admin(organization_id));

create policy telegram_integrations_update on telegram_integrations
  for update to authenticated
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));

-- courses ---------------------------------------------------------------------
alter table courses enable row level security;
alter table courses force row level security;

create policy courses_select on courses
  for select to authenticated using (is_org_member(organization_id));

create policy courses_insert on courses
  for insert to authenticated with check (is_org_member(organization_id));

create policy courses_update on courses
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

create policy courses_delete on courses
  for delete to authenticated using (is_org_admin(organization_id));

-- course_groups -----------------------------------------------------------------
alter table course_groups enable row level security;
alter table course_groups force row level security;

create policy course_groups_select on course_groups
  for select to authenticated using (is_org_member(organization_id));

create policy course_groups_insert on course_groups
  for insert to authenticated with check (is_org_member(organization_id));

create policy course_groups_update on course_groups
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

create policy course_groups_delete on course_groups
  for delete to authenticated using (is_org_admin(organization_id));

-- customers ---------------------------------------------------------------------
alter table customers enable row level security;
alter table customers force row level security;

create policy customers_select on customers
  for select to authenticated using (is_org_member(organization_id));

create policy customers_insert on customers
  for insert to authenticated with check (is_org_member(organization_id));

create policy customers_update on customers
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

create policy customers_delete on customers
  for delete to authenticated using (is_org_admin(organization_id));

-- leads ---------------------------------------------------------------------------
alter table leads enable row level security;
alter table leads force row level security;

create policy leads_select on leads
  for select to authenticated using (is_org_member(organization_id));

create policy leads_insert on leads
  for insert to authenticated with check (is_org_member(organization_id));

create policy leads_update on leads
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

create policy leads_delete on leads
  for delete to authenticated using (is_org_admin(organization_id));

-- conversations ---------------------------------------------------------------------
alter table conversations enable row level security;
alter table conversations force row level security;

create policy conversations_select on conversations
  for select to authenticated using (is_org_member(organization_id));

create policy conversations_insert on conversations
  for insert to authenticated with check (is_org_member(organization_id));

create policy conversations_update on conversations
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

-- messages ---------------------------------------------------------------------
alter table messages enable row level security;
alter table messages force row level security;

create policy messages_select on messages
  for select to authenticated using (is_org_member(organization_id));

create policy messages_insert on messages
  for insert to authenticated with check (is_org_member(organization_id));

-- No update/delete policy on messages: message history is immutable once
-- written (audit integrity for the conversation record).

-- appointments ---------------------------------------------------------------------
alter table appointments enable row level security;
alter table appointments force row level security;

create policy appointments_select on appointments
  for select to authenticated using (is_org_member(organization_id));

create policy appointments_insert on appointments
  for insert to authenticated with check (is_org_member(organization_id));

create policy appointments_update on appointments
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

-- follow_ups ---------------------------------------------------------------------
alter table follow_ups enable row level security;
alter table follow_ups force row level security;

create policy follow_ups_select on follow_ups
  for select to authenticated using (is_org_member(organization_id));

create policy follow_ups_insert on follow_ups
  for insert to authenticated with check (is_org_member(organization_id));

create policy follow_ups_update on follow_ups
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

-- ai_actions ---------------------------------------------------------------------
-- Read-only from the client (dashboard "AI Activity" view). Writes only
-- ever happen from the backend via the service-role client when the agent
-- executes a tool — never from a browser insert policy.
alter table ai_actions enable row level security;
alter table ai_actions force row level security;

create policy ai_actions_select on ai_actions
  for select to authenticated using (is_org_member(organization_id));

-- human_takeovers ---------------------------------------------------------------------
alter table human_takeovers enable row level security;
alter table human_takeovers force row level security;

create policy human_takeovers_select on human_takeovers
  for select to authenticated using (is_org_member(organization_id));

create policy human_takeovers_insert on human_takeovers
  for insert to authenticated with check (is_org_member(organization_id));

create policy human_takeovers_update on human_takeovers
  for update to authenticated
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

-- audit_logs ---------------------------------------------------------------------
-- Read-only from the client, and only for org admins/owners (audit trails
-- are sensitive). Writes happen exclusively via the service-role client.
alter table audit_logs enable row level security;
alter table audit_logs force row level security;

create policy audit_logs_select on audit_logs
  for select to authenticated
  using (organization_id is not null and is_org_admin(organization_id));
