-- ============================================================================
-- Milestone 5 — Multilingual AI.
--
-- customers.language already existed (unused until now) as the customer's
-- persisted language preference, one value that follows the customer across
-- conversations rather than living per-conversation — a conversation is a
-- thread, not an identity, and re-detecting per-conversation would let a
-- reopened conversation silently override an explicit preference.
--
-- What was missing: any way to tell WHY customers.language holds the value
-- it does. Without that distinction, there's no way to implement "an
-- explicit request always outranks auto-detection, permanently" — the
-- system would have no way to know detection is even allowed to overwrite
-- it. customers.language_source closes that gap.
--
-- business_settings.default_language is the explicit fallback used when a
-- customer has no known language and this message's detection is
-- ambiguous — previously only an implicit "languages[0]" convention with no
-- real column backing it.
-- ============================================================================

alter table customers
  add column language_source text
    check (language_source in ('explicit', 'detected'));

comment on column customers.language_source is
  'Whether customers.language was set because the customer explicitly requested it (''explicit'' — permanent until they explicitly change it again, never overwritten by auto-detection) or inferred from message text (''detected'' — may be updated by future detection). Null means no language known yet for this customer.';

alter table business_settings
  add column default_language text not null default 'uz';

comment on column business_settings.default_language is
  'Fallback language (free-text code, e.g. uz/ru/en) used when a customer has no known language and this message''s detection is ambiguous. Not constrained to a fixed enum so a business can support additional languages later without a migration — see business_settings.languages for the full supported-languages list.';
