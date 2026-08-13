-- ============================================================================
-- Auth architecture change: Firebase Authentication replaces Supabase Auth
-- as the identity provider for dashboard users.
--
-- WHY: Bridging Firebase Auth into Supabase RLS (so auth.uid() resolves a
-- Firebase-issued session) requires Supabase's Third-Party Auth feature,
-- which in turn requires Firebase to be upgraded to Identity Platform plus
-- deployed blocking Cloud Functions (to stamp a "role: authenticated"
-- custom claim Supabase needs to resolve the Postgres role at all). That
-- infrastructure was explicitly rejected. Instead: Firebase issues and
-- verifies identity; Next.js server code verifies the Firebase ID token
-- (firebase-admin) and resolves organization membership itself; dashboard
-- Supabase access goes through the service-role client, explicitly scoped
-- to the verified organization_id — the exact same pattern already used,
-- tested, and proven for the Telegram webhook (a Telegram user likewise
-- has no Supabase Auth session for RLS to key off).
--
-- organization_members.user_id was a hard FK to auth.users(id) — Supabase
-- Auth's own table. Nobody will ever sign in via Supabase Auth again, so
-- auth.users stays permanently empty and that FK is now meaningless (a
-- Firebase UID is an opaque string, not a Supabase auth.users uuid).
-- Replaced with a plain firebase_uid text column, no FK (Supabase has no
-- table of Firebase users to reference).
--
-- RLS is NOT removed and NOT weakened — every existing policy and helper
-- function (is_org_member(), is_org_admin(), etc.) is left exactly as-is.
-- They still enable/force RLS on every table and still require the
-- `authenticated` Postgres role and a valid auth.uid(). Since the
-- dashboard now exclusively uses service_role (which bypasses RLS by
-- design, same as the webhook), these policies simply have no path to
-- ever be exercised by the dashboard — they remain in place as inert
-- defense-in-depth (a bug that somehow issued a query as `authenticated`
-- without a real Supabase Auth session still can't see anything, since
-- auth.uid() would be null). Authorization for the dashboard is enforced
-- in the Next.js application layer instead: see src/lib/dashboard/auth.ts
-- — every dashboard Supabase query is preceded by a verified Firebase
-- token + an explicit organization_members.firebase_uid membership check,
-- executed server-side, before any Supabase call is made.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- organization_members: drop the auth.users FK, add firebase_uid.
-- ----------------------------------------------------------------------------
alter table organization_members
  drop constraint organization_members_user_id_fkey;

alter table organization_members
  add column firebase_uid text;

alter table organization_members
  drop constraint organization_members_organization_id_user_id_key;

-- user_id is kept (nullable) rather than dropped outright: it is
-- referenced by is_org_member()/is_org_admin()/RLS policies below (kept
-- intentionally, see header) and dropping it would require touching every
-- one of those in this same migration for no operational benefit — it
-- will simply never be populated by any code path going forward. A future
-- cleanup migration can drop it once the defense-in-depth RLS layer is
-- reworked, if ever.
alter table organization_members
  alter column user_id drop not null;

-- NOT NULL is added directly (not via a separate backfill step) because
-- this migration is written for the actual current state of every
-- environment it will run against: the hosted Supabase Cloud project's
-- organization_members table is empty (verified directly via its REST API
-- before writing this migration — no Supabase-Auth signups have ever
-- completed there), and local/CI environments reset from migrations +
-- supabase/seed.sql, which is updated in this same change to seed
-- firebase_uid directly. If this table ever holds real Supabase-Auth-era
-- rows when this runs, this statement will correctly fail loudly (NOT NULL
-- violation) rather than silently null out a column applications will
-- immediately depend on — that failure is the correct outcome, since
-- those rows would need real Firebase account backfill, not a default.
alter table organization_members
  alter column firebase_uid set not null;

create unique index uq_organization_members_org_firebase_uid
  on organization_members (organization_id, firebase_uid);

create index idx_organization_members_firebase_uid on organization_members (firebase_uid);

comment on column organization_members.firebase_uid is 'Firebase Authentication uid. The real identity/membership join key as of the Firebase Auth migration — see this migration''s header comment. Verified server-side via firebase-admin before any Supabase query, never trusted from the browser.';
comment on column organization_members.user_id is 'Dead column, kept only because RLS policies/helper functions still reference it as defense-in-depth scaffolding. Never populated going forward — see this migration''s header comment.';

-- ----------------------------------------------------------------------------
-- audit_logs: same treatment for actor_user_id -> add actor_firebase_uid.
-- ----------------------------------------------------------------------------
alter table audit_logs
  drop constraint audit_logs_actor_user_id_fkey;

alter table audit_logs
  add column actor_firebase_uid text;

comment on column audit_logs.actor_firebase_uid is 'Firebase Authentication uid of the acting dashboard user, when the actor is a user (actor_type = ''user''). Replaces actor_user_id (auth.users FK, now dead — see organization_members.user_id''s comment for why).';

-- ----------------------------------------------------------------------------
-- create_organization_with_owner(): previously read auth.uid() (a Supabase
-- Auth session, which no longer exists for the dashboard). Now takes the
-- caller's VERIFIED Firebase uid as an explicit parameter instead. This
-- function is SECURITY DEFINER and has no policy gate of its own beyond
-- its GRANT — it is only ever safe to call from trusted server code that
-- has ALREADY verified the Firebase ID token server-side (see
-- src/lib/dashboard/auth.ts) and is invoked via the service-role client,
-- never exposed to the browser directly.
-- ----------------------------------------------------------------------------
create or replace function create_organization_with_owner(org_name text, org_slug text, owner_firebase_uid text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  if owner_firebase_uid is null or length(trim(owner_firebase_uid)) = 0 then
    raise exception 'owner_firebase_uid is required';
  end if;

  insert into organizations (name, slug) values (org_name, org_slug)
  returning id into new_org_id;

  insert into organization_members (organization_id, firebase_uid, role, is_active)
  values (new_org_id, owner_firebase_uid, 'owner', true);

  insert into business_settings (organization_id) values (new_org_id);

  return new_org_id;
end;
$$;

-- Old two-argument signature is superseded — drop it so nothing can call
-- the auth.uid()-based version by mistake (it would always raise "not
-- authenticated" now anyway, since no dashboard request holds a Supabase
-- Auth session, but removing it makes the intent unambiguous).
drop function if exists create_organization_with_owner(text, text);

-- Only service_role calls this now (from trusted, already-token-verified
-- Next.js server code) — not authenticated, since there is no more
-- Supabase-Auth-authenticated browser session for the dashboard.
revoke all on function create_organization_with_owner(text, text, text) from public;
grant execute on function create_organization_with_owner(text, text, text) to service_role;
