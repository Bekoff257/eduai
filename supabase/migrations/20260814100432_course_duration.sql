-- ============================================================================
-- Adds courses.duration — a free-text learning-duration label ("3 months",
-- "8 weeks"), editable from the Dashboard course create/edit UI and surfaced
-- to the AI agent via search_courses/get_course so it can quote a course's
-- duration without inventing one. Stored as plain text rather than a
-- structured interval/date range — course listings don't have a fixed start
-- date to calculate against, and the business owner should be free to write
-- whatever's natural ("6 oy", "8 hafta"). Nullable/optional so existing
-- courses are unaffected.
-- ============================================================================

alter table courses
  add column duration text;

comment on column courses.duration is
  'Free-text learning duration label (e.g. "3 months", "8 weeks"), set from the dashboard. Optional — null means unspecified, not "no duration".';
