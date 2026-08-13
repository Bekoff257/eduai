-- ============================================================================
-- Tenant isolation test suite (pgTAP).
--
-- Run with: supabase test db   (requires local Supabase / Docker).
--
-- IMPORTANT — what this suite actually verifies as of the Firebase Auth
-- migration (supabase/migrations/20260813073010_firebase_auth_migration.sql):
-- RLS's auth.uid()-based policies are no longer the primary authorization
-- mechanism for the dashboard (identity is Firebase, verified server-side
-- in src/lib/dashboard/auth.ts; dashboard queries use the service-role
-- client, which bypasses RLS by design — same as the Telegram webhook).
-- This suite still exercises those policies as DEFENSE IN DEPTH: it
-- proves that IF something somehow issued a query as the `authenticated`
-- Postgres role with a real Supabase-Auth-shaped session, RLS would still
-- correctly isolate tenants. It is not testing the app's actual
-- authorization path anymore — that's covered by
-- scripts/test-service-tenant-isolation.mjs (organization_id filters in
-- the service layer) and the (not-yet-written) dashboard-auth-specific
-- equivalent for firebase_uid-based resolution. Both remain necessary;
-- neither replaces the other.
--
-- Strategy: simulate an authenticated request by setting request.jwt.claims
-- (which auth.uid() reads its 'sub' claim from) and switching to the
-- `authenticated` Postgres role within a transaction — this is what
-- PostgREST does per-request in production, and is the standard local way
-- to exercise RLS policies without a real signed session. Relies on
-- supabase/seed.sql having been applied first (supabase db reset runs
-- migrations + seed before this test file) — seed.sql populates
-- organization_members.user_id with fixture-only UUIDs (no FK anymore)
-- specifically so this suite keeps working; real app code never uses
-- user_id, only firebase_uid.
-- ============================================================================

begin;
select plan(22);

-- ----------------------------------------------------------------------------
-- Helper: authenticate as a given auth.users id for the rest of the
-- transaction, matching what auth.uid()/is_org_member() expect.
-- ----------------------------------------------------------------------------
create or replace function test_auth_as(uid uuid) returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$ language plpgsql;

create or replace function test_auth_none() returns void as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
end;
$$ language plpgsql;

-- Org A / Org B ids and seed user ids from supabase/seed.sql
-- Org A owner: 00000000-0000-0000-0000-0000000a0a01 (Aziza)
-- Org A staff: 00000000-0000-0000-0000-0000000a0a02 (Bekzod)
-- Org B owner: 00000000-0000-0000-0000-0000000b0b01 (Dana)
-- Org B staff: 00000000-0000-0000-0000-0000000b0b02 (Yerlan)

-- ----------------------------------------------------------------------------
-- 1-2: A user can access their own organization's data when an active member
-- ----------------------------------------------------------------------------
select test_auth_as('00000000-0000-0000-0000-0000000a0a01');

select is(
  (select count(*)::int from organizations where id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'Org A owner can see Org A'
);

select is(
  (select count(*)::int from customers where organization_id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'Org A owner can see Org A customers'
);

-- ----------------------------------------------------------------------------
-- 3-8: User A cannot read/insert/update/delete Organization B data
-- ----------------------------------------------------------------------------
select is(
  (select count(*)::int from organizations where id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'Org A owner cannot see Org B in organizations'
);

select is(
  (select count(*)::int from customers where organization_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'Org A owner cannot see Org B customers'
);

select is(
  (select count(*)::int from leads where organization_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'Org A owner cannot see Org B leads'
);

select is(
  (select count(*)::int from conversations where organization_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'Org A owner cannot see Org B conversations'
);

select is(
  (select count(*)::int from messages where organization_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'Org A owner cannot see Org B messages'
);

select throws_ok(
  $$ insert into customers (organization_id, telegram_chat_id, full_name)
     values ('00000000-0000-0000-0000-00000000000b', 9999, 'Injected Customer') $$,
  '42501',
  null,
  'Org A owner cannot insert into Org B customers (RLS with-check blocks it)'
);

-- An UPDATE blocked by RLS's USING clause does not throw — it silently
-- matches zero rows (unlike INSERT's WITH CHECK, which does throw).
select lives_ok(
  $$ update customers set full_name = 'Hacked'
     where organization_id = '00000000-0000-0000-0000-00000000000b' $$,
  'Org A owner update against Org B customers does not error...'
);

-- The read-back must happen as a role that can actually SEE Org B's row
-- (superuser bypasses RLS) — reading it back while still authenticated as
-- the Org A owner would return zero rows regardless of whether the update
-- was blocked, since Org A's own SELECT policy already hides Org B's data.
-- That would make this assertion pass even if the UPDATE had NOT been
-- blocked, so it would not actually be testing what its label claims.
reset role;
select is(
  (select full_name from customers where id = '00000000-0000-0000-0000-0000000b0021'),
  'Aliya Nurlanovna',
  '...but Org B customer name is unchanged (update matched 0 rows under RLS)'
);

select test_auth_as('00000000-0000-0000-0000-0000000a0a01');
select lives_ok(
  $$ delete from customers where organization_id = '00000000-0000-0000-0000-00000000000b' $$,
  'Org A owner delete against Org B customers does not error...'
);

reset role;
select is(
  (select count(*)::int from customers where id = '00000000-0000-0000-0000-0000000b0021'),
  1,
  '...but Org B customer still exists (delete matched 0 rows under RLS)'
);

select test_auth_as('00000000-0000-0000-0000-0000000a0a01');

-- ----------------------------------------------------------------------------
-- 9: Cross-tenant relationship exploit — cannot create an Org A lead
-- pointing at an Org B customer via the trigger guard, even though RLS
-- alone might not catch a same-org-id insert with a foreign customer_id.
-- ----------------------------------------------------------------------------
select throws_ok(
  $$ insert into leads (organization_id, customer_id, source, status)
     values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000b0021', 'telegram', 'new') $$,
  'P0001',
  'customer_id 00000000-0000-0000-0000-0000000b0021 does not belong to organization 00000000-0000-0000-0000-00000000000a',
  'Cannot link an Org A lead to an Org B customer (cross-tenant FK guard trigger)'
);

-- ----------------------------------------------------------------------------
-- 10: Unauthenticated (anon) requests see nothing
-- ----------------------------------------------------------------------------
select test_auth_none();

select is(
  (select count(*)::int from organizations),
  0,
  'Anonymous/unauthenticated requests see zero organizations'
);

select is(
  (select count(*)::int from customers),
  0,
  'Anonymous/unauthenticated requests see zero customers'
);

-- ----------------------------------------------------------------------------
-- 11: Removing a user's membership removes their access
-- ----------------------------------------------------------------------------
select test_auth_as('00000000-0000-0000-0000-0000000a0a02');

select is(
  (select count(*)::int from organizations where id = '00000000-0000-0000-0000-00000000000a'),
  1,
  'Org A staff can see Org A before membership is removed'
);

-- Deactivate (not hard-delete, to prove is_active is honored) then hard
-- delete to prove both paths revoke access. Done as postgres/service-role
-- equivalent since a member cannot deactivate themselves per the delete
-- policy's self-protection clause.
reset role;
update organization_members set is_active = false
  where organization_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000a0a02';

select test_auth_as('00000000-0000-0000-0000-0000000a0a02');

select is(
  (select count(*)::int from organizations where id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'Org A staff loses access immediately after is_active is set to false'
);

reset role;
delete from organization_members
  where organization_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000a0a02';

select test_auth_as('00000000-0000-0000-0000-0000000a0a02');

select is(
  (select count(*)::int from organizations where id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'Org A staff has no access after their membership row is deleted'
);

-- ----------------------------------------------------------------------------
-- 12: A member of Org B cannot see Org A data (symmetry check)
-- ----------------------------------------------------------------------------
select test_auth_as('00000000-0000-0000-0000-0000000b0b01');

select is(
  (select count(*)::int from organizations where id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'Org B owner cannot see Org A'
);

select is(
  (select count(*)::int from leads where organization_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'Org B owner cannot see Org A leads'
);

-- ----------------------------------------------------------------------------
-- 13: Non-admin staff cannot read the bot secret in telegram_integrations,
-- even for their own organization.
-- ----------------------------------------------------------------------------
select test_auth_as('00000000-0000-0000-0000-0000000b0b02');

select is(
  (select count(*)::int from telegram_integrations where organization_id = '00000000-0000-0000-0000-00000000000b'),
  0,
  'Org B staff (non-admin) cannot read their own org''s telegram_integrations (admin-only)'
);

select test_auth_as('00000000-0000-0000-0000-0000000b0b01');

select is(
  (select count(*)::int from telegram_integrations where organization_id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'Org B owner (admin) CAN read their own org''s telegram_integrations'
);

select * from finish();
rollback;
