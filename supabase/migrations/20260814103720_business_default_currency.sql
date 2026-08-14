-- ============================================================================
-- Adds business_settings.default_currency — an org-wide default currency,
-- editable from the Dashboard AI Settings page. Used ONLY as (a) the
-- pre-fill default when creating a new course in the dashboard, and (b) a
-- last-resort fallback if a course's own currency is somehow unset — it is
-- NEVER substituted for a course's actual currency, which remains the sole
-- source of truth the AI uses when quoting a price (courses.currency,
-- added by 20260814100432_course_duration.sql's sibling migration —
-- courses.currency has existed since the initial schema).
--
-- Root cause this supports fixing: a production course had currency='USD'
-- because createCourse()'s only fallback was a hardcoded "USD" default with
-- no org-level configuration to draw from and no dashboard nudge toward a
-- deliberate choice — the AI faithfully reported the wrong stored value,
-- it did not invent a currency. This column, plus a dashboard currency
-- selector defaulting to it, closes that data-entry gap going forward.
-- ============================================================================

alter table business_settings
  add column default_currency text not null default 'USD';

comment on column business_settings.default_currency is
  'Org-wide default currency (ISO 4217 code, e.g. UZS, USD), set from the dashboard AI Settings page. Pre-fills new courses in the dashboard course form. Never used by the AI in place of a course''s own courses.currency — that column is always the source of truth for what currency to quote a specific course''s price in.';
