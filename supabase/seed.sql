-- ============================================================================
-- Development/demo seed data.
--
-- Two organizations with separate members, courses, groups, customers, and
-- leads — used both for local development and as fixtures for the
-- tenant-isolation test suite (supabase/tests/tenant_isolation_test.sql).
--
-- Identity is Firebase Authentication (see docs/architecture.md) —
-- organization_members.firebase_uid is a plain text column, no FK (Supabase
-- holds no table of Firebase users). These fixture uids are fake/deterministic
-- and do not correspond to real Firebase accounts; they exist only so the
-- app's real server-side authorization logic (src/lib/dashboard/auth.ts)
-- has known organization_members rows to check against in tests.
--
-- organization_members.user_id is ALSO populated here with arbitrary,
-- fixture-only UUIDs (no FK — see the migration that dropped it) purely so
-- supabase/tests/tenant_isolation_test.sql can keep exercising RLS's
-- auth.uid()-based policies as defense-in-depth. Real application code
-- never reads or writes user_id — only firebase_uid.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Organization A: "Bright Path Academy"
-- ----------------------------------------------------------------------------
insert into organizations (id, name, slug) values
  ('00000000-0000-0000-0000-00000000000a', 'Bright Path Academy', 'bright-path-academy');

insert into business_settings (organization_id, business_name, description, timezone, languages) values
  ('00000000-0000-0000-0000-00000000000a', 'Bright Path Academy', 'IELTS and general English courses.', 'Asia/Tashkent', array['en', 'uz']);

insert into organization_members (organization_id, user_id, firebase_uid, role, display_name, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0a01', 'fb-uid-org-a-owner', 'owner', 'Aziza Karimova', 'aziza@brightpath.example'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0a02', 'fb-uid-org-a-staff', 'staff', 'Bekzod Yusupov', 'bekzod@brightpath.example');

insert into telegram_integrations (organization_id, bot_token, bot_username, webhook_secret) values
  ('00000000-0000-0000-0000-00000000000a', 'fake-bot-token-org-a', 'brightpath_bot', 'fake-webhook-secret-org-a');

insert into courses (id, organization_id, name, description, price, currency) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000000a', 'IELTS Preparation', 'Intensive IELTS prep course.', 450000, 'UZS'),
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-00000000000a', 'General English', 'Conversational English for adults.', 350000, 'UZS');

insert into course_groups (id, organization_id, course_id, name, days_of_week, start_time, end_time, capacity) values
  ('00000000-0000-0000-0000-0000000a0011', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0001', 'IELTS Mon/Wed/Fri 18:00', array[1, 3, 5], '18:00', '19:30', 15);

insert into customers (id, organization_id, telegram_chat_id, telegram_username, full_name, language) values
  ('00000000-0000-0000-0000-0000000a0021', '00000000-0000-0000-0000-00000000000a', 1001, 'aziz_customer', 'Aziz Rahimov', 'uz');

insert into leads (id, organization_id, customer_id, course_id, source, status) values
  ('00000000-0000-0000-0000-0000000a0031', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0021', '00000000-0000-0000-0000-0000000a0001', 'telegram', 'new');

insert into conversations (id, organization_id, customer_id, mode, status) values
  ('00000000-0000-0000-0000-0000000a0041', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0021', 'ai', 'open');

insert into messages (organization_id, conversation_id, sender, content) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000a0041', 'customer', 'Hi, how much is the IELTS course?');

-- ----------------------------------------------------------------------------
-- Organization B: "Nova Learning Center"
-- ----------------------------------------------------------------------------
insert into organizations (id, name, slug) values
  ('00000000-0000-0000-0000-00000000000b', 'Nova Learning Center', 'nova-learning-center');

insert into business_settings (organization_id, business_name, description, timezone, languages) values
  ('00000000-0000-0000-0000-00000000000b', 'Nova Learning Center', 'Math and science tutoring.', 'Asia/Almaty', array['en', 'ru']);

insert into organization_members (organization_id, user_id, firebase_uid, role, display_name, email) values
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0b01', 'fb-uid-org-b-owner', 'owner', 'Dana Ospanova', 'dana@nova.example'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0b02', 'fb-uid-org-b-staff', 'staff', 'Yerlan Bekov', 'yerlan@nova.example');

insert into telegram_integrations (organization_id, bot_token, bot_username, webhook_secret) values
  ('00000000-0000-0000-0000-00000000000b', 'fake-bot-token-org-b', 'nova_learning_bot', 'fake-webhook-secret-org-b');

insert into courses (id, organization_id, name, description, price, currency) values
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-00000000000b', 'Algebra Fundamentals', 'Grade 8-10 algebra.', 300000, 'KZT');

insert into course_groups (id, organization_id, course_id, name, days_of_week, start_time, end_time, capacity) values
  ('00000000-0000-0000-0000-0000000b0011', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0001', 'Algebra Tue/Thu 16:00', array[2, 4], '16:00', '17:30', 12);

insert into customers (id, organization_id, telegram_chat_id, telegram_username, full_name, language) values
  ('00000000-0000-0000-0000-0000000b0021', '00000000-0000-0000-0000-00000000000b', 2001, 'nova_customer', 'Aliya Nurlanovna', 'ru');

insert into leads (id, organization_id, customer_id, course_id, source, status) values
  ('00000000-0000-0000-0000-0000000b0031', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0021', '00000000-0000-0000-0000-0000000b0001', 'telegram', 'contacted');

insert into conversations (id, organization_id, customer_id, mode, status) values
  ('00000000-0000-0000-0000-0000000b0041', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0021', 'ai', 'open');

insert into messages (organization_id, conversation_id, sender, content) values
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000b0041', 'customer', 'Do you have weekend algebra classes?');
