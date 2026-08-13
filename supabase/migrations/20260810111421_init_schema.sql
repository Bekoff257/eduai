-- ============================================================================
-- Milestone 1: Database foundation
-- Organizations, membership, business data, Telegram, CRM, conversations,
-- appointments, follow-ups, AI actions, human takeover, audit log.
--
-- Tenant model: every organization-owned table carries organization_id.
-- Identity: Supabase Auth (see docs/architecture.md). Users are linked to
-- organizations via organization_members.user_id, a foreign key straight
-- to auth.users — which is what RLS policies (next migration) join against
-- via auth.uid(), Supabase's native per-request authenticated user id.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table organizations is 'A tenant: one education center.';

-- ----------------------------------------------------------------------------
-- organization_members
-- Links a Supabase Auth user (auth.users) to an organization. This table is
-- the join point every RLS policy relies on for tenant isolation.
-- ----------------------------------------------------------------------------
create type organization_member_role as enum ('owner', 'admin', 'staff');

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role organization_member_role not null default 'staff',
  display_name text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table organization_members is 'Maps a Supabase Auth user to an organization + role. RLS join key: user_id = auth.uid().';
comment on column organization_members.is_active is 'Soft-disable a member''s access without deleting history (audit_logs, ai_actions references stay intact). RLS policies must check this.';

create index idx_organization_members_user_id on organization_members (user_id);
create index idx_organization_members_org_id on organization_members (organization_id);

-- ----------------------------------------------------------------------------
-- business_settings
-- One row per organization. Structured business config the AI reasons over
-- (never a single freeform prompt blob, per architecture principle).
-- ----------------------------------------------------------------------------
create table business_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  business_name text not null default '',
  description text not null default '',
  timezone text not null default 'UTC',
  working_hours jsonb not null default '{}'::jsonb,
  languages text[] not null default array['en'],
  ai_tone text not null default 'friendly and professional',
  escalation_rules jsonb not null default '{}'::jsonb,
  policies jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table business_settings is 'Structured, per-organization AI/business configuration. Not a system-prompt blob.';

-- ----------------------------------------------------------------------------
-- telegram_integrations
-- One bot per organization (MVP assumption). webhook_token is the opaque
-- path segment used in /api/telegram/webhook/[token]; bot_token is the
-- real Telegram secret and must never be exposed to the client.
-- ----------------------------------------------------------------------------
create table telegram_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  bot_token text not null,
  bot_username text,
  webhook_token uuid not null default gen_random_uuid(),
  webhook_secret text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id),
  unique (webhook_token)
);

comment on table telegram_integrations is 'bot_token and webhook_secret are backend-only secrets. Never select these columns for a browser-facing response.';

create index idx_telegram_integrations_org_id on telegram_integrations (organization_id);

-- ----------------------------------------------------------------------------
-- courses
-- ----------------------------------------------------------------------------
create table courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  description text not null default '',
  price numeric(12, 2),
  currency text not null default 'USD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_courses_org_id on courses (organization_id);
create index idx_courses_org_active on courses (organization_id) where is_active;

-- ----------------------------------------------------------------------------
-- course_groups
-- A schedule/cohort within a course. capacity/available drive booking logic.
-- ----------------------------------------------------------------------------
create table course_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  name text not null default '',
  days_of_week smallint[] not null default '{}',
  start_time time,
  end_time time,
  capacity integer not null check (capacity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column course_groups.days_of_week is '0=Sunday .. 6=Saturday';

create index idx_course_groups_org_id on course_groups (organization_id);
create index idx_course_groups_course_id on course_groups (course_id);

-- ----------------------------------------------------------------------------
-- customers
-- A person the business talks to. Identified primarily by Telegram identity.
-- ----------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  telegram_chat_id bigint,
  telegram_username text,
  full_name text,
  phone text,
  language text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, telegram_chat_id)
);

create index idx_customers_org_id on customers (organization_id);

-- ----------------------------------------------------------------------------
-- leads
-- ----------------------------------------------------------------------------
create type lead_status as enum (
  'new',
  'contacted',
  'qualified',
  'appointment_booked',
  'converted',
  'lost'
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  course_id uuid references courses (id) on delete set null,
  source text not null default 'telegram',
  status lead_status not null default 'new',
  notes text,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_org_id on leads (organization_id);
create index idx_leads_customer_id on leads (customer_id);
create index idx_leads_org_status on leads (organization_id, status);

-- Cross-tenant-bypass guard: a row's customer_id/course_id must belong to
-- the SAME organization as the row itself. Without this, a service-layer
-- bug (or a compromised policy) could link Org A's row to Org B's customer
-- record and leak data through the join. Enforced with a trigger since
-- Postgres FKs cannot express "same org as sibling column".
--
-- This function is shared across tables that don't all have the same
-- columns (only leads has course_id), so fields are read via to_jsonb(new)
-- rather than direct new.column_name access — direct access to a column
-- that doesn't exist on the triggering table's row type fails at runtime
-- for a RECORD-typed NEW in a shared trigger function.
create function assert_same_organization() returns trigger as $$
declare
  new_row jsonb := to_jsonb(new);
  customer_id uuid;
  course_id uuid;
  customer_org uuid;
  course_org uuid;
begin
  customer_id := (new_row ->> 'customer_id')::uuid;
  if customer_id is not null then
    select organization_id into customer_org from customers where id = customer_id;
    if customer_org is null or customer_org <> new.organization_id then
      raise exception 'customer_id % does not belong to organization %', customer_id, new.organization_id;
    end if;
  end if;

  course_id := (new_row ->> 'course_id')::uuid;
  if course_id is not null then
    select organization_id into course_org from courses where id = course_id;
    if course_org is null or course_org <> new.organization_id then
      raise exception 'course_id % does not belong to organization %', course_id, new.organization_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_leads_same_org
  before insert or update on leads
  for each row execute function assert_same_organization();

-- ----------------------------------------------------------------------------
-- conversations
-- ----------------------------------------------------------------------------
create type conversation_mode as enum ('ai', 'human');
create type conversation_status as enum ('open', 'closed', 'needs_attention');

create table conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  mode conversation_mode not null default 'ai',
  status conversation_status not null default 'open',
  assigned_member_id uuid references organization_members (id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_conversations_org_id on conversations (organization_id);
create index idx_conversations_customer_id on conversations (customer_id);
create index idx_conversations_org_status on conversations (organization_id, status);

create trigger trg_conversations_same_org
  before insert or update on conversations
  for each row execute function assert_same_organization();

-- ----------------------------------------------------------------------------
-- messages
-- ----------------------------------------------------------------------------
create type message_sender as enum ('customer', 'ai', 'staff', 'system');

create table messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  sender message_sender not null,
  sender_member_id uuid references organization_members (id) on delete set null,
  content text not null,
  telegram_message_id bigint,
  telegram_update_id bigint,
  created_at timestamptz not null default now()
);

comment on column messages.telegram_update_id is 'Used for webhook idempotency — Telegram may retry the same update.';

create index idx_messages_org_id on messages (organization_id);
create index idx_messages_conversation_id on messages (conversation_id, created_at);

-- Idempotency: never persist the same inbound Telegram update twice, scoped
-- per organization since update_id is only unique within a single bot.
create unique index uq_messages_org_telegram_update
  on messages (organization_id, telegram_update_id)
  where telegram_update_id is not null;

-- ----------------------------------------------------------------------------
-- appointments
-- ----------------------------------------------------------------------------
create type appointment_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');

create table appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  lead_id uuid references leads (id) on delete set null,
  course_group_id uuid not null references course_groups (id) on delete restrict,
  status appointment_status not null default 'scheduled',
  scheduled_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_appointments_org_id on appointments (organization_id);
create index idx_appointments_customer_id on appointments (customer_id);
create index idx_appointments_group_id on appointments (course_group_id);
create index idx_appointments_org_scheduled on appointments (organization_id, scheduled_at);

-- Double-booking prevention: same customer cannot hold two active bookings
-- in the same group at the same time slot.
create unique index uq_appointments_customer_group_slot
  on appointments (organization_id, customer_id, course_group_id, scheduled_at)
  where status = 'scheduled';

create trigger trg_appointments_same_org
  before insert or update on appointments
  for each row execute function assert_same_organization();

-- ----------------------------------------------------------------------------
-- follow_ups
-- ----------------------------------------------------------------------------
create type follow_up_status as enum ('pending', 'sent', 'cancelled', 'failed');

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  status follow_up_status not null default 'pending',
  due_at timestamptz not null,
  message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_follow_ups_org_id on follow_ups (organization_id);
create index idx_follow_ups_due on follow_ups (organization_id, status, due_at);

create trigger trg_follow_ups_same_org
  before insert or update on follow_ups
  for each row execute function assert_same_organization();

-- ----------------------------------------------------------------------------
-- ai_actions
-- Audit trail of tool calls the AI agent executed, for the AI Activity
-- dashboard and for debugging what the agent actually did.
-- ----------------------------------------------------------------------------
create type ai_action_status as enum ('success', 'failure');

create table ai_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  status ai_action_status not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_ai_actions_org_id on ai_actions (organization_id, created_at desc);
create index idx_ai_actions_conversation_id on ai_actions (conversation_id);

-- ----------------------------------------------------------------------------
-- human_takeovers
-- Tracks when a staff member took control of a conversation and when (if)
-- it was handed back to the AI.
-- ----------------------------------------------------------------------------
create table human_takeovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  member_id uuid not null references organization_members (id) on delete cascade,
  taken_over_at timestamptz not null default now(),
  returned_to_ai_at timestamptz,
  reason text
);

create index idx_human_takeovers_org_id on human_takeovers (organization_id);
create index idx_human_takeovers_conversation_id on human_takeovers (conversation_id);

-- Only one open (not yet returned) takeover per conversation.
create unique index uq_human_takeovers_open_per_conversation
  on human_takeovers (conversation_id)
  where returned_to_ai_at is null;

-- ----------------------------------------------------------------------------
-- audit_logs
-- Security-sensitive and business-critical action log. Append-only.
-- ----------------------------------------------------------------------------
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'ai')),
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table audit_logs is 'Append-only. organization_id is nullable to allow platform-level events not tied to a single org.';

create index idx_audit_logs_org_id on audit_logs (organization_id, created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_organizations_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger trg_organization_members_updated_at before update on organization_members
  for each row execute function set_updated_at();
create trigger trg_business_settings_updated_at before update on business_settings
  for each row execute function set_updated_at();
create trigger trg_telegram_integrations_updated_at before update on telegram_integrations
  for each row execute function set_updated_at();
create trigger trg_courses_updated_at before update on courses
  for each row execute function set_updated_at();
create trigger trg_course_groups_updated_at before update on course_groups
  for each row execute function set_updated_at();
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();
create trigger trg_leads_updated_at before update on leads
  for each row execute function set_updated_at();
create trigger trg_conversations_updated_at before update on conversations
  for each row execute function set_updated_at();
create trigger trg_appointments_updated_at before update on appointments
  for each row execute function set_updated_at();
create trigger trg_follow_ups_updated_at before update on follow_ups
  for each row execute function set_updated_at();
