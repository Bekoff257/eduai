-- ============================================================================
-- Milestone 6 — Automation Engine.
--
-- Generalizes the single-purpose M4 follow_ups table (unchanged, still used
-- as-is for the AI's direct in-conversation create_follow_up tool) into a
-- configurable TRIGGER -> CONDITIONS -> ACTIONS engine a business owner can
-- define from the dashboard.
--
-- Three tables:
--   automations         — the org-owned definition (trigger + conditions +
--                          ordered action list), created/edited from the
--                          dashboard.
--   automation_runs      — one row per (automation, triggering event): a
--                          specific customer/conversation/lead instance
--                          that matched an automation's trigger+conditions
--                          and is progressing through its action sequence.
--                          Carries the stop-condition target state.
--   automation_run_steps — one row per scheduled/executed action within a
--                          run. This is the generic, idempotent replacement
--                          for what follow_ups did for exactly one action
--                          type — status transitions (pending -> running ->
--                          completed/failed/cancelled) and a claim column
--                          make concurrent/duplicate cron execution safe.
--
-- Tenant isolation follows the same convention as every other table in this
-- schema: organization_id on every row, service-layer scoping via
-- (organizationId, id) on every query. assert_same_organization() is
-- extended to also guard automation_runs.customer_id, matching how it
-- already guards customer_id/course_id on other tables — automation_run
-- lead_id/conversation_id references rely on service-layer scoping instead,
-- same as leads/appointments/follow_ups already do for their own
-- non-customer/course foreign keys.
-- ============================================================================

create type automation_status as enum ('active', 'paused', 'archived');
create type automation_trigger_type as enum (
  'lead_created',
  'lead_status_changed',
  'appointment_created',
  'appointment_cancelled',
  'conversation_needs_attention'
);
create type automation_run_status as enum ('active', 'completed', 'stopped', 'cancelled');
create type automation_step_status as enum ('pending', 'running', 'completed', 'failed', 'cancelled');
create type automation_action_type as enum (
  'send_message',
  'send_ai_message',
  'create_follow_up',
  'update_lead',
  'mark_conversation_needs_attention',
  'notify_staff'
);
create type automation_stop_condition as enum (
  'customer_replied',
  'appointment_created',
  'lead_closed',
  'automation_cancelled'
);

-- ----------------------------------------------------------------------------
-- automations
-- The org-owned definition. conditions/actions are jsonb rather than
-- normalized tables — matches this schema's existing convention for
-- structured-but-flexible config (business_settings.working_hours/policies)
-- rather than over-normalizing a shape that's still evolving. Validated at
-- the application layer (Zod, in the service/API route), not by a DB check
-- constraint, so new condition/action shapes don't require a migration.
-- ----------------------------------------------------------------------------
create table automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  trigger_type automation_trigger_type not null,
  -- Array of { field, operator, value } — AND-combined. See
  -- src/lib/automation/types.ts for the exact shape.
  conditions jsonb not null default '[]'::jsonb,
  -- Ordered array of { type, config, waitBeforeMinutes } — the sequence of
  -- actions a matched run executes, one at a time, with optional delays
  -- between them. See src/lib/automation/types.ts.
  actions jsonb not null default '[]'::jsonb,
  -- Which stop conditions apply to runs of this automation. Empty array is
  -- valid (an automation with no stop conditions, e.g. a single immediate
  -- notify_staff action that doesn't need one).
  stop_conditions automation_stop_condition[] not null default '{}',
  status automation_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_automations_org_id on automations (organization_id);
create index idx_automations_org_trigger_active on automations (organization_id, trigger_type) where status = 'active';

-- ----------------------------------------------------------------------------
-- automation_runs
-- One per (automation, triggering event). trigger_event_id is an
-- application-supplied idempotency key (e.g. the lead's id for
-- lead_created, or `${leadId}:${newStatus}` for lead_status_changed) so
-- dispatching the same underlying event twice (e.g. a retried webhook)
-- never starts a duplicate run for the same automation.
-- ----------------------------------------------------------------------------
create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  automation_id uuid not null references automations (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  lead_id uuid references leads (id) on delete set null,
  appointment_id uuid references appointments (id) on delete set null,
  trigger_event_id text not null,
  status automation_run_status not null default 'active',
  -- Which stop condition actually fired, if any — kept for observability
  -- even though the run's status already reflects it.
  stopped_reason automation_stop_condition,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index uq_automation_runs_idempotency
  on automation_runs (automation_id, trigger_event_id);

create index idx_automation_runs_org_id on automation_runs (organization_id);
create index idx_automation_runs_customer_id on automation_runs (customer_id);
create index idx_automation_runs_active on automation_runs (organization_id, status) where status = 'active';

create trigger trg_automation_runs_same_org
  before insert or update on automation_runs
  for each row execute function assert_same_organization();

-- ----------------------------------------------------------------------------
-- automation_run_steps
-- One per scheduled/executed action within a run. The generic,
-- multi-action-type replacement for follow_ups' single hardcoded "send
-- this text at this time" row.
--
-- Idempotent, concurrency-safe execution: the cron route claims due steps
-- via a single atomic
--   UPDATE ... SET status='running', claimed_at=now()
--   WHERE status='pending' AND scheduled_at<=now()
--   RETURNING *
-- Postgres guarantees row-level atomicity on that UPDATE, so two
-- overlapping cron invocations can never both claim the same step — the
-- second one's WHERE status='pending' simply matches zero rows for
-- whatever the first already claimed. This is the same idempotency
-- guarantee follow_ups relied on informally (a separate read then a
-- conditional write); here it's a single statement, closing a race that
-- was only theoretical for follow_ups' one-cron-job-at-a-time reality but
-- is worth doing correctly now that steps drive multi-action sequences.
-- ----------------------------------------------------------------------------
create table automation_run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  run_id uuid not null references automation_runs (id) on delete cascade,
  step_index integer not null check (step_index >= 0),
  action_type automation_action_type not null,
  -- Snapshot of this step's action config at schedule time (e.g. the
  -- message template, target lead status) — resolved from the parent
  -- automation's `actions` array when the run/step was created, so an
  -- automation edited mid-flight doesn't retroactively change an
  -- already-scheduled step's behavior.
  action_config jsonb not null default '{}'::jsonb,
  status automation_step_status not null default 'pending',
  scheduled_at timestamptz not null,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  retry_count integer not null default 0,
  -- Kept short and non-sensitive by convention (a summary, not a full AI
  -- prompt/response dump) — see src/lib/automation/engine.ts.
  error_message text,
  created_at timestamptz not null default now()
);

create unique index uq_automation_run_steps_run_index on automation_run_steps (run_id, step_index);
create index idx_automation_run_steps_org_id on automation_run_steps (organization_id);
create index idx_automation_run_steps_due on automation_run_steps (status, scheduled_at) where status = 'pending';
create index idx_automation_run_steps_run_id on automation_run_steps (run_id);

create trigger trg_automation_run_steps_same_org
  before insert or update on automation_run_steps
  for each row execute function assert_same_organization();

comment on table automations is 'Org-configured TRIGGER -> CONDITIONS -> ACTIONS definitions, created from the dashboard. See src/lib/automation/types.ts for the conditions/actions jsonb shapes.';
comment on table automation_runs is 'One row per (automation, triggering event) — a specific customer progressing through an automation''s action sequence. trigger_event_id + the unique index make dispatching the same event twice a no-op.';
comment on table automation_run_steps is 'One row per scheduled/executed action within a run. Claimed atomically by the cron route (status pending->running in one UPDATE) so overlapping/duplicate cron executions cannot double-send the same action.';
