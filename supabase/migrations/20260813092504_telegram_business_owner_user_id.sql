-- ============================================================================
-- Adds telegram_integrations.business_owner_user_id — the connected
-- business account's own Telegram user id (from business_connection.user.id).
--
-- Needed to distinguish, in an incoming business_message, "a customer
-- messaged the owner" from "the owner replied manually in their own
-- Telegram app" (both arrive as business_message updates on the same
-- chat). message.from.id equal to this column means the owner sent it
-- themselves — used to auto-detect manual takeover, since Telegram
-- provides no explicit "human took over" event for business connections.
-- ============================================================================

alter table telegram_integrations
  add column business_owner_user_id bigint;

comment on column telegram_integrations.business_owner_user_id is
  'The connected business account''s own Telegram user id (business_connection.user.id). A business_message with from.id equal to this value was sent BY THE OWNER, not a customer — used to detect manual human takeover (no sender_business_bot on the owner''s own outgoing messages).';
