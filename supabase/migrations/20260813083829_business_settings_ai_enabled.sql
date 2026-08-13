-- ============================================================================
-- Adds business_settings.ai_enabled — an org-level kill switch for the AI
-- agent, exposed on the dashboard's AI Settings page (Milestone 3). When
-- false, the Telegram webhook stores inbound messages but never invokes
-- runAgent(), identically to conversations.mode = 'human' — the two
-- checks are independent (a business owner can pause the AI for the whole
-- organization without touching every individual conversation's mode).
-- ============================================================================

alter table business_settings
  add column ai_enabled boolean not null default true;

comment on column business_settings.ai_enabled is
  'Organization-wide AI on/off switch, set from the dashboard AI Settings page. When false, the Telegram webhook stores messages but never invokes the AI agent, regardless of any individual conversation''s mode.';
