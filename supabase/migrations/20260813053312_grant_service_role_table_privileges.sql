-- ============================================================================
-- Milestone 2 fix: PostgreSQL table-level GRANTs for the service_role
--
-- Root cause (same class of issue as the authenticated/anon grants
-- migration from Milestone 1, just for a different role): service_role
-- bypassing RLS (Postgres BYPASSRLS-equivalent behavior enforced by
-- Supabase/PostgREST) is a separate access-control layer from ordinary
-- Postgres table-level GRANTs. Supabase's platform historically
-- auto-exposed newly created public-schema tables to service_role/
-- authenticated/anon, but this project's supabase/config.toml has
-- auto_expose_new_tables unset (defaults to false, matching Supabase's
-- current/upcoming default — see the commented-out line in
-- supabase/config.toml), so local Postgres never received these grants.
-- Without them, service_role gets "permission denied for table X" before
-- RLS is ever consulted (RLS is irrelevant here anyway, since service_role
-- bypasses it — this is purely the coarse table-reachability check).
--
-- This was discovered when Milestone 2's Telegram webhook code (which
-- uses the service-role client exclusively, per architecture — a Telegram
-- user has no Supabase Auth session for RLS to key off) failed with this
-- exact error against a real local Supabase instance.
--
-- service_role gets full CRUD on every tenant table — this does not
-- weaken tenant isolation, since service_role already has unconditional
-- access by design (that is the entire point of the service-role key; see
-- docs/architecture.md's "Where the service-role key is allowed to bypass
-- RLS" section). Tenant isolation for code paths using this client is
-- enforced by the service layer's own organization_id filters
-- (src/lib/services/*.ts), not by anything at the database privilege
-- layer — this migration does not change that.
--
-- Idempotent: GRANT is idempotent by nature, safe to re-run.
-- ============================================================================

grant usage on schema public to service_role;

grant select, insert, update, delete on
  organizations, organization_members, business_settings, telegram_integrations,
  courses, course_groups, customers, leads, conversations, messages,
  appointments, follow_ups, ai_actions, human_takeovers, audit_logs
  to service_role;

-- No sequence grants needed: every table's primary key is
-- `uuid default gen_random_uuid()`, not a serial/identity column.

-- auth.users is queried indirectly via foreign keys but never written by
-- application code (Supabase Auth owns that table) — no grant needed here.
