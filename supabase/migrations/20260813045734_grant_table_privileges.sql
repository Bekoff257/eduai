-- ============================================================================
-- Milestone 1 fix: PostgreSQL table-level GRANTs for the authenticated role
--
-- Root cause: RLS policies (previous migration) control which ROWS a role
-- can see/touch, but Postgres checks table-level privileges (GRANT SELECT/
-- INSERT/UPDATE/DELETE) FIRST, before RLS is ever consulted. Enabling RLS
-- on a table does not implicitly grant any privilege on it. Without an
-- explicit GRANT, Postgres rejects the query outright with "permission
-- denied for table X" — RLS never gets a chance to run, which is why the
-- pgTAP suite failed immediately rather than exercising any policy.
--
-- These grants do NOT bypass or weaken RLS: `alter table ... force row
-- level security` (already set on every tenant table) still applies to
-- every one of these roles including the table owner, and RLS policies
-- still filter every row of every statement below. A GRANT only clears the
-- coarse "is this role allowed to attempt SELECT/INSERT/UPDATE/DELETE on
-- this table at all" check; RLS still decides which rows are visible/
-- affected. Granting a privilege for an operation with no supporting RLS
-- policy is harmless — e.g. granting UPDATE on `messages` would still
-- update zero rows for every caller, since there is no UPDATE policy on
-- that table — but to keep the grant surface matched exactly to what the
-- application is designed to do, each table below is granted only the
-- operations its existing RLS policies actually support.
--
-- Idempotent: GRANT in PostgreSQL is idempotent by nature (re-granting an
-- already-held privilege is a no-op, not an error), so this migration is
-- safe to re-run.
-- ============================================================================

grant usage on schema public to authenticated;

-- anon needs SELECT granted too, for the same table-grants-checked-before-RLS
-- reason above: the tenant-isolation test suite (and any real anonymous
-- request) must be able to run `select ... from organizations` and get an
-- RLS-filtered EMPTY result — not a permission-denied error — so that "no
-- rows visible" is actually verifying RLS, not just Postgres's coarser
-- table-privilege check. anon gets SELECT only, never
-- INSERT/UPDATE/DELETE — there is no legitimate anonymous write path.
grant usage on schema public to anon;
grant select on
  organizations, organization_members, business_settings, telegram_integrations,
  courses, course_groups, customers, leads, conversations, messages,
  appointments, follow_ups, ai_actions, human_takeovers, audit_logs
  to anon;

-- No sequence grants needed: every table's primary key is
-- `uuid default gen_random_uuid()`, not a serial/identity column, so there
-- are no sequences for authenticated to consume via nextval().

-- organizations: SELECT, UPDATE only — no client-facing INSERT/DELETE.
-- Creation goes through create_organization_with_owner() (SECURITY DEFINER,
-- already granted EXECUTE in the previous migration), and deletion is not
-- exposed to the client at all in the MVP.
grant select, update on organizations to authenticated;

-- organization_members: full CRUD, matching its select/insert/update/delete
-- policies (admin-only for insert/update/delete, self-protection clause on
-- update/delete).
grant select, insert, update, delete on organization_members to authenticated;

-- business_settings: SELECT (any member), UPDATE (admin only). No
-- INSERT/DELETE policies — one row per organization, created alongside the
-- organization by create_organization_with_owner().
grant select, update on business_settings to authenticated;

-- telegram_integrations: SELECT/INSERT/UPDATE, all admin-only. No DELETE
-- policy — disconnecting Telegram is not exposed to the client in the MVP.
grant select, insert, update on telegram_integrations to authenticated;

-- courses, course_groups, customers, leads: full CRUD (delete is admin-only
-- at the RLS layer, but the table-level grant doesn't distinguish member
-- vs admin — RLS still does).
grant select, insert, update, delete on courses to authenticated;
grant select, insert, update, delete on course_groups to authenticated;
grant select, insert, update, delete on customers to authenticated;
grant select, insert, update, delete on leads to authenticated;

-- conversations: SELECT/INSERT/UPDATE. No DELETE policy — conversations
-- are closed (status), not deleted.
grant select, insert, update on conversations to authenticated;

-- messages: SELECT/INSERT only. No UPDATE/DELETE grant — message history
-- is immutable by design (see the RLS migration's comment on this table),
-- and there is no RLS policy that would allow either operation to affect
-- any row even if granted, so omitting the grant here is belt-and-suspenders
-- consistency with that design rather than a functional difference.
grant select, insert on messages to authenticated;

-- appointments: SELECT/INSERT/UPDATE. No DELETE policy — cancellation is
-- modeled as a status update, not a row delete.
grant select, insert, update on appointments to authenticated;

-- follow_ups: SELECT/INSERT/UPDATE. No DELETE policy — cancellation is
-- modeled as a status update, not a row delete.
grant select, insert, update on follow_ups to authenticated;

-- ai_actions: SELECT only. Writes happen exclusively via the service-role
-- client when the AI agent executes a tool — never from an authenticated
-- dashboard user, so no INSERT/UPDATE/DELETE grant.
grant select on ai_actions to authenticated;

-- human_takeovers: SELECT/INSERT/UPDATE. No DELETE policy — takeover
-- history is kept, not deleted.
grant select, insert, update on human_takeovers to authenticated;

-- audit_logs: SELECT only (admin-only via RLS). Writes happen exclusively
-- via the service-role client — audit_logs must not be writable by the
-- actors it's auditing.
grant select on audit_logs to authenticated;
