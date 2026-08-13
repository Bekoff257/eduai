-- ============================================================================
-- Adds telegram_integrations.business_owner_name — split into its own
-- migration from 20260813092027_telegram_business_connections.sql because
-- that migration was already applied to hosted Supabase Cloud before this
-- column was added to the design; migrations are append-only once applied.
-- ============================================================================

alter table telegram_integrations
  add column business_owner_name text;

comment on column telegram_integrations.business_owner_name is
  'Display name of the connected business account, from the business_connection update''s user object — shown in the dashboard so the org knows which personal account is connected. Not used for authorization.';
