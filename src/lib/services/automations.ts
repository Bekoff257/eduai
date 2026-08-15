import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  AutomationTriggerType,
  AutomationStatus,
  AutomationCondition,
  AutomationActionStep,
  AutomationStopCondition,
  AutomationRunStatus,
  AutomationStepStatus,
  AutomationActionType,
} from "@/lib/automation/types";

export interface Automation {
  id: string;
  organizationId: string;
  name: string;
  triggerType: AutomationTriggerType;
  conditions: AutomationCondition[];
  actions: AutomationActionStep[];
  stopConditions: AutomationStopCondition[];
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: {
  id: string;
  organization_id: string;
  name: string;
  trigger_type: AutomationTriggerType;
  conditions: unknown;
  actions: unknown;
  stop_conditions: AutomationStopCondition[];
  status: AutomationStatus;
  created_at: string;
  updated_at: string;
}): Automation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    triggerType: row.trigger_type,
    conditions: Array.isArray(row.conditions) ? (row.conditions as AutomationCondition[]) : [],
    actions: Array.isArray(row.actions) ? (row.actions as AutomationActionStep[]) : [],
    stopConditions: row.stop_conditions ?? [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS =
  "id, organization_id, name, trigger_type, conditions, actions, stop_conditions, status, created_at, updated_at";

export interface CreateAutomationInput {
  name: string;
  triggerType: AutomationTriggerType;
  conditions: AutomationCondition[];
  actions: AutomationActionStep[];
  stopConditions: AutomationStopCondition[];
}

export async function createAutomation(organizationId: string, input: CreateAutomationInput): Promise<Automation> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automations")
    .insert({
      organization_id: organizationId,
      name: input.name,
      trigger_type: input.triggerType,
      conditions: input.conditions,
      actions: input.actions,
      stop_conditions: input.stopConditions,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`createAutomation failed: ${error.message}`);
  return mapRow(data);
}

export interface UpdateAutomationInput {
  name?: string;
  triggerType?: AutomationTriggerType;
  conditions?: AutomationCondition[];
  actions?: AutomationActionStep[];
  stopConditions?: AutomationStopCondition[];
  status?: AutomationStatus;
}

export async function updateAutomation(
  organizationId: string,
  automationId: string,
  input: UpdateAutomationInput
): Promise<Automation | null> {
  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.triggerType !== undefined) patch.trigger_type = input.triggerType;
  if (input.conditions !== undefined) patch.conditions = input.conditions;
  if (input.actions !== undefined) patch.actions = input.actions;
  if (input.stopConditions !== undefined) patch.stop_conditions = input.stopConditions;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase
    .from("automations")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", automationId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`updateAutomation failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function getAutomation(organizationId: string, automationId: string): Promise<Automation | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automations")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", automationId)
    .maybeSingle();

  if (error) throw new Error(`getAutomation failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

export async function listAutomations(organizationId: string): Promise<Automation[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automations")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listAutomations failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/** Active automations for a specific trigger type — the read the engine's
 * dispatchTrigger() uses. Excludes paused/archived automations by
 * construction (a paused automation must never start a new run). */
export async function listActiveAutomationsForTrigger(
  organizationId: string,
  triggerType: AutomationTriggerType
): Promise<Automation[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automations")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("trigger_type", triggerType)
    .eq("status", "active");

  if (error) throw new Error(`listActiveAutomationsForTrigger failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/** Soft-delete, matching this schema's existing convention (courses,
 * course_groups) — archived automations are hidden from the active list
 * and from trigger dispatch, but their run history remains intact for
 * observability. */
export async function archiveAutomation(organizationId: string, automationId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automations")
    .update({ status: "archived" })
    .eq("organization_id", organizationId)
    .eq("id", automationId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`archiveAutomation failed: ${error.message}`);
  return data !== null;
}

// ----------------------------------------------------------------------------
// automation_runs
// ----------------------------------------------------------------------------

export interface AutomationRun {
  id: string;
  organizationId: string;
  automationId: string;
  customerId: string;
  conversationId: string | null;
  leadId: string | null;
  appointmentId: string | null;
  triggerEventId: string;
  status: AutomationRunStatus;
  stoppedReason: AutomationStopCondition | null;
  startedAt: string;
  completedAt: string | null;
}

function mapRunRow(row: {
  id: string;
  organization_id: string;
  automation_id: string;
  customer_id: string;
  conversation_id: string | null;
  lead_id: string | null;
  appointment_id: string | null;
  trigger_event_id: string;
  status: AutomationRunStatus;
  stopped_reason: AutomationStopCondition | null;
  started_at: string;
  completed_at: string | null;
}): AutomationRun {
  return {
    id: row.id,
    organizationId: row.organization_id,
    automationId: row.automation_id,
    customerId: row.customer_id,
    conversationId: row.conversation_id,
    leadId: row.lead_id,
    appointmentId: row.appointment_id,
    triggerEventId: row.trigger_event_id,
    status: row.status,
    stoppedReason: row.stopped_reason,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

const RUN_SELECT_COLUMNS =
  "id, organization_id, automation_id, customer_id, conversation_id, lead_id, appointment_id, trigger_event_id, status, stopped_reason, started_at, completed_at";

export type CreateRunResult =
  | { ok: true; run: AutomationRun }
  | { ok: false; reason: "duplicate_trigger_event" };

/**
 * Creates a run for one automation matching one triggering event.
 * triggerEventId + the unique index on (automation_id, trigger_event_id)
 * make this idempotent: dispatching the same underlying event twice (e.g.
 * a retried webhook re-invoking a tool handler) returns
 * duplicate_trigger_event instead of starting a second run.
 */
export async function createAutomationRun(
  organizationId: string,
  input: {
    automationId: string;
    customerId: string;
    conversationId?: string | null;
    leadId?: string | null;
    appointmentId?: string | null;
    triggerEventId: string;
  }
): Promise<CreateRunResult> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({
      organization_id: organizationId,
      automation_id: input.automationId,
      customer_id: input.customerId,
      conversation_id: input.conversationId ?? null,
      lead_id: input.leadId ?? null,
      appointment_id: input.appointmentId ?? null,
      trigger_event_id: input.triggerEventId,
    })
    .select(RUN_SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, reason: "duplicate_trigger_event" };
    }
    throw new Error(`createAutomationRun failed: ${error.message}`);
  }

  return { ok: true, run: mapRunRow(data) };
}

export async function getAutomationRun(organizationId: string, runId: string): Promise<AutomationRun | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .select(RUN_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", runId)
    .maybeSingle();

  if (error) throw new Error(`getAutomationRun failed: ${error.message}`);
  return data ? mapRunRow(data) : null;
}

/** Active runs for a customer — the read the stop-condition checker uses
 * (e.g. "did this customer reply to any of their active runs' automations
 * since the run started"). */
export async function listActiveRunsForCustomer(organizationId: string, customerId: string): Promise<AutomationRun[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .select(RUN_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("status", "active");

  if (error) throw new Error(`listActiveRunsForCustomer failed: ${error.message}`);
  return (data ?? []).map(mapRunRow);
}

export interface AutomationRunListItem extends AutomationRun {
  automationName: string;
  customerName: string | null;
  /** True if any step in this run ended in 'failed' (exhausted retries) —
   * the dashboard's "see failed executions" signal. A run can still be
   * 'active'/'completed' overall with an earlier failed step (e.g. one
   * send_message attempt failed permanently but later steps still ran),
   * so this is deliberately independent of the run's own status. */
  hasFailedStep: boolean;
}

/** Execution history for the dashboard's Automations detail view — newest
 * first, joined with the automation's name and the customer's display name
 * so the UI doesn't need N follow-up lookups. */
export async function listRunsForAutomation(
  organizationId: string,
  automationId: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<{ runs: AutomationRunListItem[]; totalCount: number }> {
  const supabase = getSupabaseServiceClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("automation_runs")
    .select(
      `${RUN_SELECT_COLUMNS}, automations(name), customers(full_name, telegram_username), automation_run_steps(status)`,
      { count: "exact" }
    )
    .eq("organization_id", organizationId)
    .eq("automation_id", automationId)
    .order("started_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`listRunsForAutomation failed: ${error.message}`);

  type AutomationRef = { name: string };
  type CustomerRef = { full_name: string | null; telegram_username: string | null };
  type StepRef = { status: AutomationStepStatus };

  const runs = (data ?? []).map((row) => {
    const automation = row.automations as unknown as AutomationRef | AutomationRef[] | null;
    const customer = row.customers as unknown as CustomerRef | CustomerRef[] | null;
    const steps = row.automation_run_steps as unknown as StepRef[] | null;
    const a = Array.isArray(automation) ? automation[0] : automation;
    const c = Array.isArray(customer) ? customer[0] : customer;
    return {
      ...mapRunRow(row),
      automationName: a?.name ?? "",
      customerName: c?.full_name ?? (c?.telegram_username ? `@${c.telegram_username}` : null),
      hasFailedStep: (steps ?? []).some((s) => s.status === "failed"),
    };
  });

  return { runs, totalCount: count ?? 0 };
}

export async function updateAutomationRunStatus(
  organizationId: string,
  runId: string,
  status: AutomationRunStatus,
  stoppedReason?: AutomationStopCondition
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = { status };
  if (status !== "active") patch.completed_at = new Date().toISOString();
  if (stoppedReason !== undefined) patch.stopped_reason = stoppedReason;

  const { error } = await supabase
    .from("automation_runs")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", runId);

  if (error) throw new Error(`updateAutomationRunStatus failed: ${error.message}`);
}

// ----------------------------------------------------------------------------
// automation_run_steps
// ----------------------------------------------------------------------------

export interface AutomationRunStep {
  id: string;
  organizationId: string;
  runId: string;
  stepIndex: number;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
  status: AutomationStepStatus;
  scheduledAt: string;
  retryCount: number;
  errorMessage: string | null;
}

function mapStepRow(row: {
  id: string;
  organization_id: string;
  run_id: string;
  step_index: number;
  action_type: AutomationActionType;
  action_config: unknown;
  status: AutomationStepStatus;
  scheduled_at: string;
  retry_count: number;
  error_message: string | null;
}): AutomationRunStep {
  return {
    id: row.id,
    organizationId: row.organization_id,
    runId: row.run_id,
    stepIndex: row.step_index,
    actionType: row.action_type,
    actionConfig: (row.action_config as Record<string, unknown>) ?? {},
    status: row.status,
    scheduledAt: row.scheduled_at,
    retryCount: row.retry_count,
    errorMessage: row.error_message,
  };
}

const STEP_SELECT_COLUMNS =
  "id, organization_id, run_id, step_index, action_type, action_config, status, scheduled_at, retry_count, error_message";

export async function createAutomationRunStep(
  organizationId: string,
  input: {
    runId: string;
    stepIndex: number;
    actionType: AutomationActionType;
    actionConfig: Record<string, unknown>;
    scheduledAt: string;
  }
): Promise<AutomationRunStep> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automation_run_steps")
    .insert({
      organization_id: organizationId,
      run_id: input.runId,
      step_index: input.stepIndex,
      action_type: input.actionType,
      action_config: input.actionConfig,
      scheduled_at: input.scheduledAt,
    })
    .select(STEP_SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`createAutomationRunStep failed: ${error.message}`);
  return mapStepRow(data);
}

export interface DueStepWithContext extends AutomationRunStep {
  run: AutomationRun;
}

/**
 * Atomically claims every currently-due pending step across ALL
 * organizations (same cross-tenant-by-necessity shape as follow-ups'
 * listDueFollowUps — only ever called from the cron route). No row cap:
 * Postgres UPDATE has no LIMIT clause, and this app's automation volume
 * doesn't warrant paginated claiming — a business with an unusually large
 * number of due steps at once just means a longer single cron
 * invocation, not a correctness concern.
 *
 * PostgREST translates `.update(...).eq(...).select()` into a single SQL
 * `UPDATE ... WHERE ... RETURNING *` statement — Postgres evaluates the
 * WHERE clause and performs the update atomically per row, so a step
 * claimed by one call can never also be matched by a concurrent call's
 * WHERE status='pending'. This is what makes overlapping/duplicate cron
 * invocations safe without any additional locking — see the migration's
 * comment on automation_run_steps for the full reasoning. No custom RPC
 * is needed here (unlike book_appointment_atomic, which needs to hold a
 * lock across a read-then-write capacity check) since this is a single
 * unconditional UPDATE with no cross-row invariant to protect.
 */
export async function claimDueAutomationSteps(now: string): Promise<DueStepWithContext[]> {
  const supabase = getSupabaseServiceClient();

  const { data: claimed, error: claimError } = await supabase
    .from("automation_run_steps")
    .update({ status: "running", claimed_at: now, started_at: now })
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .select(STEP_SELECT_COLUMNS);

  if (claimError) throw new Error(`claimDueAutomationSteps failed: ${claimError.message}`);
  if (!claimed || claimed.length === 0) return [];

  const runIds = [...new Set(claimed.map((s) => s.run_id))];
  const { data: runs, error: runsError } = await supabase
    .from("automation_runs")
    .select(RUN_SELECT_COLUMNS)
    .in("id", runIds);

  if (runsError) throw new Error(`claimDueAutomationSteps (fetching runs) failed: ${runsError.message}`);

  const runById = new Map((runs ?? []).map((r) => [r.id, mapRunRow(r)]));

  return claimed
    .map((row) => {
      const run = runById.get(row.run_id);
      if (!run) return null;
      return { ...mapStepRow(row), run };
    })
    .filter((s): s is DueStepWithContext => s !== null);
}

export async function markStepCompleted(organizationId: string, stepId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("automation_run_steps")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", stepId);

  if (error) throw new Error(`markStepCompleted failed: ${error.message}`);
}

export async function markStepFailed(organizationId: string, stepId: string, errorMessage: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("automation_run_steps")
    .update({ status: "failed", completed_at: new Date().toISOString(), error_message: errorMessage.slice(0, 500) })
    .eq("organization_id", organizationId)
    .eq("id", stepId);

  if (error) throw new Error(`markStepFailed failed: ${error.message}`);
}

/** Retries a failed step by resetting it to pending with an incremented
 * retry_count and a fresh scheduled_at — used for transient failures
 * (Telegram send failure, OpenRouter error) rather than a permanent one. */
export async function retryStep(organizationId: string, stepId: string, retryCount: number, nextScheduledAt: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("automation_run_steps")
    .update({ status: "pending", retry_count: retryCount, scheduled_at: nextScheduledAt, claimed_at: null })
    .eq("organization_id", organizationId)
    .eq("id", stepId);

  if (error) throw new Error(`retryStep failed: ${error.message}`);
}

export async function cancelPendingStepsForRun(organizationId: string, runId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("automation_run_steps")
    .update({ status: "cancelled" })
    .eq("organization_id", organizationId)
    .eq("run_id", runId)
    .eq("status", "pending");

  if (error) throw new Error(`cancelPendingStepsForRun failed: ${error.message}`);
}

export async function listStepsForRun(organizationId: string, runId: string): Promise<AutomationRunStep[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("automation_run_steps")
    .select(STEP_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("run_id", runId)
    .order("step_index", { ascending: true });

  if (error) throw new Error(`listStepsForRun failed: ${error.message}`);
  return (data ?? []).map(mapStepRow);
}
