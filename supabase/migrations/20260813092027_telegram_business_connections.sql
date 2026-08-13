-- ============================================================================
-- Telegram Business Bot Connections support.
--
-- Product requirement change: customers must message the business owner's
-- OWN Telegram account, not a separate bot. Telegram's officially sanctioned
-- mechanism for this is "Business Bot Connections" (core.telegram.org/api/
-- business, core.telegram.org/api/bots/connected-business-bots): the
-- business owner enables Telegram Business -> Chatbots on their personal
-- account and connects our existing bot to it. Once connected, DMs to the
-- owner's real account arrive at our bot as business_message updates (via
-- the SAME webhook/bot-token infrastructure already in place), and replies
-- sent with business_connection_id look, to the customer, exactly like the
-- owner typed them — no "via bot" label, no separate bot identity visible.
--
-- This does NOT replace the bot/webhook architecture — it extends it. The
-- bot itself, its token, and its webhook_token/webhook_secret remain in use
-- exactly as before (this is still how updates are delivered). What's new
-- is a second way a chat can resolve to an organization: via a connected
-- business account, in addition to (or instead of) customers messaging the
-- bot directly.
--
-- An MTProto user-account ("userbot") approach was evaluated and rejected:
-- it requires automating a real personal Telegram account, which Telegram's
-- API Terms of Service and current abuse-detection behavior treat as a
-- bannable pattern, and its natural client library (GramJS) is unmaintained
-- as of this migration. Business Bot Connections achieves the same product
-- outcome through Telegram's own sanctioned, free mechanism.
-- ============================================================================

alter table telegram_integrations
  add column business_connection_id text,
  add column business_connection_enabled boolean not null default false,
  add column business_connection_rights jsonb not null default '{}';

comment on column telegram_integrations.business_connection_id is
  'Set once the business owner connects this bot via Telegram Business -> Chatbots on their own account (Settings on their end, not ours). Null until connected. Populated/updated from business_connection webhook updates — never client-supplied.';
comment on column telegram_integrations.business_connection_enabled is
  'Mirrors the is_enabled flag on the most recent business_connection update — false if the owner disconnected or paused the bot from their Telegram client.';
comment on column telegram_integrations.business_connection_rights is
  'Raw BusinessBotRights the owner granted (e.g. {"reply": true, "read_messages": true}), stored for reference/future permission checks — not currently enforced beyond what Telegram itself already enforces server-side (a reply call without the reply right simply fails at Telegram''s API).';

-- One business connection id maps to exactly one organization, same as
-- webhook_token today. Partial index since most rows will have this null
-- until the owner actually connects (a bot can exist and receive direct
-- messages without ever being business-connected).
create unique index uq_telegram_integrations_business_connection_id
  on telegram_integrations (business_connection_id)
  where business_connection_id is not null;
